"""Unit tests for action validation and platform dispatch."""

from dataclasses import dataclass
from typing import Any

import pytest

from ..actions.executor import DesktopControlError, DesktopExecutor
from ..config.settings import DesktopControlConfig


@dataclass(frozen=True)
class FakeCapture:
    image: bytes = b"image"
    target: str = "monitor"
    bounds: dict[str, int] | None = None


class FakePlatform:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []

    async def click(
        self,
        window_handle: int,
        x: int,
        y: int,
        button: str,
    ) -> None:
        self.calls.append(("click", window_handle, x, y, button))

    async def double_click(self, window_handle: int, x: int, y: int) -> None:
        self.calls.append(("double_click", window_handle, x, y))

    async def right_click(self, window_handle: int, x: int, y: int) -> None:
        self.calls.append(("right_click", window_handle, x, y))

    async def move(self, window_handle: int, x: int, y: int) -> None:
        self.calls.append(("move", window_handle, x, y))

    async def drag(
        self,
        window_handle: int,
        from_x: int,
        from_y: int,
        to_x: int,
        to_y: int,
        duration: float,
    ) -> None:
        self.calls.append(
            ("drag", window_handle, from_x, from_y, to_x, to_y, duration)
        )

    async def type_text(self, window_handle: int, text: str) -> None:
        self.calls.append(("type_text", window_handle, text))

    async def hotkey(self, window_handle: int, shortcut: str) -> None:
        self.calls.append(("hotkey", window_handle, shortcut))

    async def scroll(
        self,
        window_handle: int,
        x: int,
        y: int,
        amount: int,
    ) -> None:
        self.calls.append(("scroll", window_handle, x, y, amount))

    async def open_application(
        self,
        application: str,
        arguments: list[str],
    ) -> dict[str, Any]:
        self.calls.append(("open_application", application, arguments))
        return {"pid": 42, "success": True}

    async def focus_window(self, title: str) -> dict[str, Any]:
        self.calls.append(("focus_window", title))
        return {"window_handle": 42}

    async def list_windows(self) -> list[dict[str, Any]]:
        self.calls.append(("list_windows",))
        return [{"title": "Notepad"}]

    async def capture_monitor(self, monitor_index: int) -> FakeCapture:
        self.calls.append(("capture_monitor", monitor_index))
        return FakeCapture(bounds={"index": monitor_index})

    async def capture_window(self, window_handle: int) -> FakeCapture:
        self.calls.append(("capture_window", window_handle))
        return FakeCapture(target=f"window:{window_handle}")

    async def observe_ui(self, window_handle: int) -> dict[str, Any]:
        self.calls.append(("observe_ui", window_handle))
        return {"elements": [{"element_id": "ui-1", "name": "Save"}]}

    async def click_element(
        self,
        element_id: str,
        window_handle: int,
        target_description: str,
    ) -> dict[str, str]:
        self.calls.append(
            ("click_element", element_id, window_handle, target_description)
        )
        return {"method": "invoke"}

    async def type_into_element(
        self,
        element_id: str,
        window_handle: int,
        text: str,
        target_description: str,
    ) -> dict[str, str]:
        self.calls.append(
            (
                "type_into_element",
                element_id,
                window_handle,
                text,
                target_description,
            )
        )
        return {"method": "value_pattern"}

    def invalidate_ui_snapshot(self) -> None:
        self.calls.append(("invalidate_ui_snapshot",))


class WorkspacePreparingPlatform(FakePlatform):
    async def ensure_dedicated_workspace(self) -> None:
        self.calls.append(("ensure_dedicated_workspace",))


@pytest.fixture
def config() -> DesktopControlConfig:
    return DesktopControlConfig(
        monitor_index=0,
        max_wait_seconds=5,
        max_text_characters=20,
        max_scroll_steps=5,
        mouse_move_duration_ms=100,
        allowed_hotkeys=("ctrl+a", "alt+tab"),
        max_accessibility_elements=100,
        max_accessibility_depth=5,
        accessibility_cache_ttl_ms=500,
    )


