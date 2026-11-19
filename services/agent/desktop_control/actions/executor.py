"""Dispatch validated actions to the selected platform backend."""

import asyncio
from dataclasses import dataclass
from typing import Any

from ..config.settings import DesktopControlConfig
from ..perception.capture import CaptureResult
from ..platform.base import DesktopPlatform
from ..platform.windows import WindowsDesktopPlatform
from .models import (
    CaptureMonitorAction,
    CaptureWindowAction,
    ClickAction,
    ClickElementAction,
    DesktopAction,
    DoubleClickAction,
    DragAction,
    FocusWindowAction,
    HotkeyAction,
    ListWindowsAction,
    MoveAction,
    ObserveUIAction,
    OpenApplicationAction,
    RightClickAction,
    ScrollAction,
    TypeTextAction,
    TypeIntoElementAction,
    WaitAction,
    parse_desktop_action,
)

_DISALLOWED_VISUAL_ACTIONS = {
    "click",
    "double_click",
    "right_click",
    "move",
    "drag",
    "type_text",
    "hotkey",
    "scroll",
    "capture_monitor",
    "capture_window",
}


class DesktopControlError(RuntimeError):
    """A valid desktop action could not be completed."""


@dataclass(frozen=True)
class ActionReceipt:
    """Result of one completed desktop action."""

    action: str
    result: Any = None


class DesktopExecutor:
    """Execute one validated desktop action at a time."""

    def __init__(
        self,
        config: DesktopControlConfig | None = None,
        platform: DesktopPlatform | None = None,
    ) -> None:
        self.config = config or DesktopControlConfig.load()
        self.platform = platform or WindowsDesktopPlatform(self.config)

    def cancel_active(self) -> None:
        """Forward an emergency stop to a platform that supports cancellation."""
        cancel = getattr(self.platform, "cancel_active", None)
        if callable(cancel):
            cancel()

    async def execute(self, payload: object) -> ActionReceipt:
        """Validate and execute one action; failures are raised explicitly."""
        action = parse_desktop_action(payload)
        if action.action in _DISALLOWED_VISUAL_ACTIONS:
            raise DesktopControlError(
                "Physical mouse/keyboard input and desktop capture are disabled "
                "because Windows virtual desktops share the system cursor and "
                "foreground. Use UI Automation patterns for desktop apps."
            )
        if isinstance(action, (TypeTextAction, TypeIntoElementAction)):
            self._validate_text(action.text)
        elif isinstance(action, HotkeyAction):
            if action.shortcut.casefold() not in self.config.allowed_hotkeys:
                raise ValueError("The requested keyboard shortcut is not allowed.")
        elif isinstance(action, ScrollAction):
            self._validate_scroll_amount(action.amount)
        elif isinstance(action, WaitAction):
            if action.seconds > self.config.max_wait_seconds:
                raise ValueError(
                    f"Wait duration exceeds the configured maximum "
                    f"({self.config.max_wait_seconds} seconds)."
                )
        prepare_workspace = getattr(
            self.platform,
            "ensure_dedicated_workspace",
            None,
        )
        if callable(prepare_workspace):
            await prepare_workspace()
        if not isinstance(
            action,
            (ObserveUIAction, ClickElementAction, TypeIntoElementAction),
        ):
            self.platform.invalidate_ui_snapshot()
        if isinstance(action, ClickAction):
            result = await self.platform.click(
                action.window_handle,
                action.x,
                action.y,
                action.button,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, DoubleClickAction):
            result = await self.platform.double_click(
                action.window_handle,
                action.x,
                action.y,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, RightClickAction):
            result = await self.platform.right_click(
                action.window_handle,
                action.x,
                action.y,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, MoveAction):
            result = await self.platform.move(
                action.window_handle,
                action.x,
                action.y,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, DragAction):
            result = await self.platform.drag(
                action.window_handle,
                action.from_x,
                action.from_y,
                action.to_x,
                action.to_y,
                action.duration,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, TypeTextAction):
            result = await self.platform.type_text(
                action.window_handle,
                action.text,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, HotkeyAction):
            shortcut = action.shortcut.casefold()
            result = await self.platform.hotkey(
                action.window_handle,
                shortcut,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, ScrollAction):
            signed_amount = action.amount if action.direction == "up" else -action.amount
            result = await self.platform.scroll(
                action.window_handle,
                action.x,
                action.y,
                signed_amount,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, OpenApplicationAction):
            result = await self.platform.open_application(
                action.application,
                action.arguments,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, FocusWindowAction):
            return ActionReceipt(
                action=action.action,
                result=await self.platform.focus_window(action.title),
            )
        elif isinstance(action, ListWindowsAction):
            return ActionReceipt(
                action=action.action,
                result=await self.platform.list_windows(),
            )
        elif isinstance(action, WaitAction):
            await asyncio.sleep(action.seconds)
        elif isinstance(action, CaptureMonitorAction):
            return ActionReceipt(
                action=action.action,
                result=await self.platform.capture_monitor(
                    self.config.monitor_index
                    if action.monitor_index is None
                    else action.monitor_index
                ),
            )
        elif isinstance(action, CaptureWindowAction):
            return ActionReceipt(
                action=action.action,
                result=await self.platform.capture_window(action.window_handle),
            )
        elif isinstance(action, ObserveUIAction):
            return ActionReceipt(
                action=action.action,
                result=await self.platform.observe_ui(action.window_handle),
            )
        elif isinstance(action, ClickElementAction):
            result = await self.platform.click_element(
                action.element_id,
                action.window_handle,
                action.target_description,
            )
            return ActionReceipt(action=action.action, result=result)
        elif isinstance(action, TypeIntoElementAction):
            result = await self.platform.type_into_element(
                action.element_id,
                action.window_handle,
                action.text,
                action.target_description,
            )
            return ActionReceipt(action=action.action, result=result)
        else:
            raise DesktopControlError(
                f"Unsupported desktop action type: {type(action).__name__}"
            )
        return ActionReceipt(action=action.action)

    def _validate_text(self, text: str) -> None:
        if len(text) > self.config.max_text_characters:
            raise ValueError(
                "Text exceeds the configured maximum length "
                f"({self.config.max_text_characters} characters)."
            )

    def _validate_scroll_amount(self, amount: int) -> None:
        if amount > self.config.max_scroll_steps:
            raise ValueError(
                "Scroll amount exceeds the configured maximum "
                f"({self.config.max_scroll_steps} steps)."
            )
