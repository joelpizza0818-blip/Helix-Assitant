import mss
from PIL import Image
import io
import base64
from typing import Any, Dict, List
from .base_tool import BaseTool, ToolResult
from ..perception.screen_observation_policy import screen_observation_is_allowed
from ..perception.screen_engine import ScreenEngine
import logging

try:
    import win32gui
    _WIN32_AVAILABLE = True
except ImportError:
    win32gui = None
    _WIN32_AVAILABLE = False

from ..os.factory import get_os_adapter

class ScreenshotTool(BaseTool):
    @property
    def required_capability(self):
        return "vision"

    @property
    def name(self) -> str:
        return "screenshot_tool"

    @property
    def description(self) -> str:
        return (
            "Capture a screen, region, or selected window. On Windows, "
            "capture_window renders only the requested window without overlay "
            "occlusion; use it for an unobstructed app view."
        )

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
        if _WIN32_AVAILABLE and win32gui is not None:
            windows = []
            def callback(hwnd, extra):
                title = str(win32gui.GetWindowText(hwnd) or "").strip()
                if (
                    win32gui.IsWindowVisible(hwnd)
                    and title
                    and not title.casefold().startswith("helix")
                ):
                    windows.append(title)
                return True
            win32gui.EnumWindows(callback, None)
            return windows
        
        adapter = get_os_adapter()
        win_list = adapter.list_windows(visible_only=True)
        return [
            w.get("title", "")
            for w in win_list
            if w.get("title")
            and not str(w.get("title")).casefold().startswith("helix")
        ]

    async def capture_window(self, window_title: str) -> bytes:
        if _WIN32_AVAILABLE and win32gui is not None:
            hwnd = win32gui.FindWindow(None, window_title)
            if not hwnd:
                raise RuntimeError(f"Window not found: {window_title}")
            
            if win32gui.IsIconic(hwnd):
                raise RuntimeError(f"Window is minimized: {window_title}")
            if window_title.casefold().startswith("helix"):
                raise RuntimeError("HELIX interface windows are excluded from capture.")
            return ScreenEngine().capture_window(hwnd)
        
        raise NotImplementedError(
            "Unobstructed native-window capture is currently available only on Windows."
        )

    def save_to_file(self, image_bytes: bytes, path: str) -> str:
        with open(path, 'wb') as f:
            f.write(image_bytes)
        return path

    def to_base64(self, image_bytes: bytes) -> str:
        return base64.b64encode(image_bytes).decode('utf-8')

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not screen_observation_is_allowed():
            return ToolResult(
                success=False,
                output=None,
                error="Screen capture is disabled for this task.",
            )
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
            logger.exception("Screenshot tool operation failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"Screen capture failed ({type(e).__name__}). Check the agent log.",
            )
