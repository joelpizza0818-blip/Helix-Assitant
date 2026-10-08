import asyncio
import logging
from typing import Any, Callable, Optional

from .base_tool import BaseTool, ToolResult
from ..perception.screen_engine import ScreenEngine

logger = logging.getLogger(__name__)


class _ComputerActions:
    def __init__(self):
        self.screen_engine = ScreenEngine()
        self._ocr_engine = None
        self.ocr_provider = "easyocr"

    def configure(self, settings: dict) -> None:
        self.screen_engine.configure(settings)
        requested = settings.get("ocr_engine", "local")
        self.ocr_provider = "pytesseract" if requested == "windows_media_ocr" else "easyocr"
        self._ocr_engine = None

    def _get_ocr_engine(self):
        if self._ocr_engine is None:
            from ..perception.ocr_engine import OCREngine

            self._ocr_engine = OCREngine(provider=self.ocr_provider)
        return self._ocr_engine

    async def capture_context(self, include_ocr: bool = True) -> dict:
        if not include_ocr:
            return await asyncio.to_thread(self.screen_engine.capture_context)
        try:
            ocr_engine = await asyncio.to_thread(self._get_ocr_engine)
        except Exception as error:
            logger.exception("OCR could not be initialized")
            return await asyncio.to_thread(
                self.screen_engine.capture_context,
                None,
                f"{type(error).__name__}: {error}",
            )
        return await asyncio.to_thread(
            self.screen_engine.capture_context,
            ocr_engine,
        )

    async def _click(self, x: int, y: int) -> None:
        import pyautogui

        await asyncio.to_thread(pyautogui.click, x=x, y=y)

    async def _locate_text(self, image: bytes, text: str) -> Optional[tuple[int, int]]:
        try:
            ocr_engine = await asyncio.to_thread(self._get_ocr_engine)
            position = await asyncio.to_thread(ocr_engine.find_text, image, text)
            if position:
                return position
        except Exception:
            logger.exception("OCR could not locate visible text")
        return None

    async def click_on_text(self, text_on_screen: str) -> bool:
        image = await asyncio.to_thread(self.screen_engine.capture_full)
        position = await self._locate_text(image, text_on_screen)
        if position is None:
            logger.warning("Could not locate requested screen text")
            return False
        await self._click(*position)
        return True

    async def click_on_element(self, element_description: str) -> bool:
        window = await asyncio.to_thread(self.screen_engine.get_active_window_info)
        hwnd = window.get("hwnd") if window else None
        try:
            clicked = await asyncio.to_thread(
                self.screen_engine.click_ui_element,
                element_description,
                hwnd,
            )
            if clicked:
                return True
        except Exception as error:
            logger.warning("UI Automation could not click the element: %s", error)

        return await self.click_on_text(element_description)

    async def _screen_text(self) -> str:
        ocr_engine = await asyncio.to_thread(self._get_ocr_engine)
        image = await asyncio.to_thread(self.screen_engine.capture_full)
        return await asyncio.to_thread(ocr_engine.extract_text, image)

    async def _wait_for_text(self, expected_text: str, timeout: float = 3.0) -> bool:
        if not expected_text.strip():
            raise ValueError("Text to enter must not be empty")
        deadline = asyncio.get_running_loop().time() + timeout
        expected = " ".join(expected_text.casefold().split())
        while asyncio.get_running_loop().time() < deadline:
            visible = " ".join((await self._screen_text()).casefold().split())
            if expected in visible:
                return True
            await asyncio.sleep(0.25)
        return False

    async def type_in_field(self, field_description: str, text: str) -> bool:
        if not await self.click_on_element(field_description):
            return False
        from .keyboard_tool import KeyboardTool

        keyboard = KeyboardTool()
        methods: list[Callable[[str], Any]] = [
            keyboard.paste_text,
            keyboard.type_text,
        ]
        for index, method in enumerate(methods):
            try:
                await method(text)
            except Exception:
                logger.exception("Input method failed; checking the field before retry")
            if await self._wait_for_text(text):
                return True
            if index + 1 < len(methods):
                if not await self.click_on_element(field_description):
                    return False
                await keyboard.hotkey("ctrl", "a")
        logger.warning("Entered text could not be verified with OCR")
        return False


