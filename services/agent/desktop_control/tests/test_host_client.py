import asyncio
import sys
from types import SimpleNamespace

import pytest

from services.agent.desktop_control.host.client import (
    HostDesktopActionError,
    HostDesktopClient,
    HostDesktopUnavailable,
)
from services.agent.desktop_control.perception.ui_automation import (
    UIAutomationError,
    UIAutomationPatternUnavailable,
)


class FakePyAutoGUI:
    KEYBOARD_KEYS = [
        "enter",
        "esc",
        "tab",
        "a",
        "c",
        "v",
        "ctrl",
        "shift",
        "alt",
        "win",
    ]

    def __init__(self) -> None:
        self.calls = []

    def moveTo(self, *args, **kwargs):
        self.calls.append(("moveTo", args, kwargs))

    def click(self, *args, **kwargs):
        self.calls.append(("click", args, kwargs))

    def doubleClick(self, *args, **kwargs):
        self.calls.append(("doubleClick", args, kwargs))

    def rightClick(self, *args, **kwargs):
        self.calls.append(("rightClick", args, kwargs))

    def dragTo(self, *args, **kwargs):
        self.calls.append(("dragTo", args, kwargs))

    def write(self, *args, **kwargs):
        self.calls.append(("write", args, kwargs))

    def press(self, *args, **kwargs):
        self.calls.append(("press", args, kwargs))

    def hotkey(self, *args, **kwargs):
        self.calls.append(("hotkey", args, kwargs))

    def scroll(self, *args, **kwargs):
        self.calls.append(("scroll", args, kwargs))

    def hscroll(self, *args, **kwargs):
        self.calls.append(("hscroll", args, kwargs))


def build_host(monkeypatch, *, platform: str = "win32"):
    host = HostDesktopClient(platform=platform)
    host.configure({"computer_use_host_consent": True})
    fake = FakePyAutoGUI()
    monkeypatch.setattr(host, "_require_pyautogui", lambda: fake)
    monkeypatch.setattr(
        host,
        "_monitor_bounds",
        lambda: {"left": 100, "top": 50, "width": 800, "height": 600},
    )
    monkeypatch.setattr(
        host,
        "_capture_window",
        lambda _hwnd: {
            "screenshot_bytes": b"frame",
            "mime_type": "image/jpeg",
            "capture_bounds": {"x": 100, "y": 50, "width": 800, "height": 600},
        },
    )
    return host, fake


def test_host_control_rejects_non_windows_platforms():
    host = HostDesktopClient(platform="linux")

    with pytest.raises(HostDesktopUnavailable):
        asyncio.run(host.execute("screenshot"))


def test_host_click_uses_monitor_offset_and_right_button(monkeypatch):
    host, fake = build_host(monkeypatch)

    result = asyncio.run(
        host.execute("click", x=10, y=20, button=3)
    )

    assert ("click", (110, 70), {"button": "right"}) in fake.calls
    assert result["desktop_backend"] == "windows_host"
    assert result["capture_source"] == "windows_host"
    assert "screenshot_bytes" not in result
    assert result["clicked"] is True
    assert result["x"] == 10
    assert result["y"] == 20


def test_host_click_scales_screenshot_pixels_to_the_native_screen(monkeypatch):
    host, fake = build_host(monkeypatch)
    monkeypatch.setattr(
        host,
        "_monitor_bounds",
        lambda: {"left": 0, "top": 0, "width": 1920, "height": 1080},
    )

    asyncio.run(host.execute("click", x=800, y=450, button=1))

    assert ("click", (960, 540), {"button": "left"}) in fake.calls


def test_host_drag_validates_and_moves_between_points(monkeypatch):
    host, fake = build_host(monkeypatch)

    result = asyncio.run(
        host.execute(
            "drag",
            from_x=0,
            from_y=0,
            to_x=200,
            to_y=100,
            duration=1.0,
        )
    )

    assert ("moveTo", (100, 50), {}) in fake.calls
    assert ("dragTo", (300, 150), {"duration": 1.0, "button": "left"}) in fake.calls
    assert result["dragged"] is True


