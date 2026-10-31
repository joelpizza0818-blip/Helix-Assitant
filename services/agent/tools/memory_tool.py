from __future__ import annotations

import logging
from typing import Any, Dict

from .base_tool import BaseTool, ToolResult
from ..memory.user_memory_manager import UserMemoryManager

logger = logging.getLogger(__name__)


class UserMemoryTool(BaseTool):
    """Native tool for saving, retrieving, and managing the persistent user memory profile.

    The profile has two parts:
    - ``summary``: a running paragraph of what Helix knows about the user (auto-updated by Helix).
    - ``user_notes``: free-form text the user writes manually (never auto-overwritten).

    Use ``update_summary`` to update or extend Helix's knowledge summary after relevant conversations.
    Use ``get_profile`` to read the current profile before updating it.
    """

    @property
    def name(self) -> str:
        return "manage_memory"

    @property
    def description(self) -> str:
        return (
            "Manages the persistent user memory profile. "
            "Use 'get_profile' to read the current summary and user notes. "
            "Use 'update_summary' to update what Helix knows about the user — only after conversations "
            "where new durable, relevant information was learned (preferences, ongoing projects, personal context). "
            "Never store secrets or one-off task details. "
            "The 'save', 'recall', 'list', 'update', 'delete' actions are available for legacy compatibility."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get_profile", "update_summary", "save", "recall", "list", "update", "delete"],
                    "description": (
                        "Action to perform. "
                        "'get_profile': read {summary, user_notes}. "
                        "'update_summary': replace the Helix knowledge summary (requires 'text'). "
                        "'save'/'recall'/'list'/'update'/'delete': legacy individual-entry operations."
                    ),
                },
                "text": {
                    "type": "string",
                    "description": "For 'update_summary': the full new summary text. For 'save'/'update': the memory entry text.",
                },
                "category": {
                    "type": "string",
                    "enum": ["preference", "fact", "project", "instruction", "general"],
                    "description": "Category for legacy 'save'/'update' actions (optional).",
                },
                "query": {
                    "type": "string",
                    "description": "Search term for 'recall' (optional).",
                },
                "memory_id": {
                    "type": "string",
                    "description": "ID for 'update' and 'delete' legacy actions.",
                },
            },
            "required": ["action"],
        }

    def validate_params(self, params: Dict[str, Any]) -> bool:
        action = params.get("action")
        if action not in {"get_profile", "update_summary", "save", "recall", "list", "update", "delete"}:
            return False
        if action in {"update_summary", "save"}:
            return isinstance(params.get("text"), str) and bool(params["text"].strip())
        if action == "update":
            return (
                isinstance(params.get("text"), str) and bool(params["text"].strip())
                and isinstance(params.get("memory_id"), str) and bool(params["memory_id"].strip())
            )
        if action == "delete":
            return isinstance(params.get("memory_id"), str) and bool(params["memory_id"].strip())
        return True

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="Invalid memory action or required parameters.",
            )
        action = str(params.get("action", "get_profile")).lower().strip()
        manager = UserMemoryManager.get_instance()

        if action == "get_profile":
            profile = manager.get_profile()
            return ToolResult(success=True, output=profile)

        if action == "update_summary":
            text = str(params.get("text", "")).strip()
            if not text:
                return ToolResult(success=False, output=None, error="'text' is required for 'update_summary'.")
            profile = manager.update_summary(text)
            return ToolResult(success=True, output={"message": "Memory summary updated.", "profile": profile})

        if action == "save":
            text = str(params.get("text", "")).strip()
            if not text:
                return ToolResult(success=False, output=None, error="'text' is required for 'save'.")
            category = str(params.get("category", "general")).strip()
            entry = manager.add_memory(text=text, category=category)
            return ToolResult(success=True, output={"message": "Memory saved.", "memory": entry})

        if action == "recall":
            query = str(params.get("query", "")).strip()
            results = manager.search(query)
            return ToolResult(success=True, output={"query": query, "count": len(results), "memories": results})

        if action == "list":
            all_m = manager.load_all()
            return ToolResult(success=True, output={"total": len(all_m), "memories": all_m})

        if action == "delete":
            mem_id = str(params.get("memory_id", "")).strip()
            if not mem_id:
                return ToolResult(success=False, output=None, error="'memory_id' is required for 'delete'.")
            deleted = manager.delete_memory(mem_id)
            return ToolResult(
                success=deleted,
                output={"deleted": deleted, "memory_id": mem_id},
                error=None if deleted else f"Memory {mem_id} not found.",
            )

        if action == "update":
            memory_id = str(params.get("memory_id", "")).strip()
            if not memory_id:
                return ToolResult(success=False, output=None, error="'memory_id' is required for 'update'.")
            updated = manager.update_memory(
                memory_id,
                str(params["text"]),
                str(params.get("category", "general")),
            )
            return ToolResult(
                success=updated is not None,
                output={"memory": updated},
                error=None if updated is not None else f"Memory {memory_id} not found.",
            )

        return ToolResult(
            success=False,
            output=None,
            error=f"Unsupported memory action '{action}'.",
        )