class ScreenObserveTool(_ComputerActions, BaseTool):
    @property
    def name(self) -> str:
        return "computer.observe_screen"

    @property
    def description(self) -> str:
        return (
            "Capture the current screen, active window, accessibility tree, and "
            "OCR text. Use this before acting on the desktop."
        )

    @property
    def permission_level(self) -> str:
        return "READ_ONLY"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return not params

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        try:
            context = await self.capture_context()
            return ToolResult(success=True, output=context)
        except Exception as error:
            logger.exception("Screen observation failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )


class ComputerTool(_ComputerActions, BaseTool):
    @property
    def name(self) -> str:
        return "computer.click_element"

    @property
    def description(self) -> str:
        return "Click a visible named control using UI Automation, then OCR as fallback."

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return isinstance(params.get("description"), str) and bool(
            params["description"].strip()
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Visible name of the control to click",
                    },
                },
                "required": ["description"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        description = params["description"].strip()
        try:
            clicked = await self.click_on_element(description)
            if not clicked:
                return ToolResult(
                    success=False,
                    output=None,
                    error=f"Could not locate visible control: {description}",
                )
            context = await self.capture_context()
            context.pop("screenshot_bytes", None)
            return ToolResult(
                success=True,
                output={
                    "clicked": description,
                    "screen_after_action": context,
                    "screenshot_bytes": (
                        await self.capture_context(include_ocr=False)
                    )["screenshot_bytes"],
                },
            )
        except Exception as error:
            logger.exception("Clicking UI element failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )


class ClickTextTool(_ComputerActions, BaseTool):
    @property
    def name(self) -> str:
        return "computer.click_text"

    @property
    def description(self) -> str:
        return "Locate visible text through OCR and click its screen position."

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return isinstance(params.get("text"), str) and bool(params["text"].strip())

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Exact or distinctive visible text",
                    },
                },
                "required": ["text"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        text = params["text"].strip()
        try:
            if not await self.click_on_text(text):
                return ToolResult(
                    success=False,
                    output=None,
                    error=f"Could not locate visible text: {text}",
                )
            context = await self.capture_context()
            context.pop("screenshot_bytes", None)
            after_action = await self.capture_context(include_ocr=False)
            context["screenshot_bytes"] = after_action["screenshot_bytes"]
            return ToolResult(success=True, output=context)
        except Exception as error:
            logger.exception("Clicking visible text failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )


class VisualClickTool(_ComputerActions, BaseTool):
    @property
    def name(self) -> str:
        return "computer.click_at"

    @property
    def description(self) -> str:
        return (
            "Fallback for a visible target identified from the latest screenshot "
            "when UI Automation and OCR cannot locate it."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: dict) -> bool:
        return (
            isinstance(params.get("x"), int)
            and not isinstance(params.get("x"), bool)
            and isinstance(params.get("y"), int)
            and not isinstance(params.get("y"), bool)
            and 0 <= params["x"] <= 32767
            and 0 <= params["y"] <= 32767
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "minimum": 0},
                    "y": {"type": "integer", "minimum": 0},
                },
                "required": ["x", "y"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        try:
            width, height = await asyncio.to_thread(
                self.screen_engine.get_screen_resolution
            )
            if params["x"] >= width or params["y"] >= height:
                return ToolResult(
                    success=False,
                    output=None,
                    error="Click coordinates are outside the primary screen bounds.",
                )
            await self._click(params["x"], params["y"])
            context = await self.capture_context()
            context.pop("screenshot_bytes", None)
            after_action = await self.capture_context(include_ocr=False)
            return ToolResult(
                success=True,
                output={
                    "clicked_at": {"x": params["x"], "y": params["y"]},
                    "screen_after_action": context,
                    "screenshot_bytes": after_action["screenshot_bytes"],
                },
            )
        except Exception as error:
            logger.exception("Visual screen click failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )


class TypeInFieldTool(_ComputerActions, BaseTool):
    @property
    def name(self) -> str:
        return "computer.type_in_field"

    @property
    def description(self) -> str:
        return (
            "Focus a visible text field, paste requested text, verify it with OCR, "
            "and retry using keyboard input if necessary."
        )

    @property
    def permission_level(self) -> str:
        return "MODIFY"

    @property
    def requires_confirmation(self) -> bool:
        return True

    def validate_params(self, params: dict) -> bool:
        return (
            isinstance(params.get("field_description"), str)
            and bool(params["field_description"].strip())
            and isinstance(params.get("text"), str)
            and bool(params["text"])
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "field_description": {
                        "type": "string",
                        "description": "Visible label or description of the text field",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text explicitly requested by the user",
                    },
                },
                "required": ["field_description", "text"],
            },
        }

    async def execute(self, params: dict) -> ToolResult:
        try:
            verified = await self.type_in_field(
                params["field_description"].strip(),
                params["text"],
            )
            if not verified:
                return ToolResult(
                    success=False,
                    output=None,
                    error="Text could not be verified on screen; it may not have been entered.",
                )
            context = await self.capture_context()
            context.pop("screenshot_bytes", None)
            after_action = await self.capture_context(include_ocr=False)
            return ToolResult(
                success=True,
                output={
                    "verified": True,
                    "field": params["field_description"],
                    "screen_after_action": context,
                    "screenshot_bytes": after_action["screenshot_bytes"],
                },
            )
        except Exception as error:
            logger.exception("Typing into UI field failed")
            return ToolResult(
                success=False,
                output=None,
                error=f"{type(error).__name__}: {error}",
            )
