from services.agent.core.tool_registry import ToolRegistry


class FakeTool:
    def __init__(
        self,
        name: str,
        description: str,
        schema: dict | None = None,
        required_capability: str | None = None,
    ) -> None:
        """Create a registry-compatible tool double for selection tests."""
        self.name = name
        self.description = description
        self._schema = schema or {}
        self.required_capability = required_capability

    def get_schema(self) -> dict:
        """Return the schema configured by the test case."""
        return self._schema


def test_registry_tracks_tool_source_and_removes_source_on_unregister():
    """Keep the tool map and source index consistent through registration changes."""
    registry = ToolRegistry()
    native = FakeTool("open_file", "Open a local file.")
    external = FakeTool("remote_search", "Search remote notes.")

    registry.register_tool(native)
    registry.register_tool(external, source="mcp")

    assert registry.get_tool("open_file") is native
    assert registry.get_tools_by_source("native") == [native]
    assert registry.get_tools_by_source("mcp") == [external]
    assert registry.get_tools_for_capability("remote") == [external]
    assert registry.get_all_tools() == [native, external]

    registry.unregister_tool("remote_search")

    assert registry.get_tool("remote_search") is None
    assert registry.get_tools_by_source("mcp") == []


def test_registry_keeps_native_tools_and_ranks_external_tools_for_query():
    """Retain local tools while excluding unrelated external tools from schemas."""
    registry = ToolRegistry()
    native = FakeTool("shell", "Run a local command.")
    matching = FakeTool("notes_search", "Search and find project files.")
    unrelated = FakeTool("weather", "Get a forecast.")
    registry.register_tool(native)
    registry.register_tool(matching, source="mcp")
    registry.register_tool(unrelated, source="plugin")

    schemas = registry.get_tool_schemas("find a file")

    assert [schema["name"] for schema in schemas] == ["shell", "notes_search"]


def test_registry_prefers_requested_external_tool_and_normalizes_schema():
    """Honor preferred tool names and preserve normalized capability metadata."""
    registry = ToolRegistry()
    preferred = FakeTool(
        "vault_notes",
        "Read configured project context.",
        schema={
            "name": "custom_name",
            "description": "Custom schema description.",
            "parameters": {"type": "object"},
        },
        required_capability="vault.read",
    )
    registry.register_tool(preferred, source="mcp")

    schemas = registry.get_tool_schemas(
        "summarize the application",
        preferred_tool_names=["vault_notes"],
    )

    assert schemas == [
        {
            "name": "custom_name",
            "description": "Custom schema description.",
            "parameters": {"type": "object"},
            "x-helix-required-capability": "vault.read",
        }
    ]


def test_schema_without_parameters_uses_the_schema_as_parameters():
    """Use a flat schema as its parameter block when no nested block is present."""
    registry = ToolRegistry()
    tool = FakeTool(
        "simple",
        "A simple tool.",
        schema={"type": "object", "properties": {"value": {"type": "string"}}},
    )
    registry.register_tool(tool)

    assert registry.get_tool_schemas()[0]["parameters"] == tool.get_schema()


def test_schema_normalization_does_not_expose_empty_capabilities():
    """Omit the optional capability extension when a tool declares no value."""
    registry = ToolRegistry()
    registry.register_tool(FakeTool("plain", "A plain tool.", required_capability=""))

    assert "x-helix-required-capability" not in registry.get_tool_schemas()[0]
