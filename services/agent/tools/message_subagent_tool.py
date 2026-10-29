from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


class MessageSubagentTool(BaseTool):
    """Send one bounded turn to another persistent subagent."""

    def __init__(self, agent_manager):
        self.agent_manager = agent_manager

    @property
    def name(self) -> str:
        return "message_subagent"

    @property
    def description(self) -> str:
        return (
            "Ask another HELIX teammate a focused question and receive its reply "
            "in this request. Use only when another specialty is needed; messages "
            "are separate model turns and cannot recurse without a depth limit."
        )

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def _profile_ids(self) -> list[str]:
        return [
            profile.profile_id
            for profile in self.agent_manager.profile_store.list_profiles()
        ]

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return (
            isinstance(params, dict)
            and params.get("agent_id") in self._profile_ids()
            and isinstance(params.get("message"), str)
            and bool(params["message"].strip())
            and len(params["message"]) <= 4000
        )

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "enum": self._profile_ids(),
                        "description": "Persistent teammate to contact.",
                    },
                    "message": {
                        "type": "string",
                        "description": "One focused question or request, up to 4000 characters.",
                    },
                },
                "required": ["agent_id", "message"],
            },
            "permission_level": self.permission_level,
            "requires_confirmation": False,
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        return ToolResult(
            success=False,
            output=None,
            error="Subagent messaging requires an active parent task.",
        )

    async def execute_with_context(
        self,
        params: Dict[str, Any],
        *,
        parent_id: str | None,
        parent_credential: str | None,
        conversation_id: str | None = None,
        source_device_id: str | None = None,
    ) -> ToolResult:
        del parent_credential, conversation_id, source_device_id
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="Invalid teammate or message.",
            )
        if not parent_id:
            return ToolResult(
                success=False,
                output=None,
                error="Could not identify the sending subagent.",
            )
        reply = await self.agent_manager.message_agent_from_task(
            parent_id,
            params["agent_id"],
            params["message"],
        )
        return ToolResult(success=True, output=reply)
