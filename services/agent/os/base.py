from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union


class BaseOSAdapter(ABC):
    """Abstract base class for operating system abstractions."""

    @abstractmethod
    def get_system_info(self) -> Dict[str, Any]:
        """Returns standard system metrics (OS version, CPU, RAM, Disk)."""
        pass

    @abstractmethod
    def get_active_window(self) -> Dict[str, Any]:
        """Returns metadata for the currently active foreground window."""
        pass

    @abstractmethod
    def get_foreground_pid(self) -> int:
        """Returns the PID of the foreground window's process, or 0."""
        pass

    @abstractmethod
    def get_clipboard(self) -> str:
        """Reads text content from the system clipboard."""
        pass

    @abstractmethod
    def set_clipboard(self, text: str) -> None:
        """Sets text content into the system clipboard."""
        pass

    @abstractmethod
    def show_notification(self, title: str, message: str) -> None:
        """Displays a desktop notification."""
        pass

    @abstractmethod
    def set_environment_variable(self, name: str, value: str, scope: str = "user") -> None:
        """Sets an environment variable at user or system scope."""
        pass

    @abstractmethod
    def list_applications(self) -> List[Dict[str, Any]]:
        """Returns a list of running user applications and processes."""
        pass

    @abstractmethod
    def execute_command(self, command: str) -> Dict[str, Any]:
        """Executes a command using the platform's default shell synchronously."""
        pass

    # Window management methods
    def list_windows(self, visible_only: bool = True) -> List[Dict[str, Any]]:
        """Lists available windows on the desktop."""
        return []

    def get_window(self, hwnd_or_title: Union[int, str]) -> Optional[Dict[str, Any]]:
        """Gets window details by handle or title."""
        return None

    def focus_window(self, hwnd_or_title: Union[int, str]) -> bool:
        """Brings the specified window to the foreground."""
        return False

    def minimize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        """Minimizes the specified window."""
        return False

    def maximize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        """Maximizes the specified window."""
        return False

    def restore_window(self, hwnd_or_title: Union[int, str]) -> bool:
        """Restores the specified window."""
        return False

    def close_window(self, hwnd_or_title: Union[int, str]) -> bool:
        """Closes the specified window."""
        return False

    def resize_window(self, hwnd_or_title: Union[int, str], width: int, height: int) -> bool:
        """Resizes the specified window."""
        return False

    def move_window(self, hwnd_or_title: Union[int, str], x: int, y: int) -> bool:
        """Moves the specified window."""
        return False

    def get_window_rect(self, hwnd_or_title: Union[int, str]) -> Dict[str, int]:
        """Gets the bounding box {x, y, width, height} of the specified window."""
        return {"x": 0, "y": 0, "width": 0, "height": 0}