def test_host_type_writes_ascii_lines_and_presses_enter(monkeypatch):
    host, fake = build_host(monkeypatch)

    asyncio.run(host.execute("type", text="first line\nsecond line"))

    assert ("write", ("first line",), {"interval": 0.03}) in fake.calls
    assert ("write", ("second line",), {"interval": 0.03}) in fake.calls
    assert ("press", ("enter",), {}) in fake.calls


def test_host_key_maps_common_aliases(monkeypatch):
    host, fake = build_host(monkeypatch)

    asyncio.run(host.execute("key", key="ctrl+return"))

    assert ("hotkey", ("ctrl", "enter"), {}) in fake.calls


def test_host_scroll_and_invalid_inputs_are_rejected(monkeypatch):
    host, fake = build_host(monkeypatch)

    asyncio.run(host.execute("scroll", direction="down", amount=4))

    assert ("scroll", (-4,), {}) in fake.calls
    with pytest.raises(HostDesktopActionError):
        asyncio.run(host.execute("scroll", direction="down", amount=0))
    with pytest.raises(HostDesktopActionError):
        asyncio.run(host.execute("click", x=1, y=1, button=9))


def test_host_configuration_clamps_and_defers_input_settings(monkeypatch):
    host = HostDesktopClient(platform="linux")
    host.configure({
        "display_index": 2,
        "mouse_move_duration_ms": 99_999,
        "keystroke_delay_ms": -10,
        "pyautogui_fail_safe": False,
    })

    assert host._display_index == 2
    assert host._move_duration_ms == 2000
    assert host._keystroke_delay_ms == 0
    assert host._fail_safe is False


def test_host_input_is_rejected_without_recorded_consent(monkeypatch):
    host, fake = build_host(monkeypatch)
    host.configure({"computer_use_host_consent": False})

    with pytest.raises(HostDesktopActionError, match="allow physical-input fallback"):
        asyncio.run(host.execute("click", x=10, y=20, button=1))

    assert not any(call[0] == "click" for call in fake.calls)


def test_stale_accessibility_click_never_falls_back_to_physical_input(monkeypatch):
    host, _ = build_host(monkeypatch)
    physical_clicks = []

    class StaleElement:
        def element_info(self, _hwnd, _element_id):
            return {
                "name": "Save",
                "bounding_box": {"x": 120, "y": 70, "width": 20, "height": 20},
            }

        def click_element(self, _hwnd, _element_id):
            raise UIAutomationError("The UI Automation element ID is stale.")

    host._ui_automation = StaleElement()
    monkeypatch.setattr(host, "_resolve_window", lambda _handle: (42, "Editor"))
    monkeypatch.setattr(
        host,
        "_click_native",
        lambda *args: physical_clicks.append(args),
    )

    with pytest.raises(HostDesktopActionError, match="did not use physical input"):
        asyncio.run(host.execute("click_element", window_handle=42, element_id="ui-1-2"))

    assert physical_clicks == []


def test_unavailable_invoke_pattern_uses_consented_physical_fallback(monkeypatch):
    host, _ = build_host(monkeypatch)
    physical_clicks = []

    class NoInvokePattern:
        def element_info(self, _hwnd, _element_id):
            return {
                "name": "Custom button",
                "bounding_box": {"x": 120, "y": 70, "width": 20, "height": 20},
            }

        def click_element(self, _hwnd, _element_id):
            raise UIAutomationPatternUnavailable("Invoke pattern unavailable.")

    host._ui_automation = NoInvokePattern()
    monkeypatch.setattr(host, "_resolve_window", lambda _handle: (42, "Editor"))
    monkeypatch.setattr(
        host,
        "_click_native",
        lambda *args: physical_clicks.append(args),
    )

    result = asyncio.run(
        host.execute("click_element", window_handle=42, element_id="ui-1-2")
    )

    assert result["method"] == "physical_fallback"
    assert physical_clicks == [(130, 80, "left")]


