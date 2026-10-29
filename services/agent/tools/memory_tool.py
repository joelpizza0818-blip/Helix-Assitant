from __future__ import annotations

import logging
from typing import Any, Dict

from .base_tool import BaseTool, ToolResult
from ..memory.user_memory_manager import UserMemoryManager

logger = logging.getLogger(__name__)


class UserMemoryTool(BaseTool):
    """Native tool for saving, retrieving, and managing explicit user memories."""

    @property
    def name(self) -> str:
        return "manage_memory"

    @property
    def description(self) -> str:
        return (
            "Manages long-term memories scoped to the current agent. Save only durable, useful "
            "preferences, facts, or project context that are likely to matter again; do not save "
            "ordinary messages, one-off task details, or secrets. Recall memories only when relevant. "
            "Use 'list' to inspect the current agent's memory."
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
                    "enum": ["save", "recall", "list", "update", "delete"],
                    "description": "Action to perform on user memory.",
                },
                "text": {
                    "type": "string",
                    "description": "The fact, preference, or instruction to remember (required for 'save').",
                },
                "category": {
                    "type": "string",
                    "enum": ["preference", "fact", "project", "instruction", "general"],
                    "description": "Category for the memory (optional, default 'general').",
                },
                "query": {
                    "type": "string",
                    "description": "Search term to filter memories (optional for 'recall').",
                },
                "memory_id": {
                    "type": "string",
                    "description": "ID of memory to update or delete (required for 'update' and 'delete').",
                },
            },
            "required": ["action"],
        }

    def validate_params(self, params: Dict[str, Any]) -> bool:
        action = params.get("action")
        if action not in {"save", "recall", "list", "update", "delete"}:
            return False
        if action in {"save", "update"}:
            if not isinstance(params.get("text"), str) or not params["text"].strip():
                return False
            if action == "update":
                return isinstance(params.get("memory_id"), str) and bool(
                    params["memory_id"].strip()
                )
            return True
        if action == "delete":
            return isinstance(params.get("memory_id"), str) and bool(
                params["memory_id"].strip()
            )
        return action != "recall" or isinstance(params.get("query", ""), str)

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="Invalid memory action or required parameters.",
            )
        action = str(params.get("action", "recall")).lower().strip()
        manager = UserMemoryManager.get_instance()

        if action == "save":
            text = str(params.get("text", "")).strip()
            if not text:
                return ToolResult(success=False, output=None, error="Parameter 'text' is required for action 'save'.")
            category = str(params.get("category", "general")).strip()
            entry = manager.add_memory(text=text, category=category)
            return ToolResult(
                success=True,
                output={
                    "message": "Memory saved successfully.",
                    "memory": entry,
                },
            )

        if action == "recall":
            query = str(params.get("query", "")).strip()
            results = manager.search(query)
            return ToolResult(
                success=True,
                output={
                    "query": query,
                    "count": len(results),
                    "memories": results,
                },
            )

        if action == "list":
            all_m = manager.load_all()
            return ToolResult(
                success=True,
                output={
                    "total": len(all_m),
                    "memories": all_m,
                },
            )

        if action == "delete":
            mem_id = str(params.get("memory_id", "")).strip()
            if not mem_id:
                return ToolResult(success=False, output=None, error="Parameter 'memory_id' is required for action 'delete'.")
            deleted = manager.delete_memory(mem_id)
            return ToolResult(
                success=deleted,
                output={"deleted": deleted, "memory_id": mem_id},
                error=None if deleted else f"Memory {mem_id} not found.",
            )

        if action == "update":
            memory_id = str(params.get("memory_id", "")).strip()
            if not memory_id:
                return ToolResult(
                    success=False,
                    output=None,
                    error="Parameter 'memory_id' is required for action 'update'.",
                )
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
            error=f"Unsupported memory action '{action}'. Supported actions: save, recall, list, delete.",
        )
