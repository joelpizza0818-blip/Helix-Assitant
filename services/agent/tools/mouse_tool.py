import asyncio
import io
import logging
from typing import Any, Dict, Tuple

from PIL import Image, UnidentifiedImageError

try:
    import pyautogui
    _PYAUTOGUI_AVAILABLE = True
except (ImportError, SystemExit, Exception):
    import types
    pyautogui = types.SimpleNamespace(
        size=lambda: (1920, 1080),
        moveTo=lambda *a, **k: None,
        click=lambda *a, **k: None,
        doubleClick=lambda *a, **k: None,
        rightClick=lambda *a, **k: None,
        dragTo=lambda *a, **k: None,
        scroll=lambda *a, **k: None,
        position=lambda: types.SimpleNamespace(x=0, y=0),
    )
    _PYAUTOGUI_AVAILABLE = False

from .base_tool import BaseTool, ToolResult
from .permission_utils import has_consequential_action_text
from ..perception.screen_engine import ScreenEngine
from ..perception.screen_observation_policy import screen_observation_is_allowed

_OPERATIONS = {
    "move",
    "click",
    "double_click",
    "right_click",
    "drag",
    "scroll",
    "get_position",
}
_MOUSE_BUTTONS = {"left", "middle", "right"}
_MAX_SCROLL_AMOUNT = 10
logger = logging.getLogger(__name__)


