import platform
from typing import Optional

from .base import BaseOSAdapter
from .linux_adapter import LinuxAdapter
from .macos_adapter import MacOSAdapter
from .windows_adapter import WindowsAdapter

_ADAPTER_INSTANCE: Optional[BaseOSAdapter] = None


def get_os_adapter(
    force_refresh: bool = False,
    system_override: Optional[str] = None,
) -> BaseOSAdapter:
    """Returns the singleton BaseOSAdapter implementation for the current OS.

    Supports forcing a refresh or overriding the target system name ('Windows', 'Linux', 'Darwin')
    for testing.
    """
    global _ADAPTER_INSTANCE
    if _ADAPTER_INSTANCE is not None and not force_refresh and system_override is None:
        return _ADAPTER_INSTANCE

    system_name = system_override or platform.system()

    adapter: BaseOSAdapter
    if system_name == "Windows":
        adapter = WindowsAdapter()
    elif system_name == "Darwin":
        adapter = MacOSAdapter()
    elif system_name == "Linux":
        adapter = LinuxAdapter()
    else:
        # Fallback to Linux adapter for other POSIX environments
        adapter = LinuxAdapter()

    if system_override is None:
        _ADAPTER_INSTANCE = adapter

    return adapter


def reset_os_adapter() -> None:
    """Resets the cached OS adapter singleton."""
    global _ADAPTER_INSTANCE
    _ADAPTER_INSTANCE = None
