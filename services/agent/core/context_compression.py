"""
Context Compression Layer (CCL) — HELIX Agent
==============================================

Módulo intermedio que procesa fuentes voluminosas para el orquestador sin agotar
la ventana de contexto del modelo. Implementa doble nivel:

  1. Preservación lossless:  guarda el contenido bruto en un almacén de sesión
                             (en memoria, con spill-to-disk opcional).
  2. Context Packing:        genera representaciones compactas y tipadas para el
                             modelo con punteros de recuperación.

El modelo puede pedir hidratación selectiva invocando la herramienta
`context_retrieve` con el identificador de bloque correspondiente.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
_DEFAULT_MAX_INLINE_CHARS  = 2_000   # chars before a block is packed (not inlined)
_DEFAULT_MAX_CONTEXT_CHARS = 80_000  # total context budget before compression kicks in
_DEFAULT_SUMMARY_LINES     = 12      # lines of summary to include in packed repr
_BLOCK_ID_PREFIX           = "ccl:"
_SPILL_THRESHOLD_BYTES     = 5 * 1024 * 1024  # 5 MB — blocks above go to temp disk


# ── Data types ─────────────────────────────────────────────────────────────────
@dataclass
class ContextBlock:
    """A single unit of compressed context stored by the CCL."""
    block_id:    str
    label:       str           # human-readable description
    block_type:  str           # "text" | "tool_output" | "log" | "code" | "image"
    raw_size:    int           # bytes of the original content
    packed_repr: str           # compact representation for the model
    compressed:  bytes         # gzip-compressed raw content
    created_at:  float = field(default_factory=time.time)
    retrieval_count: int = 0
    spill_path:  Optional[str] = None   # path if spilled to disk


@dataclass
class CompressionStats:
    total_raw_chars:      int = 0
    total_packed_chars:   int = 0
    blocks_stored:        int = 0
    blocks_retrieved:     int = 0
    spilled_to_disk:      int = 0

    @property
    def compression_ratio(self) -> float:
        if self.total_raw_chars == 0:
            return 1.0
        return self.total_packed_chars / self.total_raw_chars


# ── Main class ─────────────────────────────────────────────────────────────────
class ContextCompressionLayer:
    """
    Singleton-like per-session CCL.

    Usage::

        ccl = ContextCompressionLayer(session_id="abc123")

        # When a tool returns a large output:
        packed, block_id = ccl.pack("shell_output", raw_text, block_type="tool_output")
        # `packed` goes into the model context; `block_id` lets the model ask for more.

        # If the model calls context_retrieve(block_id):
        full = ccl.retrieve(block_id)
    """

    def __init__(
        self,
        session_id: str,
        max_inline_chars: int   = _DEFAULT_MAX_INLINE_CHARS,
        max_context_chars: int  = _DEFAULT_MAX_CONTEXT_CHARS,
        summary_lines: int      = _DEFAULT_SUMMARY_LINES,
        enable_disk_spill: bool = True,
    ) -> None:
        self.session_id       = session_id
        self.max_inline_chars = max_inline_chars
        self.max_context_chars= max_context_chars
        self.summary_lines    = summary_lines
        self.enable_disk_spill= enable_disk_spill

        self._store: Dict[str, ContextBlock] = {}
        self.stats  = CompressionStats()
        self._spill_dir: Optional[Path] = None

        if enable_disk_spill:
            self._spill_dir = Path(tempfile.gettempdir()) / f"helix_ccl_{session_id}"
            self._spill_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "CCL initialized session=%s max_inline=%d max_ctx=%d",
            session_id, max_inline_chars, max_context_chars,
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    def pack(
        self,
        label: str,
        content: str,
        block_type: str = "text",
    ) -> Tuple[str, str]:
        """
        Pack `content` into the store.

        Returns
        -------
        (packed_repr, block_id)
            packed_repr — compact text safe to inline in model context
            block_id    — identifier for selective retrieval
        """
        raw_size = len(content.encode("utf-8"))
        self.stats.total_raw_chars += len(content)

        # Short content: inline directly (no compression needed)
        if len(content) <= self.max_inline_chars:
            self.stats.total_packed_chars += len(content)
            return content, ""

        # Build packed representation
        packed = self._build_packed_repr(label, content, block_type)
        block_id = self._make_block_id(content)

        # Compress and store
        compressed = gzip.compress(content.encode("utf-8"), compresslevel=6)
        spill_path: Optional[str] = None

        if self.enable_disk_spill and raw_size >= _SPILL_THRESHOLD_BYTES:
            spill_path = self._spill_to_disk(block_id, compressed)
            compressed_stored = b""   # free memory; data is on disk
            self.stats.spilled_to_disk += 1
        else:
            compressed_stored = compressed

        block = ContextBlock(
            block_id=block_id,
            label=label,
            block_type=block_type,
            raw_size=raw_size,
            packed_repr=packed,
            compressed=compressed_stored,
            spill_path=spill_path,
        )
        self._store[block_id] = block
        self.stats.blocks_stored += 1
        self.stats.total_packed_chars += len(packed)

        ratio = len(packed) / max(len(content), 1)
        logger.debug(
            "CCL packed label=%r type=%s raw=%d packed=%d ratio=%.2f block=%s",
            label, block_type, len(content), len(packed), ratio, block_id[:12],
        )
        return packed, block_id

    def retrieve(self, block_id: str) -> Optional[str]:
        """Return the full original content for `block_id`, or None if not found."""
        block = self._store.get(block_id)
        if block is None:
            logger.warning("CCL retrieve: block not found block=%s", block_id)
            return None

        block.retrieval_count += 1
        self.stats.blocks_retrieved += 1

        if block.spill_path:
            data = self._read_spill(block.spill_path)
        else:
            data = block.compressed

        try:
            return gzip.decompress(data).decode("utf-8")
        except Exception as exc:
            logger.error("CCL decompress failed block=%s: %s", block_id, exc)
            return None

    def compress_tool_output(
        self,
        tool_name: str,
        output: Any,
        success: bool = True,
    ) -> Tuple[str, str]:
        """
        Convenience wrapper for packing tool outputs.
        Converts `output` to string, applies tool-specific summarisation,
        then delegates to `pack`.
        """
        if isinstance(output, dict):
            raw = json.dumps(output, ensure_ascii=False, indent=2)
        elif not isinstance(output, str):
            raw = str(output)
        else:
            raw = output

        label = f"[tool:{tool_name}] {'✓' if success else '✗'}"
        return self.pack(label, raw, block_type="tool_output")

    def compress_conversation_tail(
        self,
        messages: List[Dict[str, str]],
        keep_recent: int = 8,
    ) -> Tuple[List[Dict[str, str]], str]:
        """
        Compact older conversation messages into a single CCL block.
        Returns (trimmed_messages, packed_summary_insertion).
        """
        if len(messages) <= keep_recent:
            return messages, ""

        older  = messages[:-keep_recent]
        recent = messages[-keep_recent:]

        # Build raw older-history text
        parts = []
        for m in older:
            role    = m.get("role", "")
            content = m.get("content", "")
            if isinstance(content, list):  # multimodal
                content = " ".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                )
            # Preserve exact old turns in the recoverable block. The packed
            # representation, not destructive slicing, controls prompt size.
            parts.append(f"{role.upper()}: {content}")
        raw_history = "\n".join(parts)

        packed, block_id = self.pack(
            "conversation_history", raw_history, block_type="text"
        )
        header = f"[CCL:history block={block_id[:8] if block_id else 'inline'}]\n{packed}"
        return recent, header

    def get_stats(self) -> Dict[str, Any]:
        return {
            "session_id":       self.session_id,
            "blocks_stored":    self.stats.blocks_stored,
            "blocks_retrieved": self.stats.blocks_retrieved,
            "spilled_to_disk":  self.stats.spilled_to_disk,
            "total_raw_chars":  self.stats.total_raw_chars,
            "total_packed_chars": self.stats.total_packed_chars,
            "compression_ratio":  round(self.stats.compression_ratio, 3),
            "memory_blocks":    len(self._store),
        }

    def list_blocks(self) -> List[Dict[str, Any]]:
        return [
            {
                "block_id":   b.block_id[:16] + "…",
                "label":      b.label,
                "type":       b.block_type,
                "raw_kb":     round(b.raw_size / 1024, 1),
                "retrievals": b.retrieval_count,
                "on_disk":    b.spill_path is not None,
            }
            for b in self._store.values()
        ]

    def cleanup(self) -> None:
        """Release memory and remove spill files for this session."""
        if self._spill_dir and self._spill_dir.exists():
            for f in self._spill_dir.glob("*.gz"):
                try:
                    f.unlink()
                except OSError:
                    pass
            try:
                self._spill_dir.rmdir()
            except OSError:
                pass
        self._store.clear()
        logger.info("CCL cleaned up session=%s", self.session_id)

    # ── Private helpers ────────────────────────────────────────────────────────

    def _build_packed_repr(
        self,
        label: str,
        content: str,
        block_type: str,
    ) -> str:
        """Build a compact representation appropriate for the block type."""
        if block_type == "log":
            return self._pack_log(label, content)
        if block_type == "code":
            return self._pack_code(label, content)
        if block_type == "tool_output":
            return self._pack_tool_output(label, content)
        return self._pack_generic(label, content)

    def _pack_generic(self, label: str, content: str) -> str:
        lines  = content.splitlines()
        n      = len(lines)
        head   = "\n".join(lines[: self.summary_lines])
        tail   = "\n".join(lines[-4:]) if n > self.summary_lines + 4 else ""
        block_id_hint = self._make_block_id(content)[:8]
        parts  = [
            f"[CCL:{label} | {n} lines | {len(content)} chars | id:{block_id_hint}]",
            head,
        ]
        if tail:
            parts.append(f"  … ({n - self.summary_lines - 4} lines omitted) …")
            parts.append(tail)
        parts.append(f"[Use context_retrieve('{block_id_hint}…') for full content]")
        return "\n".join(parts)

    def _pack_log(self, label: str, content: str) -> str:
        """Summarise log output: counts by level + last N error lines."""
        lines  = content.splitlines()
        counts: Dict[str, int] = {"ERROR": 0, "WARN": 0, "INFO": 0, "DEBUG": 0}
        errors: List[str] = []
        for line in lines:
            upper = line.upper()
            if "ERROR" in upper or "TRACEBACK" in upper or "EXCEPTION" in upper:
                counts["ERROR"] += 1
                errors.append(line)
            elif "WARN" in upper:
                counts["WARN"] += 1
            elif "DEBUG" in upper:
                counts["DEBUG"] += 1
            else:
                counts["INFO"] += 1

        block_id_hint = self._make_block_id(content)[:8]
        summary = (
            f"[CCL:log {label} | {len(lines)} lines "
            f"ERR={counts['ERROR']} WARN={counts['WARN']} "
            f"INFO={counts['INFO']} | id:{block_id_hint}]\n"
        )
        if errors:
            summary += "Last errors:\n" + "\n".join(errors[-6:]) + "\n"
        summary += f"[context_retrieve('{block_id_hint}…') for full log]"
        return summary

    def _pack_code(self, label: str, content: str) -> str:
        """Summarise code: imports, top-level symbols + first N lines."""
        lines   = content.splitlines()
        imports = [l for l in lines if re.match(r"^\s*(import|from)\s", l)][:8]
        symbols = [
            l for l in lines
            if re.match(r"^(def |class |async def |[A-Z_]{3,}\s*=)", l)
        ][:10]
        block_id_hint = self._make_block_id(content)[:8]
        parts = [
            f"[CCL:code {label} | {len(lines)} lines | id:{block_id_hint}]",
        ]
        if imports:
            parts.append("Imports: " + "; ".join(imp.strip() for imp in imports))
        if symbols:
            parts.append("Symbols: " + "; ".join(sym.strip() for sym in symbols))
        parts.append("\n".join(lines[: self.summary_lines]))
        if len(lines) > self.summary_lines:
            parts.append(f"… {len(lines) - self.summary_lines} more lines …")
        parts.append(f"[context_retrieve('{block_id_hint}…') for full source]")
        return "\n".join(parts)

    def _pack_tool_output(self, label: str, content: str) -> str:
        """Summarise tool output: first N lines + truncation notice."""
        lines = content.splitlines()
        head  = "\n".join(lines[: self.summary_lines])
        block_id_hint = self._make_block_id(content)[:8]
        parts = [
            f"[CCL:tool {label} | {len(lines)} lines | {len(content)} chars | id:{block_id_hint}]",
            head,
        ]
        if len(lines) > self.summary_lines:
            parts.append(
                f"  … {len(lines) - self.summary_lines} lines omitted "
                f"[context_retrieve('{block_id_hint}…') for full output] …"
            )
        return "\n".join(parts)

    @staticmethod
    def _make_block_id(content: str) -> str:
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        return _BLOCK_ID_PREFIX + digest

    def _spill_to_disk(self, block_id: str, data: bytes) -> str:
        assert self._spill_dir is not None
        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", block_id[:40])
        path = self._spill_dir / f"{safe_name}.gz"
        path.write_bytes(data)
        logger.debug("CCL spilled %d bytes to %s", len(data), path)
        return str(path)

    def _read_spill(self, path: str) -> bytes:
        return Path(path).read_bytes()


# ── Session registry ───────────────────────────────────────────────────────────
_SESSION_REGISTRY: Dict[str, ContextCompressionLayer] = {}


def get_ccl(session_id: str, **kwargs: Any) -> ContextCompressionLayer:
    """Get or create the CCL for a session."""
    if session_id not in _SESSION_REGISTRY:
        _SESSION_REGISTRY[session_id] = ContextCompressionLayer(
            session_id=session_id, **kwargs
        )
    return _SESSION_REGISTRY[session_id]


def close_ccl(session_id: str) -> None:
    """Cleanup and remove the CCL for a session."""
    ccl = _SESSION_REGISTRY.pop(session_id, None)
    if ccl:
        ccl.cleanup()
