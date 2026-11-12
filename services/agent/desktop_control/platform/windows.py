"""Windows implementation composed from HELIX's existing desktop tools."""

import asyncio
from dataclasses import asdict
from typing import Any

from ..config.settings import DesktopControlConfig
from ..perception.capture import CaptureResult
from ..perception.ui_automation import WindowsUIAutomation
from .windows_virtual_desktop import WindowsVirtualDesktop
from services.agent.perception.screen_observation_policy import (
    screen_observation_is_allowed,
)
from services.agent.tools.application_tool import ApplicationTool
from services.agent.tools.window_tool import WindowTool

_VISUAL_CONTROL_DISABLED = (
    "Physical mouse/keyboard input and desktop capture are disabled. "
    "Use UI Automation patterns for native apps or browser_control for webpages."
)


class WindowsDesktopPlatform:
    """Delegate desktop operations and isolate target windows on a HELIX desktop."""

    def __init__(
        self,
        config: DesktopControlConfig,
        virtual_desktop: WindowsVirtualDesktop | None = None,
    ) -> None:
        self._application = ApplicationTool()
        self._windows = WindowTool()
        self._ui_automation = WindowsUIAutomation(
            config.max_accessibility_elements,
            config.max_accessibility_depth,
            config.accessibility_cache_ttl_ms,
        )
        self._virtual_desktop = virtual_desktop or WindowsVirtualDesktop()
        self._owned_windows: dict[int, int] = {}

    async def ensure_dedicated_workspace(self) -> None:
        """Create or reuse HELIX's isolated virtual desktop."""
        await asyncio.to_thread(self._virtual_desktop.ensure_dedicated)

    async def click(
        self,
        window_handle: int,
        x: int,
        y: int,
        button: str,
    ) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def double_click(
        self,
        window_handle: int,
        x: int,
        y: int,
    ) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def right_click(
        self,
        window_handle: int,
        x: int,
        y: int,
    ) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def move(self, window_handle: int, x: int, y: int) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def drag(
        self,
        window_handle: int,
        from_x: int,
        from_y: int,
        to_x: int,
        to_y: int,
        duration: float,
    ) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def type_text(self, window_handle: int, text: str) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def hotkey(self, window_handle: int, shortcut: str) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def scroll(
        self,
        window_handle: int,
        x: int,
        y: int,
        amount: int,
    ) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def open_application(
        self,
        application: str,
        arguments: list[str],
    ) -> dict[str, Any]:
        existing_windows = await self._windows.list_windows(visible_only=False)
        existing_handles = {window.hwnd for window in existing_windows}
        launch = await self._application.open_application(
            application,
            arguments,
            activate=False,
        )
        if not launch.success or launch.pid is None:
            raise OSError(launch.error or f"Could not open {application}.")

        target_window = None
        for _ in range(40):
            windows = await self._windows.list_windows(visible_only=False)
            candidates = [
                window
                for window in windows
                if window.pid == launch.pid
                and window.hwnd > 0
                and window.hwnd not in existing_handles
                and window.visible
                and not window.is_minimized
            ]
            if candidates:
                target_window = max(
                    candidates,
                    key=lambda window: window.rect.width * window.rect.height,
                )
                break
            await asyncio.sleep(0.1)
        if target_window is None:
            raise OSError(
                f"{application} started, but HELIX could not identify a new "
                "window owned by this launch. Existing windows were left untouched."
            )
        desktop_id = await asyncio.to_thread(
            self._move_new_window_without_activation,
            target_window.hwnd,
        )
        self._owned_windows[target_window.hwnd] = target_window.pid
        return {
            **asdict(launch),
            "window_handle": target_window.hwnd,
            "window_title": target_window.title,
            "virtual_desktop_id": desktop_id,
        }

    def _move_new_window_without_activation(self, window_handle: int) -> str:
        import win32gui

        win32gui.ShowWindow(window_handle, 0)
        try:
            return self._virtual_desktop.move_window(window_handle)
        finally:
            if win32gui.IsWindow(window_handle):
                win32gui.ShowWindow(window_handle, 4)

    async def focus_window(self, title: str) -> dict[str, Any]:
        """Select a HELIX-owned window without changing the user's desktop."""
        windows = await self._windows.list_windows(visible_only=False)
        matches = [
            window
            for window in windows
            if (
                window.title == title
                and self._owned_windows.get(window.hwnd) == window.pid
            )
        ]
        if len(matches) != 1:
            raise ValueError(
                f"Expected one HELIX-owned window titled '{title}', "
                f"found {len(matches)}."
            )
        window = matches[0]
        desktop_id = await asyncio.to_thread(
            self._virtual_desktop.window_desktop_id,
            window.hwnd,
        )
        return {
            "window_handle": window.hwnd,
            "title": window.title,
            "virtual_desktop_id": desktop_id,
        }

    async def list_windows(self) -> list[dict[str, Any]]:
        windows = await self._windows.list_windows(visible_only=False)
        owned = []
        for window in windows:
            if self._owned_windows.get(window.hwnd) != window.pid:
                self._owned_windows.pop(window.hwnd, None)
                continue
            details = asdict(window)
            details["virtual_desktop_id"] = await asyncio.to_thread(
                self._virtual_desktop.window_desktop_id,
                window.hwnd,
            )
            owned.append(details)
        return owned

    async def capture_monitor(self, monitor_index: int) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def capture_window(self, window_handle: int) -> CaptureResult:
        raise PermissionError(_VISUAL_CONTROL_DISABLED)

    async def observe_ui(self, window_handle: int) -> dict[str, Any]:
        if not screen_observation_is_allowed():
            raise PermissionError("Screen observation is disabled for this task.")
        await self._require_owned_window(window_handle)
        title = await asyncio.to_thread(
            self._window_title,
            window_handle,
        )
        snapshot = await asyncio.to_thread(
            self._ui_automation.observe,
            window_handle,
            title,
        )
        snapshot["window"]["virtual_desktop_id"] = await asyncio.to_thread(
            self._virtual_desktop.window_desktop_id,
            window_handle,
        )
        return snapshot

    async def click_element(
        self,
        element_id: str,
        window_handle: int,
        target_description: str,
    ) -> dict[str, Any]:
        del target_description
        self._require_screen_observation()
        await self._require_owned_window(window_handle)
        method = await asyncio.to_thread(
            self._ui_automation.click_element,
            window_handle,
            element_id,
        )
        return {
            "element_id": element_id,
            "window_handle": window_handle,
            "virtual_desktop_id": await asyncio.to_thread(
                self._virtual_desktop.window_desktop_id,
                window_handle,
            ),
            "method": method,
        }

    async def type_into_element(
        self,
        element_id: str,
        window_handle: int,
        text: str,
        target_description: str,
    ) -> dict[str, Any]:
        del target_description
        self._require_screen_observation()
        await self._require_owned_window(window_handle)
        await asyncio.to_thread(
            self._ui_automation.set_value,
            window_handle,
            element_id,
            text,
        )
        return {
            "element_id": element_id,
            "window_handle": window_handle,
            "method": "value_pattern",
        }

    async def _require_owned_window(self, window_handle: int) -> None:
        expected_pid = self._owned_windows.get(window_handle)
        if expected_pid is None:
            raise PermissionError(
                "HELIX may control only windows opened by this HELIX session; "
                "the existing user window was left untouched."
            )
        actual_pid = await asyncio.to_thread(
            self._window_process_id,
            window_handle,
        )
        if actual_pid != expected_pid:
            self._owned_windows.pop(window_handle, None)
            raise PermissionError(
                "The target window identity changed; HELIX will not control it."
            )
        desktop_id = await asyncio.to_thread(
            self._virtual_desktop.window_desktop_id,
            window_handle,
        )
        dedicated = await asyncio.to_thread(
            self._virtual_desktop.ensure_dedicated,
        )
        if desktop_id.casefold() != str(dedicated.id).casefold():
            raise PermissionError(
                f"Window {window_handle} is no longer on the HELIX desktop."
            )

    @staticmethod
    def _window_title(window_handle: int) -> str:
        import win32gui

        if not win32gui.IsWindow(window_handle):
            raise ValueError(f"Target window {window_handle} no longer exists.")
        title = win32gui.GetWindowText(window_handle)
        if not title:
            raise ValueError(
                f"Target window {window_handle} has no accessible title."
            )
        return title

    @staticmethod
    def _window_process_id(window_handle: int) -> int:
        import win32gui
        import win32process

        if not win32gui.IsWindow(window_handle):
            raise ValueError(f"Target window {window_handle} no longer exists.")
        return int(win32process.GetWindowThreadProcessId(window_handle)[1])

    def invalidate_ui_snapshot(self) -> None:
        self._ui_automation.invalidate()

    @staticmethod
    def _require_screen_observation() -> None:
        if not screen_observation_is_allowed():
            raise PermissionError("Screen observation is disabled for this task.")
