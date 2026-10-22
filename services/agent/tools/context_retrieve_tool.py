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
        return bool(params.get("block_id", "").strip())

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        block_id: str = params.get("block_id", "").strip()
        if not block_id:
            return ToolResult(
                success=False,
                output=None,
                error="block_id is required",
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
        logger.info(
            "CCL retrieve tool block=%s chars=%d session=%s",
            block_id[:16], char_count, self._session_id,
        )
        return ToolResult(
            success=True,
            output={
                "block_id": block_id,
                "char_count": char_count,
                "content": content,
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
                    }
                },
                "required": ["block_id"],
            },
            "permission_level": self.permission_level,
            "requires_confirmation": self.requires_confirmation,
        }
