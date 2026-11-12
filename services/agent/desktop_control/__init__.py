"""Local, platform-backed desktop automation primitives."""

from .actions.executor import DesktopExecutor
from .actions.models import parse_desktop_action
from .config.settings import DesktopControlConfig

__all__ = [
    "DesktopControlConfig",
    "DesktopExecutor",
    "parse_desktop_action",
]
