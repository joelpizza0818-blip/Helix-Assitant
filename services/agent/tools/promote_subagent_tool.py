from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


class PromoteSubagentTool(BaseTool):
    """Propose a bounded, user-visible expansion of a teammate's declared scope."""

    def __init__(self, agent_manager):
        self.agent_manager = agent_manager

    @property
    def name(self) -> str:
        return "promote_subagent"

    @property
    def description(self) -> str:
        return (
            "Promote a saved teammate by adding a narrowly scoped work area and "
            "capability labels. This changes profile metadata only; it does not "
            "silently grant tools or permissions. Use sparingly when repeated work "
            "shows the role is missing a durable responsibility."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

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
            and isinstance(params.get("work"), str)
            and bool(params["work"].strip())
            and isinstance(params.get("capabilities"), list)
            and 1 <= len(params["capabilities"]) <= 5
            and all(isinstance(item, str) and item.strip() for item in params["capabilities"])
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
                    },
                    "work": {
                        "type": "string",
                        "description": "One concise new responsibility, at most 200 characters.",
                    },
                    "capabilities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "One to five declarative capability labels; this does not add permissions.",
                    },
                },
                "required": ["agent_id", "work", "capabilities"],
            },
            "permission_level": self.permission_level,
            "requires_confirmation": False,
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        return ToolResult(
            success=False,
            output=None,
            error="Subagent promotion requires an active parent task.",
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
            return ToolResult(success=False, output=None, error="Invalid promotion request.")
        if not parent_id:
            return ToolResult(
                success=False,
                output=None,
                error="Could not identify the proposing parent task.",
            )
        if self.agent_manager.is_subagent_task(parent_id):
            return ToolResult(
                success=False,
                output=None,
                error="Only the main HELIX agent can promote teammate profiles.",
            )
        profile = await self.agent_manager.promote_profile(
            params["agent_id"],
            params["work"],
            params["capabilities"],
        )
        return ToolResult(
            success=True,
            output={
                "profile_id": profile["profile_id"],
                "name": profile["name"],
                "promotion": params["work"].strip(),
            },
        )
