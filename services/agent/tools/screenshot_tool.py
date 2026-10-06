import mss
from PIL import Image
import io
import base64
from typing import Any, Dict
from .base_tool import BaseTool, ToolResult

class ScreenshotTool(BaseTool):
    @property
    def name(self) -> str:
        return "screenshot_tool"

    @property
    def description(self) -> str:
        return "Tool for capturing screen regions and windows."

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

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

    async def capture_screen(self) -> bytes:
        with mss.mss() as sct:
            sct_img = sct.grab(sct.monitors[0])
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='PNG')
            return img_byte_arr.getvalue()

    async def capture_region(self, x: int, y: int, width: int, height: int) -> bytes:
        with mss.mss() as sct:
            sct_img = sct.grab({"top": y, "left": x, "width": width, "height": height})
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='PNG')
            return img_byte_arr.getvalue()

    async def capture_window(self, window_title: str) -> bytes:
        return await self.capture_screen()

    def save_to_file(self, image_bytes: bytes, path: str) -> str:
        with open(path, 'wb') as f:
            f.write(image_bytes)
        return path

    def to_base64(self, image_bytes: bytes) -> str:
        return base64.b64encode(image_bytes).decode('utf-8')

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        op = params.get("operation")
        try:
            if op == "capture_screen":
                return ToolResult(success=True, output=await self.capture_screen())
            elif op == "capture_region":
                return ToolResult(success=True, output=await self.capture_region(params["x"], params["y"], params["width"], params["height"]))
            return ToolResult(success=False, output=None, error=f"Unknown operation {op}")
        except Exception as e:
            return ToolResult(success=False, output=None, error=str(e))
