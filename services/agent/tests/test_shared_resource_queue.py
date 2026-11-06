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


@pytest.mark.asyncio
async def test_browser_frames_are_published_for_desktop_and_cli_sessions_only():
    loop = make_loop()
    received = []
    event_received = asyncio.Event()

    async def capture_frame(_event_name, payload):
        received.append(payload)
        event_received.set()

    await loop.event_bus.subscribe("BROWSER_FRAME", capture_frame)
    result = SimpleNamespace(success=True, output={"screenshot_bytes": b"jpeg"})

    await loop._publish_browser_frame(result, None, "cli_conv_test")
    await asyncio.wait_for(event_received.wait(), timeout=1)
    assert received[0]["conversation_id"] == "cli_conv_test"
    assert received[0]["mime_type"] == "image/jpeg"
    assert received[0]["image_base64"] == "anBlZw=="

    received.clear()
    event_received.clear()
    await loop._publish_browser_frame(
        result, None, "49ef84a4-d9cb-4de0-b62f-0914f785d667"
    )
    await asyncio.wait_for(event_received.wait(), timeout=1)
    assert received[0]["conversation_id"] == "49ef84a4-d9cb-4de0-b62f-0914f785d667"

    received.clear()
    event_received.clear()
    await loop._publish_browser_frame(result, None, "unrelated_desktop_session")
    await asyncio.sleep(0)
    assert received == []


@pytest.mark.asyncio
async def test_mobile_browser_frames_continue_until_request_cleanup():
    loop = make_loop()
    received = []
    two_frames_received = asyncio.Event()

    async def capture_frame(_event_name, payload):
        received.append(payload)
        if len(received) >= 2:
            two_frames_received.set()

    class BrowserTool:
        async def capture_live_frame(self):
            return b"live-jpeg"

    await loop.event_bus.subscribe("BROWSER_FRAME", capture_frame)
    state = {}
    token = loop._browser_live_stream_context.set(state)
    try:
        loop._start_browser_live_stream(
            BrowserTool(),
            "device-0123456789abcdef",
            "mobile_device-0123456789abcdef",
        )
        await asyncio.wait_for(two_frames_received.wait(), timeout=2)
        assert all(
            frame["conversation_id"] == "mobile_device-0123456789abcdef"
            for frame in received
        )
    finally:
        state["task"].cancel()
        with pytest.raises(asyncio.CancelledError):
            await state["task"]
        loop._browser_live_stream_context.reset(token)


@pytest.mark.asyncio
async def test_mobile_browser_stream_stops_when_react_request_finishes():
    loop = make_loop()
    capture_started = asyncio.Event()
    capture_stopped = asyncio.Event()

    class BrowserTool:
        async def capture_live_frame(self):
            capture_started.set()
            try:
                await asyncio.Future()
            finally:
                capture_stopped.set()

    async def execute_inner(**_kwargs):
        loop._start_browser_live_stream(
            BrowserTool(),
            "device-0123456789abcdef",
            "mobile_device-0123456789abcdef",
        )
        await capture_started.wait()
        return "done"

    loop._execute_inner = execute_inner
    result = await loop.execute([], task_id="mobile-task")

    assert result == "done"
    assert capture_stopped.is_set()


@pytest.mark.asyncio
async def test_browser_progress_does_not_expose_typed_text():
    loop = make_loop()
    events = []
    completed = asyncio.Event()

    async def capture_progress(_event_name, payload):
        events.append(payload)
        if payload["status"] == "completed":
            completed.set()

    class BrowserTool:
        name = "browser_control"

        async def execute(self, _arguments):
            return SimpleNamespace(success=True, output={"screenshot_bytes": b"jpeg"})

    await loop.event_bus.subscribe("BROWSER_PROGRESS", capture_progress)
    await loop._execute_tool(
        BrowserTool(),
        {"action": "type", "text": "private form contents"},
        "task-1",
        {"_helix_conversation_id": "49ef84a4-d9cb-4de0-b62f-0914f785d667"},
    )
    await asyncio.wait_for(completed.wait(), timeout=1)

    assert [event["status"] for event in events] == ["running", "completed"]
    assert events[0]["action"] == "Entering text in a page field"
    assert all("private form contents" not in repr(event) for event in events)
