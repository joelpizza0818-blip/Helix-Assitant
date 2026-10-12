import os
import platform
import shutil
from pathlib import Path
from typing import Any, Dict

from services.agent.plugins.base_plugin import (
    BasePlugin,
    PluginContext,
    PluginMetadata,
)
from services.agent.tools.base_tool import BaseTool, ToolResult


class RuntimeInfoTool(BaseTool):
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
        disk = shutil.disk_usage(Path.home())
        return ToolResult(
            success=True,
            output={
                "system": platform.system(),
                "release": platform.release(),
                "architecture": platform.machine(),
                "processor_count": os.cpu_count(),
                "home_disk_free_bytes": disk.free,
            },
        )


class SystemDiagnosticsPlugin(BasePlugin):
    def get_metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system-diagnostics",
            version="1.0.0",
            description="Read-only local runtime diagnostics.",
            author="HELIX Team",
            dependencies=[],
            permissions=["READ_ONLY"],
        )

    async def initialize(self, context: PluginContext) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    def get_tools(self) -> list[BaseTool]:
        return [RuntimeInfoTool()]
