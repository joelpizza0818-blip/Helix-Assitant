from pathlib import Path
from types import SimpleNamespace

import pytest
from services.agent.core.role_config import RoleConfig, RoleAssignment
from services.agent.core.tool_registry import ToolRegistry
from services.agent.core.context_manager import ContextManager
from services.agent.core.planner import Planner
from services.agent.ai.base_provider import ChatMessage

def test_role_config():
    config = RoleConfig()
    assignment = config.get_assignment("coding")
    assert assignment.role == "coding"
    assert assignment.requirements.coding is True

    config.set_assignment("coding", provider="openai", model="gpt-4o")
    updated = config.get_assignment("coding")
    assert updated.provider == "openai"
    assert updated.model == "gpt-4o"

def test_tool_registry():
    registry = ToolRegistry()
    tools = registry.get_all_tools()
    assert isinstance(tools, list)


def test_tool_registry_filters_external_tools_by_relevance_but_keeps_native_tools():
    registry = ToolRegistry()
    native_tool = SimpleNamespace(
        name="filesystem_tool",
        description="Search files on disk",
        get_schema=lambda: {
            "name": "filesystem_tool",
            "description": "Search files on disk",
            "parameters": {},
        },
    )
    github_search = SimpleNamespace(
        name="github_search_issues",
        description="Search issues in GitHub repositories",
        get_schema=lambda: {
            "name": "github_search_issues",
            "description": "Search issues in GitHub repositories",
            "parameters": {},
        },
    )
    weather = SimpleNamespace(
        name="weather_lookup",
        description="Look up local weather forecasts",
        get_schema=lambda: {
            "name": "weather_lookup",
            "description": "Look up local weather forecasts",
            "parameters": {},
        },
    )
    registry.register_tool(native_tool)
    registry.register_tool(github_search, source="mcp")
    registry.register_tool(weather, source="plugin")

    schemas = registry.get_tool_schemas("Search GitHub issues")

    assert {schema["name"] for schema in schemas} == {
        "filesystem_tool",
        "github_search_issues",
    }


def test_tool_registry_lists_tools_from_a_requested_source():
    registry = ToolRegistry()
    mcp_tool = SimpleNamespace(name="github_search", server_name="github")
    plugin_tool = SimpleNamespace(name="plugin_search")
    registry.register_tool(mcp_tool, source="mcp")
    registry.register_tool(plugin_tool, source="plugin")

    assert registry.get_tools_by_source("mcp") == [mcp_tool]


def test_tool_registry_caps_external_candidates_when_no_relevance_match_exists():
    registry = ToolRegistry()
    for index in range(12):
        name = f"remote_tool_{index}"
        registry.register_tool(
            SimpleNamespace(
                name=name,
                description=f"External integration {index}",
                get_schema=lambda name=name: {
                    "name": name,
                    "description": "External integration",
                    "parameters": {},
                },
            ),
            source="mcp",
        )

    schemas = registry.get_tool_schemas("unmatched request")

    assert len(schemas) == 8


def test_tool_registry_discovers_desktop_tools():
    registry = ToolRegistry()
    tools_dir = Path(__file__).resolve().parents[1] / "tools"

    registry.auto_discover(str(tools_dir))

    assert registry.get_tool("computer.click_element") is not None
    assert registry.get_tool("keyboard.press_key") is not None

def test_context_manager():
    cm = ContextManager(
        max_tokens=1000,
        tool_registry=SimpleNamespace(
            get_tool=lambda name: SimpleNamespace(default_shell_type="wsl")
            if name == "shell_tool"
            else None
        ),
    )
    assert "Runtime OS:" in cm.get_system_prompt("main")
    if "Runtime OS: Windows" in cm.get_system_prompt("main"):
        assert "WSL Bash" in cm.get_system_prompt("main")
    cm.add_message("conv_1", ChatMessage(role="user", content="Hello"))
    msgs = cm.get_messages("conv_1")
    assert len(msgs) == 1
    assert msgs[0].content == "Hello"

    cm.fork("conv_1", "conv_2")
    forked_msgs = cm.get_messages("conv_2")
    assert len(forked_msgs) == 1
    assert forked_msgs[0].content == "Hello"


def test_planner_prompt_includes_os_and_direct_action_guidance():
    planner = Planner(
        react_loop=None,
        role_config=None,
        tool_registry=ToolRegistry(),
    )

    prompt = planner._build_planning_prompt("Show the current directory", [], {})

    assert "Runtime OS:" in prompt
    assert "shortest reliable path" in prompt
