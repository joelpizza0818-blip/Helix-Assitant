from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from ..platform.windows import WindowsDesktopPlatform
from services.agent.perception.screen_observation_policy import (
    screen_observation_scope,
)


class FakeVirtualDesktop:
    def __init__(self, events):
        self.events = events

    def ensure_dedicated(self):
        return SimpleNamespace(id="helix-desktop")

    def window_desktop_id(self, window_handle):
        self.events.append(("window_desktop_id", window_handle))
        return "helix-desktop"

    def move_window(self, window_handle):
        self.events.append(("move_window", window_handle))
        return "helix-desktop"

    def enter_window_desktop(self, window_handle):
        self.events.append(("enter_window_desktop", window_handle))
        return "user-desktop"

    def restore_desktop(self, desktop_id):
        self.events.append(("restore_desktop", desktop_id))


class FakeUIAutomation:
    def __init__(self, events):
        self.events = events

    def observe(self, window_handle, title):
        self.events.append(("observe", window_handle, title))
        return {
            "window": {"hwnd": window_handle, "title": title},
            "elements": [{"element_id": "ui-1"}],
        }

    def click_element(self, window_handle, element_id):
        self.events.append(("click_element", window_handle, element_id))
        return "invoke"

    def set_value(self, window_handle, element_id, text):
        self.events.append(("set_value", window_handle, element_id, text))


class FakeWindows:
    def __init__(self, events):
        self.events = events

    async def focus_window(self, window_handle):
        self.events.append(("focus_window", window_handle))


def _platform(events):
    platform = WindowsDesktopPlatform.__new__(WindowsDesktopPlatform)
    platform._virtual_desktop = FakeVirtualDesktop(events)
    platform._owned_windows = {42: 4242}
    platform._ui_automation = FakeUIAutomation(events)
    platform._window_title = lambda _window_handle: "Notepad"
    platform._window_process_id = lambda _window_handle: 4242
    platform._windows = FakeWindows(events)
    return platform


@pytest.mark.asyncio
async def test_observe_ui_uses_uia_without_moving_or_switching_desktops():
    events = []
    platform = _platform(events)

    with screen_observation_scope(True):
        snapshot = await platform.observe_ui(42)

    assert snapshot["window"]["virtual_desktop_id"] == "helix-desktop"
    assert ("observe", 42, "Notepad") in events
    assert not any(
        event[0] in {"move_window", "enter_window_desktop", "restore_desktop"}
        for event in events
    )


@pytest.mark.asyncio
async def test_observe_ui_failure_does_not_switch_desktops():
    events = []
    platform = _platform(events)

    def fail_observe(_window_handle, _title):
        raise RuntimeError("UIA unavailable")

    platform._ui_automation.observe = fail_observe

    with screen_observation_scope(True):
        with pytest.raises(RuntimeError, match="UIA unavailable"):
            await platform.observe_ui(42)

    assert not any(
        event[0] in {"move_window", "enter_window_desktop", "restore_desktop"}
        for event in events
    )


@pytest.mark.asyncio
async def test_click_element_uses_uia_in_background_without_switching():
    events = []
    platform = _platform(events)

    with screen_observation_scope(True):
        result = await platform.click_element("ui-1", 42, "Save button")

    assert result["method"] == "invoke"
    assert result["virtual_desktop_id"] == "helix-desktop"
    assert ("click_element", 42, "ui-1") in events
    assert not any(
        event[0] in {"move_window", "enter_window_desktop", "restore_desktop"}
        for event in events
    )


@pytest.mark.asyncio
async def test_value_pattern_uses_uia_in_background_without_keyboard_fallback():
    events = []
    platform = _platform(events)

    with screen_observation_scope(True):
        result = await platform.type_into_element(
            "ui-2",
            42,
            "safe text",
            "Document field",
        )

    assert result["method"] == "value_pattern"
    assert ("set_value", 42, "ui-2", "safe text") in events
    assert not any(
        event[0] in {"focus_window", "enter_window_desktop", "restore_desktop"}
        for event in events
    )


@pytest.mark.parametrize(
    ("method", "args"),
    [
        ("click", (42, 20, 30, "left")),
        ("double_click", (42, 20, 30)),
        ("right_click", (42, 20, 30)),
        ("move", (42, 20, 30)),
        ("drag", (42, 20, 30, 40, 50, 0.2)),
        ("type_text", (42, "unsafe fallback")),
        ("hotkey", (42, "ctrl+a")),
        ("scroll", (42, 20, 30, 1)),
        ("capture_monitor", (0,)),
        ("capture_window", (42,)),
    ],
)
@pytest.mark.asyncio
async def test_visual_actions_are_rejected_without_system_input(method, args):
    events = []
    platform = _platform(events)

    with pytest.raises(PermissionError, match="desktop capture are disabled"):
        await getattr(platform, method)(*args)

    assert events == []


@pytest.mark.asyncio
async def test_open_application_moves_only_a_new_window_without_activating():
    events = []
    platform = _platform(events)
    existing = SimpleNamespace(
        hwnd=7,
        pid=70,
        visible=True,
        is_minimized=False,
        rect=SimpleNamespace(width=800, height=600),
        title="User Notepad",
    )
    launched = SimpleNamespace(
        hwnd=8,
        pid=80,
        visible=True,
        is_minimized=False,
        rect=SimpleNamespace(width=400, height=300),
        title="HELIX Notepad",
    )

    class FakeWindowList:
        def __init__(self):
            self.calls = 0

        async def list_windows(self, visible_only=False):
            self.calls += 1
            return [existing] if self.calls == 1 else [existing, launched]

    class FakeApplication:
        async def open_application(self, application, arguments, *, activate):
            events.append(("open_application", application, arguments, activate))
            @dataclass
            class Launch:
                pid: int
                success: bool
                error: str | None

            return Launch(pid=80, success=True, error=None)

    platform._windows = FakeWindowList()
    platform._application = FakeApplication()
    platform._move_new_window_without_activation = (
        lambda window_handle: events.append(("move_new_window", window_handle))
        or "helix-desktop"
    )
    platform._owned_windows = {}

    result = await platform.open_application("notepad.exe", [])

    assert result["window_handle"] == 8
    assert ("open_application", "notepad.exe", [], False) in events
    assert ("move_new_window", 8) in events
    assert not any(
        event == ("move_new_window", 7)
        or event == ("move_window", 7)
        for event in events
    )
    assert platform._owned_windows == {8: 80}
