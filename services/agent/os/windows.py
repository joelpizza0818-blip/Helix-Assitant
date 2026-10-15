import logging
import platform
from typing import Any, Dict

from .windows_adapter import WindowsAdapter

logger = logging.getLogger(__name__)

_adapter = WindowsAdapter()


def get_windows_version() -> str:
    return platform.version()


def get_system_info() -> Dict[str, Any]:
    return _adapter.get_system_info()


def get_active_window() -> Dict[str, Any]:
    return _adapter.get_active_window()


def get_foreground_pid() -> int:
    return _adapter.get_foreground_pid()


def set_environment_variable(name: str, value: str, scope: str = "user") -> None:
    _adapter.set_environment_variable(name, value, scope)


def show_notification(title: str, message: str) -> None:
    _adapter.show_notification(title, message)


def get_clipboard() -> str:
    return _adapter.get_clipboard()


def set_clipboard(text: str) -> None:
    _adapter.set_clipboard(text)