def test_host_window_inventory_does_not_capture_monitor(monkeypatch):
    host, _ = build_host(monkeypatch)
    monkeypatch.setattr(
        host,
        "_list_windows_sync",
        lambda: {"windows": [{"window_handle": 42, "title": "Editor"}]},
    )
    monkeypatch.setattr(
        host,
        "_capture_window",
        lambda _hwnd: pytest.fail("Window inventory must not capture an image."),
    )

    result = asyncio.run(host.execute("windows"))

    assert result["windows"] == [{"window_handle": 42, "title": "Editor"}]
    assert "screenshot_bytes" not in result


def test_host_screenshot_captures_only_the_requested_window(monkeypatch):
    host, _ = build_host(monkeypatch)
    captured = []
    monkeypatch.setattr(host, "_resolve_window", lambda handle: (handle, "Editor"))
    monkeypatch.setattr(
        host,
        "_capture_window",
        lambda handle: captured.append(handle) or {
            "screenshot_bytes": b"window-frame",
            "coordinate_space": "window_local",
        },
    )

    result = asyncio.run(host.execute("screenshot", window_handle=42))

    assert captured == [42]
    assert result["screenshot_bytes"] == b"window-frame"
    assert result["window_handle"] == 42
    assert result["window_title"] == "Editor"
    assert result["coordinate_space"] == "window_local"


def test_host_window_resolution_rejects_helix_interface_windows(monkeypatch):
    fake_gui = SimpleNamespace(
        IsWindow=lambda _hwnd: True,
        GetWindowText=lambda _hwnd: "HELIX Toolbox",
    )
    monkeypatch.setitem(sys.modules, "win32gui", fake_gui)

    with pytest.raises(HostDesktopActionError, match="HELIX interface windows"):
        HostDesktopClient._resolve_window(42)


def test_print_window_capture_uses_target_hwnd_without_monitor_fallback(monkeypatch):
    calls = []

    class FakeDC:
        def CreateCompatibleDC(self):
            return FakeDC()

        def SelectObject(self, _bitmap):
            pass

        def GetSafeHdc(self):
            return 23

        def DeleteDC(self):
            pass

    class FakeBitmap:
        def CreateCompatibleBitmap(self, _dc, width, height):
            self.size = (width, height)

        def GetBitmapBits(self, _signed):
            width, height = self.size
            return b"\x00\x00\x00\x00" * width * height

        def GetHandle(self):
            return 24

    fake_gui = SimpleNamespace(
        IsWindow=lambda _hwnd: True,
        GetWindowText=lambda _hwnd: "Editor",
        IsIconic=lambda _hwnd: False,
        GetWindowRect=lambda _hwnd: (10, 20, 14, 23),
        GetWindowDC=lambda _hwnd: 22,
        PrintWindow=lambda hwnd, dc, flags: calls.append((hwnd, dc, flags)) or 1,
        DeleteObject=lambda _bitmap: None,
        ReleaseDC=lambda _hwnd, _dc: None,
    )
    fake_ui = SimpleNamespace(
        CreateDCFromHandle=lambda _dc: FakeDC(),
        CreateBitmap=FakeBitmap,
    )
    monkeypatch.setitem(sys.modules, "win32gui", fake_gui)
    monkeypatch.setitem(sys.modules, "win32ui", fake_ui)

    result = HostDesktopClient(platform="win32")._capture_window(42)

    assert calls == [(42, 23, 2)]
    assert result["capture_bounds"] == {
        "x": 10,
        "y": 20,
        "width": 4,
        "height": 3,
    }
    assert result["screenshot_bytes"].startswith(b"\xff\xd8")

    fake_gui.PrintWindow = lambda _hwnd, _dc, _flags: 0
    with pytest.raises(HostDesktopActionError, match="No monitor screenshot"):
        HostDesktopClient(platform="win32")._capture_window(42)
