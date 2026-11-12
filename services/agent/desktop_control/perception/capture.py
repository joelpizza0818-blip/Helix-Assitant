"""On-demand monitor and window captures using HELIX's screen engine."""

import asyncio
from dataclasses import dataclass
import platform
from typing import Any

from ..config.settings import DesktopControlConfig
from services.agent.perception.screen_engine import ScreenEngine
from services.agent.perception.screen_observation_policy import (
    screen_observation_is_allowed,
)


class ScreenCaptureDenied(PermissionError):
    """Screen capture is blocked by the current task's observation policy."""


class ScreenCaptureError(RuntimeError):
    """A screen capture could not be produced."""


@dataclass(frozen=True)
class CaptureResult:
    """Image bytes and the desktop region they represent."""

    image: bytes
    target: str
    bounds: dict[str, int]


class DesktopScreenCapture:
    """Capture only when the agent's existing screen-observation gate is open."""

    def __init__(
        self,
        config: DesktopControlConfig,
        screen_engine: Any | None = None,
    ) -> None:
        self.config = config
        self._screen_engine = screen_engine or ScreenEngine()

    async def list_monitors(self) -> list[dict[str, int]]:
        """Return monitor indices and physical desktop bounds."""
        return await asyncio.to_thread(self._list_monitors_sync)

    async def capture_monitor(self, monitor_index: int) -> CaptureResult:
        """Capture one monitor by its zero-based index."""
        self._require_permission()
        monitors = await self.list_monitors()
        if not 0 <= monitor_index < len(monitors):
            raise ValueError(
                f"Monitor index {monitor_index} is invalid; "
                f"available indices are 0..{len(monitors) - 1}."
            )
        monitor = monitors[monitor_index]
        engine = self._screen_engine
        engine.configure({"display_index": monitor_index})
        image = await asyncio.to_thread(engine.capture_full)
        if not image:
            raise ScreenCaptureError(
                f"Screen capture returned no image for monitor {monitor_index}."
            )
        return CaptureResult(image=image, target="monitor", bounds=monitor)

    async def capture_window(self, window_handle: int) -> CaptureResult:
        """Capture the visible screen rectangle associated with a Windows HWND."""
        self._require_permission()
        if platform.system() != "Windows":
            raise NotImplementedError(
                "Window capture by native handle is currently implemented for Windows."
            )
        if isinstance(window_handle, bool) or window_handle <= 0:
            raise ValueError("A positive native window handle is required.")
        image = await asyncio.to_thread(
            self._screen_engine.capture_window,
            window_handle,
        )
        if not image:
            raise ScreenCaptureError(
                f"Screen capture returned no image for window {window_handle}."
            )
        bounds = await asyncio.to_thread(
            self._window_bounds_sync,
            window_handle,
        )
        return CaptureResult(
            image=image,
            target=f"window:{window_handle}",
            bounds=bounds,
        )

    @staticmethod
    def _require_permission() -> None:
        if not screen_observation_is_allowed():
            raise ScreenCaptureDenied(
                "Screen observation is disabled for this task."
            )

    @staticmethod
    def _list_monitors_sync() -> list[dict[str, int]]:
        import mss

        with mss.mss() as capture:
            return [
                {
                    "index": index,
                    "left": monitor["left"],
                    "top": monitor["top"],
                    "width": monitor["width"],
                    "height": monitor["height"],
                }
                for index, monitor in enumerate(capture.monitors[1:])
            ]

    @staticmethod
    def _window_bounds_sync(window_handle: int) -> dict[str, int]:
        import win32gui

        if not win32gui.IsWindow(window_handle):
            raise ValueError(f"Window {window_handle} no longer exists.")
        left, top, right, bottom = win32gui.GetWindowRect(window_handle)
        if right <= left or bottom <= top:
            raise ScreenCaptureError(
                f"Window {window_handle} has no capturable screen area."
            )
        return {
            "left": left,
            "top": top,
            "width": right - left,
            "height": bottom - top,
        }