def _valid_coordinate(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_valid_screenshot(data: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ):
        return False
    return True


class MouseTool(BaseTool):
    def __init__(self):
        self.move_duration = 0.1

    def configure(self, settings: Dict[str, Any]) -> None:
        value = settings.get("mouse_move_duration_ms", 200)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            self.move_duration = max(0.05, min(1.0, float(value) / 1000))

    @property
    def name(self) -> str:
        return "mouse_tool"

    @property
    def description(self) -> str:
        return (
            "Control the mouse using coordinates from the latest screen "
            "observation. Coordinates start at the top-left; inspect the screen "
            "before clicking or dragging. Available operations: move, click, "
            "double_click, right_click, drag, scroll, get_position. Include the "
            "visible target label for consequential clicks, double-clicks, "
            "right-clicks, or drags."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    def permission_level_for(self, params: Dict[str, Any]) -> str:
        operation = params.get("operation")
        if (
            operation in {"click", "double_click", "right_click", "drag"}
            and has_consequential_action_text(
                params.get("target_description")
            )
        ):
            return "EXECUTE"
        return self.permission_level

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        if not isinstance(params, dict):
            return False
        operation = params.get("operation")
        if not isinstance(operation, str) or operation not in _OPERATIONS:
            return False

        expected_keys = {
            "get_position": {"operation"},
            "move": {"operation", "x", "y"},
            "click": {"operation", "x", "y", "button", "target_description"},
            "double_click": {"operation", "x", "y", "target_description"},
            "right_click": {"operation", "x", "y", "target_description"},
            "drag": {
                "operation", "from_x", "from_y", "to_x", "to_y", "duration",
                "target_description",
            },
            "scroll": {"operation", "x", "y", "amount"},
        }[operation]
        target_description = params.get("target_description")
        if target_description is not None and (
            operation not in {"click", "double_click", "right_click", "drag"}
            or not isinstance(target_description, str)
            or len(target_description) > 300
        ):
            return False
        if not set(params).issubset(expected_keys):
            return False
        if operation == "get_position":
            return True
        if operation == "drag":
            if not all(
                _valid_coordinate(params.get(key))
                for key in ("from_x", "from_y", "to_x", "to_y")
            ):
                return False
            duration = params.get("duration", 0.5)
            return (
                isinstance(duration, (int, float))
                and not isinstance(duration, bool)
                and 0.1 <= duration <= 3.0
            )
        if not all(_valid_coordinate(params.get(key)) for key in ("x", "y")):
            return False
        if operation == "click":
            button = params.get("button", "left")
            return isinstance(button, str) and button in _MOUSE_BUTTONS
        if operation == "scroll":
            amount = params.get("amount")
            return (
                isinstance(amount, int)
                and not isinstance(amount, bool)
                and -_MAX_SCROLL_AMOUNT <= amount <= _MAX_SCROLL_AMOUNT
                and amount != 0
            )
        return True

    def get_schema(self) -> Dict[str, Any]:
        coordinate = {"type": "integer", "minimum": 0}
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": sorted(_OPERATIONS),
                    },
                    "x": coordinate,
                    "y": coordinate,
                    "button": {
                        "type": "string",
                        "enum": sorted(_MOUSE_BUTTONS),
                    },
                    "target_description": {
                        "type": "string",
                        "description": (
                            "Visible label or purpose of a click, double-click, "
                            "right-click, or drag target from the latest "
                            "screenshot, if consequential."
                        ),
                    },
                    "from_x": coordinate,
                    "from_y": coordinate,
                    "to_x": coordinate,
                    "to_y": coordinate,
                    "duration": {
                        "type": "number",
                        "minimum": 0.1,
                        "maximum": 3.0,
                    },
                    "amount": {
                        "type": "integer",
                        "minimum": -_MAX_SCROLL_AMOUNT,
                        "maximum": _MAX_SCROLL_AMOUNT,
                    },
                },
                "required": ["operation"],
                "additionalProperties": False,
            },
        }

    def _validate_screen_coordinates(self, *coordinates: tuple[int, int]) -> None:
        width, height = pyautogui.size()
        if any(not (0 <= x < width and 0 <= y < height) for x, y in coordinates):
            raise ValueError(
                f"Mouse coordinates must be within the current screen "
                f"(0..{width - 1}, 0..{height - 1})."
            )

    async def move(self, x: int, y: int) -> None:
        self._validate_screen_coordinates((x, y))
        await asyncio.to_thread(
            pyautogui.moveTo, x, y, duration=self.move_duration
        )

    async def click(self, x: int, y: int, button: str = "left") -> None:
        self._validate_screen_coordinates((x, y))
        await asyncio.to_thread(pyautogui.click, x=x, y=y, button=button)

    async def double_click(self, x: int, y: int) -> None:
        self._validate_screen_coordinates((x, y))
        await asyncio.to_thread(pyautogui.doubleClick, x=x, y=y)

    async def right_click(self, x: int, y: int) -> None:
        self._validate_screen_coordinates((x, y))
        await asyncio.to_thread(pyautogui.rightClick, x=x, y=y)

    async def drag(
        self,
        from_x: int,
        from_y: int,
        to_x: int,
        to_y: int,
        duration: float = 0.5,
    ) -> None:
        self._validate_screen_coordinates(
            (from_x, from_y),
            (to_x, to_y),
        )
        await asyncio.to_thread(pyautogui.moveTo, from_x, from_y)
        await asyncio.to_thread(
            pyautogui.dragTo,
            to_x,
            to_y,
            duration=duration,
            button="left",
        )

    async def scroll(self, x: int, y: int, amount: int) -> None:
        self._validate_screen_coordinates((x, y))
        await asyncio.to_thread(pyautogui.moveTo, x, y)
        await asyncio.to_thread(pyautogui.scroll, amount)

    async def get_position(self) -> Tuple[int, int]:
        position = await asyncio.to_thread(pyautogui.position)
        return position.x, position.y

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="Invalid mouse operation or parameters.",
            )
        if not _PYAUTOGUI_AVAILABLE and not hasattr(pyautogui, "moveTo"):
            return ToolResult(
                success=False,
                output=None,
                error="Mouse control is not available (pyautogui requires python3-tk on Linux).",
            )
        operation = params["operation"]
        try:
            if operation == "move":
                await self.move(params["x"], params["y"])
            elif operation == "click":
                await self.click(
                    params["x"],
                    params["y"],
                    params.get("button", "left"),
                )
            elif operation == "double_click":
                await self.double_click(params["x"], params["y"])
            elif operation == "right_click":
                await self.right_click(params["x"], params["y"])
            elif operation == "drag":
                await self.drag(
                    params["from_x"],
                    params["from_y"],
                    params["to_x"],
                    params["to_y"],
                    params.get("duration", 0.5),
                )
            elif operation == "scroll":
                await self.scroll(params["x"], params["y"], params["amount"])
            else:
                x, y = await self.get_position()
                return ToolResult(success=True, output={"x": x, "y": y})
            output = {"operation": operation}
            if screen_observation_is_allowed():
                try:
                    context = await asyncio.to_thread(
                        ScreenEngine().capture_context
                    )
                except Exception as error:
                    logger.exception("Mouse post-action screen capture failed")
                    return ToolResult(
                        success=False,
                        output={
                            "operation": operation,
                            "action_may_have_succeeded": True,
                        },
                        error=(
                            "The mouse action may have succeeded, but its "
                            "post-action screenshot failed. Inspect the current "
                            "screen before retrying."
                        ),
                    )
                screenshot = (
                    context.get("screenshot_bytes")
                    if isinstance(context, dict)
                    else None
                )
                if (
                    not isinstance(screenshot, bytes)
                    or not screenshot
                    or not await asyncio.to_thread(
                        _is_valid_screenshot,
                        screenshot,
                    )
                ):
                    logger.error(
                        "Mouse post-action screen capture returned no image"
                    )
                    return ToolResult(
                        success=False,
                        output={
                            "operation": operation,
                            "action_may_have_succeeded": True,
                        },
                        error=(
                            "The mouse action may have succeeded, but no "
                            "post-action screenshot was returned. Inspect the "
                            "current screen before retrying."
                        ),
                    )
                output["screenshot_bytes"] = screenshot
            return ToolResult(success=True, output=output)
        except Exception as error:
            return ToolResult(
                success=False,
                output=None,
                error=f"Mouse operation failed ({type(error).__name__}): {error}",
            )
