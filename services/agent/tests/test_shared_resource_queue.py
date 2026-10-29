import asyncio
from types import SimpleNamespace

import pytest

from services.agent.core.event_bus import EventBus
from services.agent.core.react_loop import ReActLoop


class SharedResourceTool:
    def __init__(self, name, barrier=None):
        self.name = name
        self.barrier = barrier
        self.active = 0
        self.max_active = 0

    async def execute(self, _arguments):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        if self.barrier is not None:
            await self.barrier.wait()
        await asyncio.sleep(0.01)
        self.active -= 1
        return SimpleNamespace(success=True, output="done")


def make_loop():
    return ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=None,
        key_manager=None,
        event_bus=EventBus(),
        role_config=None,
    )


@pytest.mark.asyncio
async def test_agents_wait_for_the_same_browser_resource():
    loop = make_loop()
    tool = SharedResourceTool("browser_control")

    await asyncio.gather(
        loop._execute_tool(tool, {}, "agent-one", {}),
        loop._execute_tool(tool, {}, "agent-two", {}),
    )

    assert tool.max_active == 1


@pytest.mark.asyncio
async def test_agents_can_use_independent_resources_in_parallel():
    loop = make_loop()
    active = 0
    max_active = 0
    barrier = asyncio.Event()

    class ParallelTool:
        def __init__(self, name):
            self.name = name

        async def execute(self, _arguments):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            if active == 2:
                barrier.set()
            await asyncio.wait_for(barrier.wait(), timeout=1)
            active -= 1
            return SimpleNamespace(success=True, output="done")

    await asyncio.gather(
        loop._execute_tool(ParallelTool("browser_control"), {}, "browser-agent", {}),
        loop._execute_tool(ParallelTool("powershell_tool"), {}, "workspace-agent", {}),
    )

    assert max_active == 2
