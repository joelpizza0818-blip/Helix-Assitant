import logging
from typing import Dict, List, Optional

try:
    from services.agent.tools.base_tool import BaseTool
except ImportError:  # Frozen and standalone entry points use a different package root.
    from tools.base_tool import BaseTool

try:
    from services.agent.core.tool_discovery import discover_native_tools
    from services.agent.core.tool_registry_selection import (
        _tool_terms,
        normalize_tool_schema,
        select_tool_candidates,
    )
except ImportError:
    from core.tool_discovery import discover_native_tools
    from core.tool_registry_selection import (
        _tool_terms,
        normalize_tool_schema,
        select_tool_candidates,
    )

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Store tools, resolve their sources, and expose model-ready tool schemas."""

    def __init__(self):
        """Create an empty registry with a parallel source index."""
        self._tools: Dict[str, 'BaseTool'] = {}
        self._tool_sources: Dict[str, str] = {}

    def register_tool(self, tool: 'BaseTool', source: str = "native"):
        """Register or replace a tool and associate it with its origin."""
        self._tools[tool.name] = tool
        self._tool_sources[tool.name] = source

    def get_tool(self, name: str) -> Optional['BaseTool']:
        """Return one registered tool by name, or ``None`` when it is absent."""
        return self._tools.get(name)

    def unregister_tool(self, name: str) -> None:
        """Remove a tool and its source metadata when it exists."""
        self._tools.pop(name, None)
        self._tool_sources.pop(name, None)

    def get_all_tools(self) -> List['BaseTool']:
        """Return the registered tools in insertion order."""
        return list(self._tools.values())

    def get_tools_by_source(self, source: str) -> List['BaseTool']:
        """Return tools registered under the requested source identifier."""
        return [
            tool
            for name, tool in self._tools.items()
            if self._tool_sources.get(name) == source
        ]

    def get_tools_for_capability(self, capability: str) -> List['BaseTool']:
        """Find tools whose name or description mentions a capability."""
        return [t for t in self._tools.values() if capability.lower() in t.description.lower() or capability.lower() in t.name.lower()]

    def get_tool_schemas(
        self,
        query: Optional[str] = None,
        preferred_tool_names: Optional[List[str]] = None,
        max_external_tools: int = 8,
    ) -> List[dict]:
        """Return native schemas plus query-ranked, bounded external schemas."""
        candidates = select_tool_candidates(
            list(self._tools.items()),
            self._tool_sources,
            query,
            preferred_tool_names,
            max_external_tools,
        )
        return [normalize_tool_schema(tool) for _name, tool in candidates]

    def auto_discover(self, tools_dir: str):
        """Discover constructible tool classes under the configured tools folder."""
        discover_native_tools(self, tools_dir)
