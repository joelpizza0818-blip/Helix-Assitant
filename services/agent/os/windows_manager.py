import logging
from typing import Any, Dict, List, Optional

from .windows_adapter import WindowsAdapter

logger = logging.getLogger(__name__)

_adapter = WindowsAdapter()


def list_windows(visible_only: bool = True) -> List[Dict[str, Any]]:
    return _adapter.list_windows(visible_only=visible_only)


def get_window(hwnd_or_title: int | str) -> Optional[Dict[str, Any]]:
    return _adapter.get_window(hwnd_or_title)


def focus_window(hwnd: int) -> None:
    _adapter.focus_window(hwnd)


def minimize_window(hwnd: int) -> None:
    _adapter.minimize_window(hwnd)


def maximize_window(hwnd: int) -> None:
    _adapter.maximize_window(hwnd)


def restore_window(hwnd: int) -> None:
    _adapter.restore_window(hwnd)


def close_window(hwnd: int) -> None:
    _adapter.close_window(hwnd)


def resize_window(hwnd: int, width: int, height: int) -> None:
    _adapter.resize_window(hwnd, width, height)


def move_window(hwnd: int, x: int, y: int) -> None:
    _adapter.move_window(hwnd, x, y)


def get_window_rect(hwnd: int) -> Dict[str, int]:
    return _adapter.get_window_rect(hwnd)


def get_window_text(hwnd: int) -> str:
    return _adapter.get_window_text(hwnd)


def enumerate_child_windows(hwnd: int) -> List[int]:
    children: List[int] = []
    try:
        import win32gui

        def callback(child, _):
            children.append(child)
            return True

        win32gui.EnumChildWindows(hwnd, callback, None)
    except Exception:
        pass
    return children


def find_window_by_title(title_pattern: str) -> Optional[int]:
    return _adapter.find_window_by_title(title_pattern)
