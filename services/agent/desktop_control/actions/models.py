"""Strict, typed models for individual desktop actions."""

from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr
from pydantic import TypeAdapter, ValidationError


class ActionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ClickAction(ActionModel):
    action: Literal["click"]
    window_handle: StrictInt = Field(gt=0)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)
    button: Literal["left", "right", "middle"] = "left"
    target_description: StrictStr = Field(min_length=1, max_length=300)


class DoubleClickAction(ActionModel):
    action: Literal["double_click"]
    window_handle: StrictInt = Field(gt=0)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)
    target_description: StrictStr = Field(min_length=1, max_length=300)


class RightClickAction(ActionModel):
    action: Literal["right_click"]
    window_handle: StrictInt = Field(gt=0)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)
    target_description: StrictStr = Field(min_length=1, max_length=300)


class MoveAction(ActionModel):
    action: Literal["move"]
    window_handle: StrictInt = Field(gt=0)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)


class DragAction(ActionModel):
    action: Literal["drag"]
    window_handle: StrictInt = Field(gt=0)
    from_x: StrictInt = Field(ge=0)
    from_y: StrictInt = Field(ge=0)
    to_x: StrictInt = Field(ge=0)
    to_y: StrictInt = Field(ge=0)
    duration: StrictFloat = Field(default=0.5, gt=0, le=3)
    target_description: StrictStr = Field(min_length=1, max_length=300)


class TypeTextAction(ActionModel):
    action: Literal["type_text"]
    window_handle: StrictInt = Field(gt=0)
    text: StrictStr = Field(min_length=1)
    target_description: StrictStr = Field(min_length=1, max_length=300)


class HotkeyAction(ActionModel):
    action: Literal["hotkey"]
    window_handle: StrictInt = Field(gt=0)
    shortcut: StrictStr = Field(min_length=1)


class ScrollAction(ActionModel):
    action: Literal["scroll"]
    window_handle: StrictInt = Field(gt=0)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)
    direction: Literal["up", "down"]
    amount: StrictInt = Field(gt=0)


class OpenApplicationAction(ActionModel):
    action: Literal["open_application"]
    application: StrictStr = Field(min_length=1)
    arguments: list[StrictStr] = Field(default_factory=list)


class FocusWindowAction(ActionModel):
    action: Literal["focus_window"]
    title: StrictStr = Field(min_length=1)


class ListWindowsAction(ActionModel):
    action: Literal["list_windows"]


class WaitAction(ActionModel):
    action: Literal["wait"]
    seconds: StrictFloat = Field(ge=0)


class CaptureMonitorAction(ActionModel):
    action: Literal["capture_monitor"]
    monitor_index: StrictInt | None = Field(default=None, ge=0)


class CaptureWindowAction(ActionModel):
    action: Literal["capture_window"]
    window_handle: StrictInt = Field(gt=0)


class ObserveUIAction(ActionModel):
    action: Literal["observe_ui"]
    window_handle: StrictInt = Field(gt=0)


class ClickElementAction(ActionModel):
    action: Literal["click_element"]
    window_handle: StrictInt = Field(gt=0)
    element_id: StrictStr = Field(min_length=1, max_length=20)
    target_description: StrictStr = Field(min_length=1, max_length=300)


class TypeIntoElementAction(ActionModel):
    action: Literal["type_into_element"]
    window_handle: StrictInt = Field(gt=0)
    element_id: StrictStr = Field(min_length=1, max_length=20)
    text: StrictStr = Field(min_length=1)
    target_description: StrictStr = Field(min_length=1, max_length=300)


DesktopAction: TypeAlias = Annotated[
    ClickAction
    | DoubleClickAction
    | RightClickAction
    | MoveAction
    | DragAction
    | TypeTextAction
    | HotkeyAction
    | ScrollAction
    | OpenApplicationAction
    | FocusWindowAction
    | ListWindowsAction
    | WaitAction
    | CaptureMonitorAction
    | CaptureWindowAction
    | ObserveUIAction
    | ClickElementAction
    | TypeIntoElementAction,
    Field(discriminator="action"),
]

_ACTION_ADAPTER = TypeAdapter(DesktopAction)


def parse_desktop_action(payload: object) -> DesktopAction:
    """Validate an untrusted action payload and return its typed model."""
    try:
        return _ACTION_ADAPTER.validate_python(payload)
    except ValidationError as error:
        details = "; ".join(
            f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
            for issue in error.errors()
        )
        raise ValueError(f"Invalid desktop action: {details}") from error
