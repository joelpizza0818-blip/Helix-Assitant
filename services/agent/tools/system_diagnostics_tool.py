from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


class SystemDiagnosticsTool(BaseTool):
    @property
    def name(self) -> str:
        return "system_diagnostics.get_runtime_info"

    @property
    def description(self) -> str:
        return "Get operating system, architecture, processor count, and available disk space."

    @property
    def required_capability(self) -> str:
        return "system-diagnostics"

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return not params

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {"type": "object", "properties": {}, "required": []},
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        return ToolResult(
            success=False,
            output=None,
            error="The signed system diagnostics capability pack did not replace its core loader.",
        )
