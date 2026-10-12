import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.agent.core.react_loop import ReActLoop
from services.agent.core.tool_registry import ToolRegistry
from services.agent.tools.base_tool import BaseTool, ToolResult


class CapabilityTool(BaseTool):
    name = "capability_tool"
    description = "test capability tool"
    permission_level = "READ_ONLY"
    requires_confirmation = False
    required_capability = "vision"

    def __init__(self):
        self.executions = 0

    async def execute(self, params):
        self.executions += 1
        return ToolResult(success=True, output="ran")

    def validate_params(self, params):
        return True

    def get_schema(self):
        return {"name": self.name, "description": self.description, "parameters": {}}


class EventBus:
    async def publish(self, *_args, **_kwargs):
        return None


class ReplacedCapabilityTool(CapabilityTool):
    async def execute(self, params):
        self.executions += 1
        return ToolResult(success=True, output="loaded pack")


def make_loop(tool, requester):
    registry = ToolRegistry()
    registry.register_tool(tool)
    loop = ReActLoop(
        None, None, None, registry, None, EventBus(),
        SimpleNamespace(), capability_requester=requester,
    )
    loop._verify_if_important = AsyncMock(side_effect=lambda *args, **_kwargs: args[2])
    return loop


def test_required_capability_is_installed_before_tool_execution():
    tool = CapabilityTool()
    requester = AsyncMock(return_value=True)
    loop = make_loop(tool, requester)

    outcome = asyncio.run(loop.execute_planned_tool("capability_tool", {}))

    requester.assert_awaited_once_with("vision", "capability_tool", None)
    assert tool.executions == 1
    assert outcome.success is True


def test_tool_is_reloaded_from_registry_after_capability_installation():
    stub_tool = CapabilityTool()
    installed_tool = ReplacedCapabilityTool()
    registry = ToolRegistry()
    registry.register_tool(stub_tool)

    async def install_and_register(*_args):
        registry.register_tool(installed_tool)
        return True

    loop = ReActLoop(
        None, None, None, registry, None, EventBus(),
        SimpleNamespace(), capability_requester=install_and_register,
    )
    loop._verify_if_important = AsyncMock(side_effect=lambda *args, **_kwargs: args[2])

    outcome = asyncio.run(loop.execute_planned_tool("capability_tool", {}))

    assert stub_tool.executions == 0
    assert installed_tool.executions == 1
    assert outcome.output == "loaded pack"


def test_failed_capability_installation_never_executes_the_tool():
    tool = CapabilityTool()
    requester = AsyncMock(return_value=False)
    loop = make_loop(tool, requester)

    outcome = asyncio.run(loop.execute_planned_tool("capability_tool", {}))

    assert tool.executions == 0
    assert outcome.success is False
    assert "not installed or verified" in outcome.output


def test_missing_capability_manager_never_executes_required_tool():
    tool = CapabilityTool()
    loop = make_loop(tool, None)

    outcome = asyncio.run(loop.execute_planned_tool("capability_tool", {}))

    assert tool.executions == 0
    assert outcome.success is False
    assert "capability manager is unavailable" in outcome.output
