"""Platform-neutral desktop-control contract."""

from typing import Any, Protocol

from ..perception.capture import CaptureResult


class DesktopPlatform(Protocol):
    """Operations required by the desktop action executor."""

    async def click(
        self,
        window_handle: int,
        x: int,
        y: int,
        button: str,
    ) -> CaptureResult: ...

    async def double_click(
        self,
        window_handle: int,
        x: int,
        y: int,
    ) -> CaptureResult: ...

    async def right_click(
        self,
        window_handle: int,
        x: int,
        y: int,
    ) -> CaptureResult: ...

    async def move(self, window_handle: int, x: int, y: int) -> CaptureResult: ...

    async def drag(
        self,
        window_handle: int,
        from_x: int,
        from_y: int,
        to_x: int,
        to_y: int,
        duration: float,
    ) -> CaptureResult: ...

    async def type_text(self, window_handle: int, text: str) -> CaptureResult: ...

    async def hotkey(
        self,
        window_handle: int,
        shortcut: str,
    ) -> CaptureResult: ...

    async def scroll(
        self,
        window_handle: int,
        x: int,
        y: int,
        amount: int,
    ) -> CaptureResult: ...

    async def open_application(
        self,
        application: str,
        arguments: list[str],
    ) -> Any: ...

    async def focus_window(self, title: str) -> dict[str, Any]: ...

    async def list_windows(self) -> list[dict[str, Any]]: ...

    async def capture_monitor(self, monitor_index: int) -> CaptureResult: ...

    async def capture_window(self, window_handle: int) -> CaptureResult: ...

    async def observe_ui(self, window_handle: int) -> dict[str, Any]: ...

    async def click_element(
        self,
        element_id: str,
        window_handle: int,
        target_description: str,
    ) -> Any: ...

    async def type_into_element(
        self,
        element_id: str,
        window_handle: int,
        text: str,
        target_description: str,
    ) -> Any: ...

    def invalidate_ui_snapshot(self) -> None: ...
