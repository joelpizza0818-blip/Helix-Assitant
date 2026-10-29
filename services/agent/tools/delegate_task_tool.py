from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


class DelegateTaskTool(BaseTool):
    """Delegate a bounded task to a HELIX-managed child agent."""

    def __init__(self, agent_manager, key_manager):
        self.agent_manager = agent_manager
        self.key_manager = key_manager

    def _profiles(self):
        store = getattr(self.agent_manager, "profile_store", None)
        return store.list_profiles() if store is not None else []

    @property
    def name(self) -> str:
        return "delegate_task"

    @property
    def description(self) -> str:
        return (
            "Delegate a bounded task to a persistent HELIX teammate. Choose an "
            "existing profile by agent_id when its specialty fits. Create new_agent "
            "only when no existing profile is suitable; the model chooses a name "
            "and narrowly scoped capabilities. Independent tasks may run in parallel."
        )

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        valid_base = (
            isinstance(params, dict)
            and isinstance(params.get("task"), str)
            and bool(params["task"].strip())
            and len(params["task"]) <= 4000
            and params.get("role", "research")
            in {"research", "coding", "planning", "automation", "analysis", "general", "main"}
        )
        if not valid_base:
            return False
        if (
            self._profiles()
            and params.get("agent_id") is None
            and params.get("new_agent") is None
        ):
            return False
        if params.get("agent_id") is not None and (
            not isinstance(params["agent_id"], str)
            or params["agent_id"] not in {
                profile.profile_id
                for profile in self._profiles()
            }
        ):
            return False
        new_profile = params.get("new_agent")
        if new_profile is not None:
            if not isinstance(new_profile, dict):
                return False
            if not isinstance(new_profile.get("name"), str) or not new_profile["name"].strip():
                return False
            if new_profile.get("role") not in {
                "planning", "coding", "automation", "research", "analysis", "general"
            }:
                return False
            if not isinstance(new_profile.get("description"), str) or not new_profile["description"].strip():
                return False
            if not isinstance(new_profile.get("capabilities"), list):
                return False
            if not isinstance(new_profile.get("color"), str):
                return False
            if params.get("agent_id") is not None:
                return False
        return True

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
                        "enum": ["research", "coding", "planning", "automation", "analysis", "general", "main"],
                        "description": "Fallback task role when no saved profile is selected.",
                    },
                    "agent_id": {
                        "type": "string",
                        "enum": [
                            profile.profile_id
                            for profile in self._profiles()
                        ],
                        "description": "Existing profile best suited to this task.",
                    },
                    "new_agent": {
                        "type": "object",
                        "description": "Create a persistent teammate only if no saved profile is suitable.",
                        "properties": {
                            "name": {"type": "string"},
                            "role": {
                                "type": "string",
                                "enum": ["planning", "coding", "automation", "research", "analysis", "general"],
                            },
                            "description": {"type": "string"},
                            "capabilities": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "color": {
                                "type": "string",
                                "enum": ["#ee6018", "#02b8cc", "#8b5cf6", "#a0ca92"],
                            },
                        },
                        "required": ["name", "role", "description", "capabilities", "color"],
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
        conversation_id: str | None = None,
        source_device_id: str | None = None,
    ) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error=(
                    "Invalid delegation. Choose a saved agent_id or define "
                    "new_agent when no saved specialty fits."
                ),
            )
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
            profile_id=params.get("agent_id"),
            new_profile=params.get("new_agent"),
            parent_id=parent_id,
            context={
                "input_source": "subagent delegation",
                **(
                    {
                        "conversation_id": conversation_id,
                        "source_device_id": source_device_id,
                    }
                    if isinstance(source_device_id, str)
                    else {}
                ),
            },
            excluded_api_keys=excluded_api_keys,
        )
        result = await handle
        if result.get("status") != "success":
            return ToolResult(
                success=False,
                output=result.get("error") or "The delegated child agent did not complete.",
                error=result.get("error") or "The delegated child agent did not complete.",
            )
        output = {
            "agent_id": result["agent_id"],
            "status": "completed",
            "result": result.get("result"),
        }
        for key in ("profile_id", "name", "color"):
            if result.get(key) is not None:
                output[key] = result[key]
        return ToolResult(
            success=True,
            output=output,
        )
