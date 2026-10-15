import asyncio
import logging
from dataclasses import dataclass
from typing import List, Optional, Union

from services.agent.os.factory import get_os_adapter

# Protected win32 imports
try:
    import win32con
    import win32gui
    import win32process

    _WIN32_AVAILABLE = True
except ImportError:
    win32con = None
    win32gui = None
    win32process = None
    _WIN32_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass
class Rect:
    x: int
    y: int
    width: int
    height: int


@dataclass
class WindowInfo:
    hwnd: int
    title: str
    class_name: str
    pid: int
    rect: Rect
    visible: bool
    is_minimized: bool


class WindowTool:
    """Window management tool supporting Windows and cross-platform OS adapters."""

    def __init__(self, os_adapter=None):
        self._os_adapter = os_adapter

    @property
    def os_adapter(self):
        if self._os_adapter is None:
            self._os_adapter = get_os_adapter()
        return self._os_adapter

    async def list_windows(self, visible_only: bool = True) -> List[WindowInfo]:
        """Lists all windows."""
        logger.info(f"Listing windows (visible_only={visible_only})")
        if _WIN32_AVAILABLE and win32gui is not None and win32process is not None:
            windows: List[WindowInfo] = []

            def enum_windows_proc(hwnd, _):
                if visible_only and not win32gui.IsWindowVisible(hwnd):
                    return True
                title = win32gui.GetWindowText(hwnd)
                class_name = win32gui.GetClassName(hwnd)
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                rect = win32gui.GetWindowRect(hwnd)
                width = rect[2] - rect[0]
                height = rect[3] - rect[1]
                is_minimized = win32gui.IsIconic(hwnd) != 0

                windows.append(
                    WindowInfo(
                        hwnd=hwnd,
                        title=title,
                        class_name=class_name,
                        pid=pid,
                        rect=Rect(rect[0], rect[1], width, height),
                        visible=win32gui.IsWindowVisible(hwnd) != 0,
                        is_minimized=is_minimized,
                    )
                )
                return True

            await asyncio.to_thread(win32gui.EnumWindows, enum_windows_proc, None)
            return windows

        # Fallback to OS adapter for Linux/macOS
        raw_windows = self.os_adapter.list_windows(visible_only=visible_only)
        result: List[WindowInfo] = []
        for w in raw_windows:
            r = w.get("rect", {})
            result.append(
                WindowInfo(
                    hwnd=w.get("hwnd", 0),
                    title=w.get("title", ""),
                    class_name="",
                    pid=w.get("pid", 0),
                    rect=Rect(
                        r.get("x", 0),
                        r.get("y", 0),
                        r.get("width", 0),
                        r.get("height", 0),
                    ),
                    visible=True,
                    is_minimized=False,
                )
            )
        return result

    async def _get_hwnd(self, hwnd_or_title: Union[int, str]) -> int:
        if isinstance(hwnd_or_title, int):
            return hwnd_or_title

        windows = await self.list_windows(visible_only=False)
        for w in windows:
            if w.title == hwnd_or_title:
                return w.hwnd
        raise ValueError(f"Window not found: {hwnd_or_title}")

    async def get_active_window(self) -> WindowInfo:
        """Gets the currently active foreground window."""
        logger.info("Getting active window")
        if _WIN32_AVAILABLE and win32gui is not None and win32process is not None:
            hwnd = win32gui.GetForegroundWindow()
            title = win32gui.GetWindowText(hwnd)
            class_name = win32gui.GetClassName(hwnd)
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            rect = win32gui.GetWindowRect(hwnd)
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            is_minimized = win32gui.IsIconic(hwnd) != 0

            return WindowInfo(
                hwnd=hwnd,
                title=title,
                class_name=class_name,
                pid=pid,
                rect=Rect(rect[0], rect[1], width, height),
                visible=win32gui.IsWindowVisible(hwnd) != 0,
                is_minimized=is_minimized,
            )

        win = self.os_adapter.get_active_window()
        r = win.get("rect", {})
        return WindowInfo(
            hwnd=win.get("hwnd", 0),
            title=win.get("title", ""),
            class_name="",
            pid=win.get("pid", 0),
            rect=Rect(
                r.get("x", 0),
                r.get("y", 0),
                r.get("width", 0),
                r.get("height", 0),
            ),
            visible=bool(win),
            is_minimized=False,
        )

    async def focus_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Brings the specified window to the foreground."""
        logger.info(f"Focusing window: {hwnd_or_title}")
        if _WIN32_AVAILABLE and win32gui is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            await asyncio.to_thread(win32gui.SetForegroundWindow, hwnd)
        else:
            self.os_adapter.focus_window(hwnd_or_title)

    async def minimize_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Minimizes the specified window."""
        logger.info(f"Minimizing window: {hwnd_or_title}")
        if _WIN32_AVAILABLE and win32gui is not None and win32con is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_MINIMIZE)
        else:
            self.os_adapter.minimize_window(hwnd_or_title)

    async def maximize_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Maximizes the specified window."""
        logger.info(f"Maximizing window: {hwnd_or_title}")
        if _WIN32_AVAILABLE and win32gui is not None and win32con is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_MAXIMIZE)
        else:
            self.os_adapter.maximize_window(hwnd_or_title)

    async def restore_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Restores the specified window."""
        logger.info(f"Restoring window: {hwnd_or_title}")
        if _WIN32_AVAILABLE and win32gui is not None and win32con is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_RESTORE)
        else:
            self.os_adapter.restore_window(hwnd_or_title)

    async def close_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Closes the specified window. Requires MODIFY permission."""
        logger.info(f"Closing window: {hwnd_or_title}")
        if _WIN32_AVAILABLE and win32gui is not None and win32con is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            await asyncio.to_thread(win32gui.PostMessage, hwnd, win32con.WM_CLOSE, 0, 0)
        else:
            self.os_adapter.close_window(hwnd_or_title)

    async def resize_window(
        self, hwnd_or_title: Union[int, str], width: int, height: int
    ) -> None:
        """Resizes the specified window."""
        logger.info(f"Resizing window {hwnd_or_title} to {width}x{height}")
        if _WIN32_AVAILABLE and win32gui is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            rect = win32gui.GetWindowRect(hwnd)
            await asyncio.to_thread(
                win32gui.MoveWindow, hwnd, rect[0], rect[1], width, height, True
            )
        else:
            self.os_adapter.resize_window(hwnd_or_title, width, height)

    async def move_window(
        self, hwnd_or_title: Union[int, str], x: int, y: int
    ) -> None:
        """Moves the specified window."""
        logger.info(f"Moving window {hwnd_or_title} to {x}, {y}")
        if _WIN32_AVAILABLE and win32gui is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            rect = win32gui.GetWindowRect(hwnd)
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            await asyncio.to_thread(
                win32gui.MoveWindow, hwnd, x, y, width, height, True
            )
        else:
            self.os_adapter.move_window(hwnd_or_title, x, y)

    async def get_window_rect(self, hwnd_or_title: Union[int, str]) -> Rect:
        """Gets the bounding rectangle of the specified window."""
        if _WIN32_AVAILABLE and win32gui is not None:
            hwnd = await self._get_hwnd(hwnd_or_title)
            rect = win32gui.GetWindowRect(hwnd)
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            return Rect(rect[0], rect[1], width, height)
        else:
            r = self.os_adapter.get_window_rect(hwnd_or_title)
            return Rect(
                r.get("x", 0),
                r.get("y", 0),
                r.get("width", 0),
                r.get("height", 0),
            )
