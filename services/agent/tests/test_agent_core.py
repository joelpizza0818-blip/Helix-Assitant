from pathlib import Path

import pytest
from services.agent.core.role_config import RoleConfig, RoleAssignment
from services.agent.core.tool_registry import ToolRegistry
from services.agent.core.context_manager import ContextManager
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


def test_tool_registry_discovers_desktop_tools():
    registry = ToolRegistry()
    tools_dir = Path(__file__).resolve().parents[1] / "tools"

    registry.auto_discover(str(tools_dir))

    assert registry.get_tool("computer.click_element") is not None
    assert registry.get_tool("keyboard.press_key") is not None

def test_context_manager():
    cm = ContextManager(max_tokens=1000)
    cm.add_message("conv_1", ChatMessage(role="user", content="Hello"))
    msgs = cm.get_messages("conv_1")
    assert len(msgs) == 1
    assert msgs[0].content == "Hello"

    cm.fork("conv_1", "conv_2")
    forked_msgs = cm.get_messages("conv_2")
    assert len(forked_msgs) == 1
    assert forked_msgs[0].content == "Hello"
