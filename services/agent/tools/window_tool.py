import asyncio
import logging
from dataclasses import dataclass
from typing import List, Optional, Union
import win32gui
import win32con
import win32process

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
    """Window management tool for Windows OS."""
    
    async def list_windows(self, visible_only: bool = True) -> List[WindowInfo]:
        """Lists all windows."""
        logger.info(f"Listing windows (visible_only={visible_only})")
        windows = []
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
            
            windows.append(WindowInfo(
                hwnd=hwnd,
                title=title,
                class_name=class_name,
                pid=pid,
                rect=Rect(rect[0], rect[1], width, height),
                visible=win32gui.IsWindowVisible(hwnd) != 0,
                is_minimized=is_minimized
            ))
            return True
            
        await asyncio.to_thread(win32gui.EnumWindows, enum_windows_proc, None)
        return windows

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
            is_minimized=is_minimized
        )

    async def focus_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Brings the specified window to the foreground."""
        logger.info(f"Focusing window: {hwnd_or_title}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        await asyncio.to_thread(win32gui.SetForegroundWindow, hwnd)

    async def minimize_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Minimizes the specified window."""
        logger.info(f"Minimizing window: {hwnd_or_title}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_MINIMIZE)

    async def maximize_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Maximizes the specified window."""
        logger.info(f"Maximizing window: {hwnd_or_title}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_MAXIMIZE)

    async def restore_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Restores the specified window."""
        logger.info(f"Restoring window: {hwnd_or_title}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        await asyncio.to_thread(win32gui.ShowWindow, hwnd, win32con.SW_RESTORE)

    async def close_window(self, hwnd_or_title: Union[int, str]) -> None:
        """Closes the specified window. Requires MODIFY permission."""
        logger.info(f"Closing window: {hwnd_or_title}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        await asyncio.to_thread(win32gui.PostMessage, hwnd, win32con.WM_CLOSE, 0, 0)

    async def resize_window(self, hwnd_or_title: Union[int, str], width: int, height: int) -> None:
        """Resizes the specified window."""
        logger.info(f"Resizing window {hwnd_or_title} to {width}x{height}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        rect = win32gui.GetWindowRect(hwnd)
        await asyncio.to_thread(win32gui.MoveWindow, hwnd, rect[0], rect[1], width, height, True)

    async def move_window(self, hwnd_or_title: Union[int, str], x: int, y: int) -> None:
        """Moves the specified window."""
        logger.info(f"Moving window {hwnd_or_title} to {x}, {y}")
        hwnd = await self._get_hwnd(hwnd_or_title)
        rect = win32gui.GetWindowRect(hwnd)
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        await asyncio.to_thread(win32gui.MoveWindow, hwnd, x, y, width, height, True)

    async def get_window_rect(self, hwnd_or_title: Union[int, str]) -> Rect:
        """Gets the bounding rectangle of the specified window."""
        hwnd = await self._get_hwnd(hwnd_or_title)
        rect = win32gui.GetWindowRect(hwnd)
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        return Rect(rect[0], rect[1], width, height)
