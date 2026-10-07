import mss
from PIL import Image
import io
import base64
from typing import Any, Dict, Optional, List
from .base_tool import BaseTool, ToolResult
import win32gui
import win32con

class ScreenshotTool(BaseTool):
    @property
    def name(self) -> str:
        return "screenshot_tool"

    @property
    def description(self) -> str:
        return "Tool for capturing screen regions, full screen, and specific windows."

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
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["capture_screen", "capture_region", "capture_window", "list_windows"]
                },
                "x": {"type": "integer"},
                "y": {"type": "integer"},
                "width": {"type": "integer"},
                "height": {"type": "integer"},
                "window_title": {"type": "string"}
            },
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

    async def list_windows(self) -> List[str]:
        windows = []
        def callback(hwnd, extra):
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                windows.append(win32gui.GetWindowText(hwnd))
            return True
        win32gui.EnumWindows(callback, None)
        return windows

    async def capture_window(self, window_title: str) -> bytes:
        hwnd = win32gui.FindWindow(None, window_title)
        if not hwnd:
            raise RuntimeError(f"Window not found: {window_title}")
        
        if win32gui.IsIconic(hwnd):
            raise RuntimeError(f"Window is minimized: {window_title}")
            
        rect = win32gui.GetWindowRect(hwnd)
        left, top, right, bottom = rect
        width = right - left
        height = bottom - top
        
        if width <= 0 or height <= 0:
            raise RuntimeError(f"Window has zero-size dimensions: {width}x{height}")
            
        return await self.capture_region(left, top, width, height)

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
            elif op == "capture_window":
                if "window_title" not in params:
                    return ToolResult(success=False, output=None, error="window_title is required for capture_window")
                return ToolResult(success=True, output=await self.capture_window(params["window_title"]))
            elif op == "list_windows":
                return ToolResult(success=True, output=await self.list_windows())
            return ToolResult(success=False, output=None, error=f"Unknown operation {op}")
        except Exception as e:
            return ToolResult(success=False, output=None, error=str(e))
