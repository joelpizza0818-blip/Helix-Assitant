import pyautogui
import asyncio
from typing import Any, Dict, Tuple
from .base_tool import BaseTool, ToolResult

class MouseTool(BaseTool):
    def __init__(self):
        self.move_duration = 0.1

    def configure(self, settings: Dict[str, Any]) -> None:
        value = settings.get('mouse_move_duration_ms', 200)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            self.move_duration = max(0.05, min(1.0, float(value) / 1000))

    @property
    def name(self) -> str:
        return "mouse_tool"

    @property
    def description(self) -> str:
        return "Tool for controlling the mouse."

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return "operation" in params

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {"operation": {"type": "string"}},
            "required": ["operation"]
        }

    async def move(self, x: int, y: int) -> None:
        pyautogui.moveTo(x, y, duration=self.move_duration)
        await asyncio.sleep(0.05)

    async def click(self, x: int, y: int, button: str = 'left') -> None:
        pyautogui.click(x=x, y=y, button=button)
        await asyncio.sleep(0.05)

    async def double_click(self, x: int, y: int) -> None:
        pyautogui.doubleClick(x=x, y=y)
        await asyncio.sleep(0.05)

    async def right_click(self, x: int, y: int) -> None:
        pyautogui.rightClick(x=x, y=y)
        await asyncio.sleep(0.05)

    async def drag(self, from_x: int, from_y: int, to_x: int, to_y: int, duration: float = 0.5) -> None:
        pyautogui.moveTo(from_x, from_y)
        pyautogui.dragTo(to_x, to_y, duration=duration, button='left')
        await asyncio.sleep(0.05)

    async def scroll(self, x: int, y: int, amount: int) -> None:
        pyautogui.moveTo(x, y)
        pyautogui.scroll(amount)
        await asyncio.sleep(0.05)

    async def get_position(self) -> Tuple[int, int]:
        pos = pyautogui.position()
        return pos.x, pos.y

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        op = params.get("operation")
        try:
            if op == "move":
                await self.move(params["x"], params["y"])
            elif op == "click":
                await self.click(params["x"], params["y"], params.get("button", "left"))
            elif op == "double_click":
                await self.double_click(params["x"], params["y"])
            elif op == "right_click":
                await self.right_click(params["x"], params["y"])
            elif op == "drag":
                await self.drag(params["from_x"], params["from_y"], params["to_x"], params["to_y"], params.get("duration", 0.5))
            elif op == "scroll":
                await self.scroll(params["x"], params["y"], params["amount"])
            elif op == "get_position":
                x, y = await self.get_position()
                return ToolResult(success=True, output={"x": x, "y": y})
            return ToolResult(success=True, output=True)
        except Exception as e:
            return ToolResult(success=False, output=None, error=str(e))