@pytest.mark.asyncio
async def test_executor_rejects_physical_mouse_actions_without_dispatch(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    for action in (
        {
            "action": "click",
            "window_handle": 42,
            "x": 12,
            "y": 34,
            "target_description": "Context menu",
        },
        {
            "action": "drag",
            "window_handle": 42,
            "from_x": 1,
            "from_y": 2,
            "to_x": 3,
            "to_y": 4,
            "duration": 0.5,
            "target_description": "File icon",
        },
        {
            "action": "capture_window",
            "window_handle": 42,
        },
    ):
        with pytest.raises(DesktopControlError, match="system cursor"):
            await executor.execute(action)

    assert platform.calls == []


@pytest.mark.asyncio
async def test_executor_rejects_keyboard_input_without_dispatch(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    with pytest.raises(DesktopControlError, match="system cursor"):
        await executor.execute({
            "action": "type_text",
            "window_handle": 42,
            "text": "safe test",
            "target_description": "Notepad document",
        })
    with pytest.raises(DesktopControlError, match="system cursor"):
        await executor.execute({
            "action": "hotkey",
            "window_handle": 42,
            "shortcut": "ctrl+a",
        })

    assert platform.calls == []


@pytest.mark.asyncio
async def test_executor_rejects_keyboard_and_bounds_uia_text(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    with pytest.raises(DesktopControlError, match="system cursor"):
        await executor.execute({
            "action": "hotkey",
            "window_handle": 42,
            "shortcut": "alt+f4",
        })
    with pytest.raises(ValueError, match="maximum length"):
        await executor.execute({
            "action": "type_into_element",
            "window_handle": 42,
            "text": "x" * 21,
            "element_id": "ui-1",
            "target_description": "Notepad document",
        })
    assert platform.calls == []


@pytest.mark.asyncio
async def test_executor_rejects_invalid_shapes_without_dispatch(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    with pytest.raises(ValueError, match="Invalid desktop action"):
        await executor.execute({"action": "click", "x": True, "y": 20})
    with pytest.raises(ValueError, match="Invalid desktop action"):
        await executor.execute({
            "action": "move",
            "window_handle": 42,
            "x": 20,
            "y": 30,
            "unexpected": True,
        })
    assert platform.calls == []


@pytest.mark.asyncio
async def test_executor_bounds_wait_and_scroll(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    with pytest.raises(ValueError, match="configured maximum"):
        await executor.execute({"action": "wait", "seconds": 6.0})
    with pytest.raises(DesktopControlError, match="system cursor"):
        await executor.execute({
            "action": "scroll",
            "window_handle": 42,
            "x": 5,
            "y": 6,
            "direction": "down",
            "amount": 6,
        })
    assert platform.calls == []


@pytest.mark.asyncio
async def test_executor_exposes_window_listing_but_rejects_monitor_capture(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    windows = await executor.execute({"action": "list_windows"})
    with pytest.raises(DesktopControlError, match="desktop capture"):
        await executor.execute({"action": "capture_monitor"})

    assert windows.result == [{"title": "Notepad"}]
    assert platform.calls == [
        ("invalidate_ui_snapshot",),
        ("list_windows",),
    ]


@pytest.mark.asyncio
async def test_executor_prepares_workspace_before_preflight_window_listing(config):
    platform = WorkspacePreparingPlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    await executor.execute({"action": "list_windows"})

    assert platform.calls == [
        ("ensure_dedicated_workspace",),
        ("invalidate_ui_snapshot",),
        ("list_windows",),
    ]


@pytest.mark.asyncio
async def test_executor_dispatches_accessibility_actions_and_invalidates_old_ids(config):
    platform = FakePlatform()
    executor = DesktopExecutor(config=config, platform=platform)

    observed = await executor.execute({
        "action": "observe_ui",
        "window_handle": 42,
    })
    clicked = await executor.execute({
        "action": "click_element",
        "window_handle": 42,
        "element_id": "ui-1",
        "target_description": "Save button",
    })
    typed = await executor.execute({
        "action": "type_into_element",
        "window_handle": 42,
        "element_id": "ui-2",
        "text": "safe test",
        "target_description": "Document name field",
    })

    assert observed.result["elements"][0]["name"] == "Save"
    assert clicked.result == {"method": "invoke"}
    assert typed.result == {"method": "value_pattern"}
    assert platform.calls == [
        ("observe_ui", 42),
        ("click_element", "ui-1", 42, "Save button"),
        ("type_into_element", "ui-2", 42, "safe test", "Document name field"),
    ]
