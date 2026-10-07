import asyncio
import logging

from .base_tool import BaseTool, ToolResult
from ..perception.screen_engine import ScreenEngine

logger = logging.getLogger(__name__)

_SAFE_KEYS = {
    "enter", "tab", "esc", "backspace", "space", "up", "down", "left",
    "right", "home", "end",
}
_SAFE_HOTKEYS = {
    "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+s", "ctrl+z", "ctrl+y", "ctrl+f",
    "alt+tab",
}


class _KeyboardController:
    def __init__(self):
        import pyautogui

        pyautogui.FAILSAFE = True

    async def type_text(self, text: str, interval: float = 0.02) -> None:
        import pyautogui

        logger.info("Typing text with keyboard fallback")
        await asyncio.to_thread(pyautogui.write, text, interval)

    async def paste_text(self, text: str) -> None:
        import win32clipboard
        import win32con

        previous_text = None
        clipboard_open = False
        try:
            win32clipboard.OpenClipboard()
            clipboard_open = True
            formats = []
            clipboard_format = win32clipboard.EnumClipboardFormats(0)
            while clipboard_format:
                formats.append(clipboard_format)
                clipboard_format = win32clipboard.EnumClipboardFormats(
                    clipboard_format
                )
            if win32con.CF_UNICODETEXT in formats:
                previous_text = win32clipboard.GetClipboardData(
                    win32con.CF_UNICODETEXT
                )
            elif formats:
                raise RuntimeError(
                    "Clipboard contains non-text data; refusing to overwrite it"
                )
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
        finally:
            if clipboard_open:
                win32clipboard.CloseClipboard()

        try:
            await self.hotkey("ctrl", "v")
            await asyncio.sleep(0.2)
        finally:
            win32clipboard.OpenClipboard()
            try:
                current_text = None
                if win32clipboard.IsClipboardFormatAvailable(
                    win32con.CF_UNICODETEXT
                ):
                    current_text = win32clipboard.GetClipboardData(
                        win32con.CF_UNICODETEXT
                    )
                if current_text == text:
                    win32clipboard.EmptyClipboard()
                    if previous_text is not None:
                        win32clipboard.SetClipboardData(
                            win32con.CF_UNICODETEXT,
                            previous_text,
                        )
                else:
                    logger.info(
                        "Clipboard changed during paste; leaving it intact"
                    )
            finally:
                win32clipboard.CloseClipboard()

    async def press_key(self, key: str) -> None:
        import pyautogui

        await asyncio.to_thread(pyautogui.press, key)

    async def hotkey(self, *keys: str) -> None:
        import pyautogui

        await asyncio.to_thread(pyautogui.hotkey, *keys)


class KeyboardTool(_KeyboardController, BaseTool):
    @property
    def name(self) -> str:
        return "keyboard.press_key"

    @property
    def description(self) -> str:
        return "Press a safe navigation or editing key in the focused control."

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return isinstance(params.get("key"), str) and params["key"].lower() in _SAFE_KEYS

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "enum": sorted(_SAFE_KEYS)},
                },
                "required": ["key"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        key = params["key"].lower()
        try:
            await self.press_key(key)
            image = (
                await asyncio.to_thread(ScreenEngine().capture_context)
            )["screenshot_bytes"]
            return ToolResult(
                success=True,
                output={"key": key, "screenshot_bytes": image},
            )
        except Exception as error:
            logger.exception("Keyboard key press failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )


class HotkeyTool(_KeyboardController, BaseTool):
    @property
    def name(self) -> str:
        return "keyboard.hotkey"

    @property
    def description(self) -> str:
        return "Press a safe common keyboard shortcut."

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return isinstance(params.get("shortcut"), str) and (
            params["shortcut"].lower() in _SAFE_HOTKEYS
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "shortcut": {
                        "type": "string",
                        "enum": sorted(_SAFE_HOTKEYS),
                    },
                },
                "required": ["shortcut"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        shortcut = params["shortcut"].lower()
        try:
            await self.hotkey(*shortcut.split("+"))
            image = (
                await asyncio.to_thread(ScreenEngine().capture_context)
            )["screenshot_bytes"]
            return ToolResult(
                success=True,
                output={"shortcut": shortcut, "screenshot_bytes": image},
            )
        except Exception as error:
            logger.exception("Keyboard shortcut failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )
