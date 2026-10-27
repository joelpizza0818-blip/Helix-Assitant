"""
context_retrieve_tool.py — HELIX Agent Tool
============================================

Herramienta que permite al modelo recuperar el contenido completo de un bloque
almacenado en el Context Compression Layer (CCL).

El modelo la invoca cuando necesita inspeccionar un traceback largo, un log
completo o cualquier contenido que el CCL empaquetó y le entregó resumido.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

try:
    from services.agent.tools.base_tool import BaseTool, ToolResult, ToolSchema
    from services.agent.core.context_compression import get_ccl
except ImportError:
    from tools.base_tool import BaseTool, ToolResult, ToolSchema
    from core.context_compression import get_ccl

logger = logging.getLogger(__name__)
_DEFAULT_RETRIEVE_CHARS = 12_000
_MAX_RETRIEVE_CHARS = 50_000


class ContextRetrieveTool(BaseTool):
    """
    Retrieves the full original content of a CCL-compressed context block.

    Use when the model needs to inspect details that were summarised/packed
    by the Context Compression Layer (block IDs start with 'ccl:').
    """

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id

    @property
    def name(self) -> str:
        return "context_retrieve"

    @property
    def description(self) -> str:
        return (
            "Retrieve the full original content of a context block that was "
            "compressed/summarised by the Context Compression Layer. "
            "Use when you need to inspect specific lines, tracebacks, logs or "
            "file content that was packed into a CCL summary. "
            "The block_id is shown inside [CCL:...] markers in the context."
        )

    @property
    def permission_level(self) -> str:
        return "low"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        block_id = params.get("block_id", "")
        offset = params.get("offset", 0)
        max_chars = params.get("max_chars", _DEFAULT_RETRIEVE_CHARS)
        return (
            isinstance(block_id, str)
            and bool(block_id.strip())
            and isinstance(offset, int)
            and not isinstance(offset, bool)
            and offset >= 0
            and isinstance(max_chars, int)
            and not isinstance(max_chars, bool)
            and 1 <= max_chars <= _MAX_RETRIEVE_CHARS
        )

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        block_id: str = params.get("block_id", "").strip()
        offset = params.get("offset", 0)
        max_chars = params.get("max_chars", _DEFAULT_RETRIEVE_CHARS)
        if not self.validate_params({
            "block_id": block_id,
            "offset": offset,
            "max_chars": max_chars,
        }):
            return ToolResult(
                success=False,
                output=None,
                error=(
                    "block_id is required; offset must be non-negative and "
                    f"max_chars must be between 1 and {_MAX_RETRIEVE_CHARS}."
                ),
            )

        # Accept short prefix (first 8+ chars) by searching the store
        ccl = get_ccl(self._session_id)

        # Try exact match first
        content = ccl.retrieve(block_id)

        # Fallback: prefix search
        if content is None:
            for stored_id in list(ccl._store.keys()):
                if stored_id.startswith(block_id) or block_id in stored_id:
                    content = ccl.retrieve(stored_id)
                    break

        if content is None:
            return ToolResult(
                success=False,
                output=None,
                error=(
                    f"Block '{block_id}' not found in CCL store. "
                    f"Available blocks: {len(ccl._store)}. "
                    "The block may have been cleaned up or the ID is incorrect."
                ),
            )

        char_count = len(content)
        chunk = content[offset:offset + max_chars]
        next_offset = offset + len(chunk)
        logger.info(
            "CCL retrieve tool block=%s chars=%d offset=%d returned=%d session=%s",
            block_id[:16], char_count, offset, len(chunk), self._session_id,
        )
        return ToolResult(
            success=True,
            output={
                "block_id": block_id,
                "char_count": char_count,
                "offset": offset,
                "returned_chars": len(chunk),
                "next_offset": next_offset if next_offset < char_count else None,
                "content": chunk,
            },
        )

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {
                        "type": "string",
                        "description": (
                            "The block identifier shown in a [CCL:...] marker. "
                            "Can be the full 'ccl:<sha256>' or a short prefix (≥8 chars)."
                        ),
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Character offset to resume from (default 0).",
                        "minimum": 0,
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": (
                            "Maximum characters to return in this chunk (default 12000, "
                            "maximum 50000). Use next_offset to continue large blocks."
                        ),
                        "minimum": 1,
                        "maximum": _MAX_RETRIEVE_CHARS,
                    },
                },
                "required": ["block_id"],
            },
            "permission_level": self.permission_level,
            "requires_confirmation": self.requires_confirmation,
        }
