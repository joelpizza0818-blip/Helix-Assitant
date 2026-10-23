from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


class DelegateTaskTool(BaseTool):
    """Delegate a bounded task to a HELIX-managed child agent."""

    def __init__(self, agent_manager, key_manager):
        self.agent_manager = agent_manager
        self.key_manager = key_manager

    @property
    def name(self) -> str:
        return "delegate_task"

    @property
    def description(self) -> str:
        return (
            "Delegate an independent research or coding subtask to a HELIX child "
            "agent. Use only when app-level subagent delegation is enabled and "
            "the task benefits from separate work."
        )

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return (
            isinstance(params, dict)
            and isinstance(params.get("task"), str)
            and bool(params["task"].strip())
            and len(params["task"]) <= 4000
            and params.get("role", "research") in {"research", "coding", "main"}
        )

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "A focused, independent subtask with a concrete deliverable.",
                    },
                    "role": {
                        "type": "string",
                        "enum": ["research", "coding", "main"],
                        "description": "The child agent's task role.",
                    },
                },
                "required": ["task"],
            },
            "permission_level": self.permission_level,
            "requires_confirmation": False,
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        return ToolResult(
            success=False,
            output=None,
            error="Subagent delegation requires a parent task and credential context.",
        )

    async def execute_with_context(
        self,
        params: Dict[str, Any],
        *,
        parent_id: str | None,
        parent_credential: str | None,
    ) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(success=False, output=None, error="Invalid subtask or role.")
        if not parent_id:
            return ToolResult(
                success=False,
                output=None,
                error="Could not identify the parent task; delegation was not started.",
            )

        # Child agents run inside the managed runtime and reuse the active
        # provider session.  A second credential is neither required nor
        # desirable: it made delegation fail for valid single-provider setups.
        # Keep the optional exclusion for callers that still provide it, so a
        # provider can avoid reusing a specific key when another route exists.
        excluded_api_keys = [parent_credential] if parent_credential else []

        handle = await self.agent_manager.delegate_task(
            params["task"].strip(),
            role=params.get("role", "research"),
            parent_id=parent_id,
            context={"input_source": "subagent delegation"},
            excluded_api_keys=excluded_api_keys,
        )
        result = await handle
        if result.get("status") != "success":
            return ToolResult(
                success=False,
                output=result.get("error") or "The delegated child agent did not complete.",
                error=result.get("error") or "The delegated child agent did not complete.",
            )
        return ToolResult(
            success=True,
            output={
                "agent_id": result["agent_id"],
                "status": "completed",
                "result": result.get("result"),
            },
        )
