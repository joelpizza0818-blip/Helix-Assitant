"""Direct Windows desktop control with a separate virtual cursor.

The isolated Docker desktop remains available as an optional backend. This
client is used when the user deliberately lets HELIX work on the main Windows
desktop. The calling tool enforces the one-time host consent before this client
runs.

Normal interaction is accessibility-first: ``observe_ui`` and the element
actions use Windows UI Automation and do not move the user's physical pointer.
A virtual cursor is tracked and published to the Electron overlay for every
action. The real mouse and keyboard are only used when an application does not
expose a usable accessibility pattern, and only after the same one-time consent.
"""

import asyncio
import io
import logging
import os
import re
import shutil
import sys
import time
from typing import Any

from ..perception.ui_automation import (
    UIAutomationError,
    UIAutomationPatternUnavailable,
    UIAutomationUnavailable,
    WindowsUIAutomation,
)

logger = logging.getLogger(__name__)

_MAX_CAPTURE_BYTES = 560_000
_CAPTURE_MAX_EDGE = 1600
_CAPTURE_QUALITIES = (78, 70, 60, 50, 40)
_BUTTONS = {1: "left", 2: "middle", 3: "right"}
_KEY_ALIASES = {
    "return": "enter",
    "escape": "esc",
    "del": "delete",
    "ins": "insert",
    "page_up": "pageup",
    "page_down": "pagedown",
    "prior": "pageup",
    "next": "pagedown",
    "control": "ctrl",
    "super": "win",
    "meta": "win",
    "cmd": "win",
    "option": "alt",
}
_APPLICATION_ALIASES = {
    "calculator": "calc.exe",
    "calc": "calc.exe",
    "notepad": "notepad.exe",
    "paint": "mspaint.exe",
    "wordpad": "write.exe",
    "explorer": "explorer.exe",
    "files": "explorer.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
    "terminal": "wt.exe",
    "settings": "ms-settings:",
}


class HostDesktopUnavailable(RuntimeError):
    """The host desktop backend cannot be used on this machine."""


class HostDesktopActionError(RuntimeError):
    """A host desktop action failed without a reliable outcome."""


class HostDesktopClient:
    """Capture and operate the real Windows desktop through local APIs."""

    def __init__(
        self,
        application_tool=None,
        *,
        platform: str | None = None,
        ui_automation: WindowsUIAutomation | None = None,
    ) -> None:
        self._application_tool = application_tool
        self._platform = platform or sys.platform
        self._display_index = 0
        self._move_duration_ms = 200
        self._keystroke_delay_ms = 30
        self._fail_safe = True
        self._physical_input_allowed = False
        self._lock = asyncio.Lock()
        self._ui_automation = ui_automation
        self._virtual_cursor: dict[str, Any] = {
            "x": 0.5,
            "y": 0.5,
            "visible": False,
        }
        self._cursor_action: str | None = None
        self._cursor_clicked = False

    def configure(self, settings: dict[str, Any]) -> None:
        display_index = settings.get("display_index", 0)
        if (
            isinstance(display_index, int)
            and not isinstance(display_index, bool)
            and display_index >= 0
        ):
            self._display_index = display_index
        move_duration = settings.get("mouse_move_duration_ms", 200)
        if isinstance(move_duration, (int, float)) and not isinstance(move_duration, bool):
            self._move_duration_ms = max(0, min(2000, int(move_duration)))
        keystroke_delay = settings.get("keystroke_delay_ms", 30)
        if isinstance(keystroke_delay, (int, float)) and not isinstance(keystroke_delay, bool):
            self._keystroke_delay_ms = max(0, min(1000, int(keystroke_delay)))
        self._fail_safe = settings.get("pyautogui_fail_safe", True) is not False
        self._physical_input_allowed = (
            settings.get("computer_use_host_consent") is True
        )
        if self._platform == "win32":
            try:
                import pyautogui

                pyautogui.FAILSAFE = self._fail_safe
            except Exception:
                logger.debug("pyautogui is not available while configuring host control.")
        if self._ui_automation is not None:
            self._ui_automation.invalidate()

    @property
    def is_available(self) -> bool:
        return self._platform == "win32"

    async def execute(self, action: str, **parameters: Any) -> dict[str, Any]:
        if self._platform != "win32":
            raise HostDesktopUnavailable(
                "Direct desktop control is available only on Windows."
            )
        async with self._lock:
            if action == "launch":
                result = await self._launch(str(parameters.get("application", "")))
                await asyncio.sleep(0.8)
            elif action == "screenshot":
                hwnd, title = await asyncio.to_thread(
                    self._resolve_window,
                    parameters.get("window_handle"),
                )
                result = await asyncio.to_thread(self._capture_window, hwnd)
                result["window_handle"] = hwnd
                result["window_title"] = title
            elif action == "windows":
                result = await asyncio.to_thread(self._list_windows_sync)
            elif action == "observe_ui":
                result = await self._observe_ui(parameters.get("window_handle"))
            elif action == "click_element":
                result = await self._click_element(
                    parameters.get("window_handle"),
                    str(parameters.get("element_id", "")),
                )
            elif action == "type_into_element":
                result = await self._type_into_element(
                    parameters.get("window_handle"),
                    str(parameters.get("element_id", "")),
                    str(parameters.get("text", "")),
                )
            elif action == "focus_window":
                result = await self._focus_window(parameters.get("window_handle"))
            elif action == "point":
                result = await asyncio.to_thread(
                    self._point_only,
                    parameters,
                )
            else:
                result = await asyncio.to_thread(
                    self._execute_sync,
                    action,
                    parameters,
                )
                await asyncio.sleep(0.18)
            clicked = self._cursor_clicked
            self._cursor_clicked = False
            return {
                **result,
                "virtual_cursor": dict(self._virtual_cursor),
                "cursor_action": self._cursor_action,
                "cursor_clicked": clicked,
                "capture_source": "windows_host",
                "desktop_backend": "windows_host",
            }

    async def _launch(self, application: str) -> dict[str, Any]:
        if not application:
            raise HostDesktopActionError("An application name is required.")
        requested = _APPLICATION_ALIASES.get(application.lower(), application)
        if requested.endswith(":"):
            try:
                await asyncio.to_thread(os.startfile, requested)
            except OSError as error:
                raise HostDesktopActionError(
                    f"Windows could not open '{application}'."
                ) from error
            return {"launched": application}

        executable = shutil.which(requested) or requested
        tool = self._get_application_tool()
        result = await tool.open_application(executable)
        if result.success:
            return {"launched": application, "pid": result.pid}
        try:
            await asyncio.to_thread(os.startfile, requested)
            return {"launched": application}
        except OSError as error:
            raise HostDesktopActionError(
                f"Windows could not launch '{application}'."
            ) from error

    def _get_application_tool(self):
        if self._application_tool is None:
            try:
                from services.agent.tools.application_tool import ApplicationTool
            except ImportError:
                from tools.application_tool import ApplicationTool
            self._application_tool = ApplicationTool()
        return self._application_tool

    async def _observe_ui(self, window_handle: Any) -> dict[str, Any]:
        hwnd, title = await asyncio.to_thread(
            self._resolve_window,
            window_handle,
        )
        snapshot = await asyncio.to_thread(
            self._ui,
            hwnd,
            title,
        )
        rectangle = await asyncio.to_thread(self._window_rect, hwnd)
        self._set_cursor_from_native(
            rectangle["x"] + max(1, rectangle["width"]) / 2,
            rectangle["y"] + max(1, rectangle["height"]) / 2,
            self._monitor_bounds(),
            "observe",
        )
        return {
            "window_handle": hwnd,
            "window_title": title,
            "elements": snapshot["elements"],
            "element_count": len(snapshot["elements"]),
        }

    async def _click_element(
        self,
        window_handle: Any,
        element_id: str,
    ) -> dict[str, Any]:
        if not element_id:
            raise HostDesktopActionError("An accessibility element ID is required.")
        hwnd, title = await asyncio.to_thread(
            self._resolve_window,
            window_handle,
        )
        info = await asyncio.to_thread(
            self._uiautomation.element_info,
            hwnd,
            element_id,
        )
        bounds = info["bounding_box"]
        center_x = int(bounds["x"]) + max(1, int(bounds["width"])) // 2
        center_y = int(bounds["y"]) + max(1, int(bounds["height"])) // 2
        self._set_cursor_from_native(
            center_x,
            center_y,
            self._monitor_bounds(),
            "click",
            clicked=True,
        )
        try:
            method = await asyncio.to_thread(
                self._uiautomation.click_element,
                hwnd,
                element_id,
            )
        except UIAutomationPatternUnavailable as error:
            if not self._physical_input_allowed:
                raise HostDesktopActionError(
                    "This element does not support an accessibility Invoke "
                    "pattern. Allowing HELIX to use the real mouse once in "
                    "Computer Use settings would enable the visual fallback."
                ) from error
            self._click_native(center_x, center_y, "left")
            method = "physical_fallback"
        except UIAutomationError as error:
            raise HostDesktopActionError(
                "The accessibility element changed or became unavailable; "
                "HELIX did not use physical input."
            ) from error
        return {
            "window_handle": hwnd,
            "window_title": title,
            "element_id": element_id,
            "element_name": info.get("name", ""),
            "method": method,
            "clicked": True,
        }

    async def _type_into_element(
        self,
        window_handle: Any,
        element_id: str,
        text: str,
    ) -> dict[str, Any]:
        if not element_id:
            raise HostDesktopActionError("An accessibility element ID is required.")
        if not text:
            raise HostDesktopActionError("Text to type is required.")
        hwnd, title = await asyncio.to_thread(
            self._resolve_window,
            window_handle,
        )
        info = await asyncio.to_thread(
            self._uiautomation.element_info,
            hwnd,
            element_id,
        )
        bounds = info["bounding_box"]
        self._set_cursor_from_native(
            int(bounds["x"]) + max(1, int(bounds["width"])) // 2,
            int(bounds["y"]) + max(1, int(bounds["height"])) // 2,
            self._monitor_bounds(),
            "type",
        )
        try:
            method = await asyncio.to_thread(
                self._uiautomation.set_value_or_focus,
                hwnd,
                element_id,
                text,
                allow_focus=self._physical_input_allowed,
            )
        except UIAutomationUnavailable:
            raise
        except UIAutomationError as error:
            raise HostDesktopActionError(
                "This element does not support a safe accessibility Value "
                "pattern. Allowing HELIX to use the real keyboard once in "
                "Computer Use settings would enable the visual fallback."
            ) from error
        if method == "focus_only":
            self._type_text(self._require_pyautogui(), text)
        return {
            "window_handle": hwnd,
            "window_title": title,
            "element_id": element_id,
            "element_name": info.get("name", ""),
            "method": method,
            "typed_characters": len(text),
        }

    async def _focus_window(self, window_handle: Any) -> dict[str, Any]:
        hwnd, title = await asyncio.to_thread(
            self._resolve_window,
            window_handle,
        )
        await asyncio.to_thread(self._focus_window_sync, hwnd)
        rectangle = await asyncio.to_thread(self._window_rect, hwnd)
        self._set_cursor_from_native(
            rectangle["x"] + max(1, rectangle["width"]) / 2,
            rectangle["y"] + max(1, rectangle["height"]) / 2,
            self._monitor_bounds(),
            "focus",
        )
        return {
            "window_handle": hwnd,
            "window_title": title,
            "focused": True,
        }

    def _point_only(self, parameters: dict[str, Any]) -> dict[str, Any]:
        monitor = self._monitor_bounds()
        x, y = self._point(parameters, monitor)
        self._set_cursor_from_native(x, y, monitor, "point")
        return {
            "pointed": True,
            "x": parameters.get("x"),
            "y": parameters.get("y"),
        }

    def _execute_sync(self, action: str, parameters: dict[str, Any]) -> dict[str, Any]:
        pyautogui = self._require_pyautogui()
        monitor = self._monitor_bounds()

        if action == "move":
            x, y = self._point(parameters, monitor)
            self._set_cursor_from_native(x, y, monitor, "move")
            return {"moved": True, "physical": False}

        if action in {"click", "double_click", "right_click"}:
            self._require_physical_input()
            x, y = self._point(parameters, monitor)
            self._invalidate_ui_snapshot()
            action_name = action
            clicked = True
            if action == "click":
                button_number = parameters.get("button", 1)
                if button_number not in _BUTTONS:
                    raise HostDesktopActionError("Mouse button must be 1, 2, or 3.")
                self._set_cursor_from_native(x, y, monitor, "click", clicked=True)
                self._with_physical_cursor(
                    pyautogui,
                    x,
                    y,
                    lambda: pyautogui.click(x, y, button=_BUTTONS[button_number]),
                )
            elif action == "double_click":
                self._set_cursor_from_native(
                    x,
                    y,
                    monitor,
                    "double_click",
                    clicked=True,
                )
                self._with_physical_cursor(
                    pyautogui,
                    x,
                    y,
                    lambda: pyautogui.doubleClick(x, y),
                )
            else:
                self._set_cursor_from_native(
                    x,
                    y,
                    monitor,
                    "right_click",
                    clicked=True,
                )
                self._with_physical_cursor(
                    pyautogui,
                    x,
                    y,
                    lambda: pyautogui.rightClick(x, y),
                )
            return {
                "clicked": True,
                "action": action_name,
                "x": parameters["x"],
                "y": parameters["y"],
                "clicked_state": clicked,
            }

        if action == "drag":
            self._require_physical_input()
            from_x, from_y = self._point(parameters, monitor, prefix="from_")
            to_x, to_y = self._point(parameters, monitor, prefix="to_")
            duration = parameters.get("duration", 0.4)
            if not isinstance(duration, (int, float)) or isinstance(duration, bool):
                duration = 0.4
            self._invalidate_ui_snapshot()
            self._set_cursor_from_native(to_x, to_y, monitor, "drag")

            def drag() -> None:
                pyautogui.moveTo(from_x, from_y)
                pyautogui.dragTo(
                    to_x,
                    to_y,
                    duration=max(0.1, min(3.0, float(duration))),
                    button="left",
                )

            self._with_physical_cursor(pyautogui, to_x, to_y, drag)
            return {"dragged": True}

        if action == "type":
            self._require_physical_input()
            text = parameters.get("text")
            if not isinstance(text, str) or not text:
                raise HostDesktopActionError("Text to type is required.")
            self._ensure_cursor_visible(monitor, "type")
            self._invalidate_ui_snapshot()
            self._type_text(pyautogui, text)
            return {"typed_characters": len(text)}

        if action == "key":
            self._require_physical_input()
            key = parameters.get("key")
            if not isinstance(key, str) or not key:
                raise HostDesktopActionError("A key is required.")
            self._ensure_cursor_visible(monitor, "key")
            self._invalidate_ui_snapshot()
            self._press_key(pyautogui, key)
            return {"pressed": key}

        if action == "scroll":
            self._require_physical_input()
            direction = parameters.get("direction")
            amount = parameters.get("amount", 3)
            if direction not in {"up", "down", "left", "right"}:
                raise HostDesktopActionError("Scroll direction is invalid.")
            if not isinstance(amount, int) or isinstance(amount, bool) or not 1 <= amount <= 20:
                raise HostDesktopActionError("Scroll amount must be between 1 and 20.")
            self._ensure_cursor_visible(monitor, "scroll")
            target = self._native_cursor(monitor)
            self._invalidate_ui_snapshot()

            def scroll() -> None:
                if direction in {"up", "down"}:
                    pyautogui.scroll(amount if direction == "up" else -amount)
                else:
                    pyautogui.hscroll(amount if direction == "right" else -amount)

            self._with_physical_cursor(pyautogui, target[0], target[1], scroll)
            return {"scrolled": direction, "amount": amount}

        raise HostDesktopActionError(f"Unsupported host desktop action: {action}")

    def _with_physical_cursor(self, pyautogui, x: int, y: int, action) -> None:
        previous = self._physical_cursor_position(pyautogui)
        try:
            action()
        finally:
            if previous is not None:
                try:
                    pyautogui.moveTo(previous[0], previous[1], duration=0)
                except Exception:
                    logger.debug("Could not restore the user's physical cursor.")

    @staticmethod
    def _physical_cursor_position(pyautogui) -> tuple[int, int] | None:
        position = getattr(pyautogui, "position", None)
        if not callable(position):
            return None
        try:
            value = position()
            return int(value[0]), int(value[1])
        except Exception:
            return None

    def _click_native(self, x: int, y: int, button: str) -> None:
        pyautogui = self._require_pyautogui()
        self._with_physical_cursor(
            pyautogui,
            x,
            y,
            lambda: pyautogui.click(x, y, button=button),
        )

    def _point(
        self,
        parameters: dict[str, Any],
        monitor: dict[str, int],
        *,
        prefix: str = "",
    ) -> tuple[int, int]:
        x = parameters.get(f"{prefix}x")
        y = parameters.get(f"{prefix}y")
        if (
            not isinstance(x, int)
            or isinstance(x, bool)
            or not isinstance(y, int)
            or isinstance(y, bool)
            or x < 0
            or y < 0
        ):
            raise HostDesktopActionError("Screen coordinates are invalid.")
        # Captures are scaled down to _CAPTURE_MAX_EDGE. Coordinates refer to
        # pixels in the screenshot the model received, so map them back to the
        # native screen before tracking the virtual cursor or using fallback
        # physical input.
        scale = min(
            1.0,
            _CAPTURE_MAX_EDGE / max(int(monitor["width"]), int(monitor["height"])),
        )
        return (
            int(monitor["left"]) + int(round(x / scale)),
            int(monitor["top"]) + int(round(y / scale)),
        )

    def _set_cursor_from_native(
        self,
        x: float,
        y: float,
        monitor: dict[str, int],
        action: str,
        *,
        clicked: bool = False,
    ) -> None:
        width = max(1, int(monitor["width"]))
        height = max(1, int(monitor["height"]))
        normalized_x = (float(x) - int(monitor["left"])) / width
        normalized_y = (float(y) - int(monitor["top"])) / height
        self._virtual_cursor = {
            "x": round(max(0.0, min(1.0, normalized_x)), 4),
            "y": round(max(0.0, min(1.0, normalized_y)), 4),
            "visible": True,
        }
        self._cursor_action = action
        self._cursor_clicked = clicked

    def _ensure_cursor_visible(
        self,
        monitor: dict[str, int],
        action: str,
    ) -> None:
        if self._virtual_cursor.get("visible") is not True:
            self._set_cursor_from_native(
                int(monitor["left"]) + int(monitor["width"]) / 2,
                int(monitor["top"]) + int(monitor["height"]) / 2,
                monitor,
                action,
            )
        else:
            self._cursor_action = action

    def _native_cursor(self, monitor: dict[str, int]) -> tuple[int, int]:
        return (
            int(monitor["left"])
            + int(round(float(self._virtual_cursor["x"]) * int(monitor["width"]))),
            int(monitor["top"])
            + int(round(float(self._virtual_cursor["y"]) * int(monitor["height"]))),
        )

    def _type_text(self, pyautogui, text: str) -> None:
        delay = max(0.0, self._keystroke_delay_ms / 1000)
        if text.isascii():
            lines = re.split(r"\r\n|\r|\n", text)
            for index, line in enumerate(lines):
                if line:
                    pyautogui.write(line, interval=delay)
                if index < len(lines) - 1:
                    pyautogui.press("enter")
            return
        self._paste_unicode(pyautogui, text)

    def _paste_unicode(self, pyautogui, text: str) -> None:
        try:
            import win32clipboard
        except ImportError as error:
            raise HostDesktopActionError(
                "Typing non-ASCII text requires Windows clipboard support."
            ) from error

        previous: str | None = None
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(
                    win32clipboard.CF_UNICODETEXT
                ):
                    previous = win32clipboard.GetClipboardData(
                        win32clipboard.CF_UNICODETEXT
                    )
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            previous = None

        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
            finally:
                win32clipboard.CloseClipboard()
        except Exception as error:
            raise HostDesktopActionError(
                "HELIX could not place the text on the Windows clipboard."
            ) from error

        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.45)
        if previous is None:
            return
        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardText(
                    previous,
                    win32clipboard.CF_UNICODETEXT,
                )
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            logger.debug("Could not restore the previous clipboard contents.")

    def _press_key(self, pyautogui, key: str) -> None:
        parts = [part.strip().lower() for part in key.split("+")]
        if not parts or any(not part for part in parts):
            raise HostDesktopActionError("The key combination is invalid.")
        mapped = [_KEY_ALIASES.get(part, part) for part in parts]
        allowed = {str(value).lower() for value in pyautogui.KEYBOARD_KEYS}
        allowed.update({"ctrl", "alt", "shift", "win", "winleft", "winright", "command"})
        if any(part not in allowed for part in mapped):
            raise HostDesktopActionError("The key combination contains an unknown key.")
        if len(mapped) == 1:
            pyautogui.press(mapped[0])
        else:
            pyautogui.hotkey(*mapped)

    def _require_physical_input(self) -> None:
        if self._physical_input_allowed:
            return
        raise HostDesktopActionError(
            "This action needs the real mouse or keyboard. The user must allow "
            "physical-input fallback once in Computer Use settings."
        )

    def _invalidate_ui_snapshot(self) -> None:
        if self._ui_automation is not None:
            self._ui_automation.invalidate()

    @property
    def _uiautomation(self) -> WindowsUIAutomation:
        if self._ui_automation is None:
            self._ui_automation = WindowsUIAutomation(100, 5, 30_000)
        return self._ui_automation

    def _ui(
        self,
        hwnd: int,
        title: str,
    ) -> dict[str, Any]:
        try:
            return self._uiautomation.observe(hwnd, title)
        except UIAutomationUnavailable:
            raise
        except UIAutomationError:
            raise

    @staticmethod
    def _require_pyautogui():
        try:
            import pyautogui

            return pyautogui
        except Exception as error:
            raise HostDesktopUnavailable(
                "Direct desktop input is unavailable because pyautogui could not start."
            ) from error

    def _monitor_bounds(self) -> dict[str, int]:
        try:
            import mss
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Desktop capture is unavailable because mss is not installed."
            ) from error
        with mss.mss() as capture:
            monitors = capture.monitors
            index = min(self._display_index + 1, len(monitors) - 1)
            monitor = monitors[index]
        return {
            "left": int(monitor["left"]),
            "top": int(monitor["top"]),
            "width": int(monitor["width"]),
            "height": int(monitor["height"]),
        }

    def _capture_window(self, hwnd: int) -> dict[str, Any]:
        try:
            from PIL import Image
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Window capture requires Pillow."
            ) from error

        try:
            try:
                from services.agent.perception.screen_engine import ScreenEngine
            except ImportError:
                from perception.screen_engine import ScreenEngine
            raw_image = ScreenEngine().capture_window(hwnd)
        except ImportError as error:
            raise HostDesktopUnavailable(
                "The agent window-capture engine is unavailable."
            ) from error
        except (RuntimeError, ValueError) as error:
            raise HostDesktopActionError(str(error)) from error
        image = Image.open(io.BytesIO(raw_image)).convert("RGB")
        bounds = self._window_rect(hwnd)

        image.thumbnail((_CAPTURE_MAX_EDGE, _CAPTURE_MAX_EDGE))
        image_bytes = b""
        for quality in _CAPTURE_QUALITIES:
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=quality, optimize=True)
            image_bytes = buffer.getvalue()
            if len(image_bytes) <= _MAX_CAPTURE_BYTES:
                break
        if not image_bytes or len(image_bytes) > _MAX_CAPTURE_BYTES:
            raise HostDesktopUnavailable(
                "The target window capture exceeded the allowed image size."
            )

        return {
            "screenshot_bytes": image_bytes,
            "mime_type": "image/jpeg",
            "capture_size": {
                "width": int(image.width),
                "height": int(image.height),
            },
            "capture_bounds": {
                "x": bounds["x"],
                "y": bounds["y"],
                "width": bounds["width"],
                "height": bounds["height"],
            },
            "coordinate_space": "window_local",
            "capture_method": "PrintWindow",
        }

    @staticmethod
    def _resolve_window(window_handle: Any) -> tuple[int, str]:
        try:
            import win32gui
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Window access requires the pywin32 package."
            ) from error
        if window_handle is None:
            hwnd = int(win32gui.GetForegroundWindow())
        elif isinstance(window_handle, int) and not isinstance(window_handle, bool):
            hwnd = int(window_handle)
        else:
            raise HostDesktopActionError("The window handle is invalid.")
        if hwnd <= 0 or not win32gui.IsWindow(hwnd):
            raise HostDesktopActionError(
                "The target window no longer exists. List the open windows again."
            )
        title = str(win32gui.GetWindowText(hwnd) or "").strip()
        if HostDesktopClient._is_helix_window(title):
            raise HostDesktopActionError(
                "HELIX interface windows are excluded from desktop observation."
            )
        return hwnd, title

    @staticmethod
    def _is_helix_window(title: str) -> bool:
        return title.casefold().startswith("helix")

    @staticmethod
    def _window_rect(hwnd: int) -> dict[str, int]:
        try:
            import win32gui
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Window access requires the pywin32 package."
            ) from error
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        return {
            "x": int(left),
            "y": int(top),
            "width": max(0, int(right - left)),
            "height": max(0, int(bottom - top)),
        }

    @staticmethod
    def _focus_window_sync(hwnd: int) -> None:
        try:
            import win32con
            import win32gui
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Window access requires the pywin32 package."
            ) from error
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        try:
            win32gui.SetForegroundWindow(hwnd)
        except Exception as error:
            raise HostDesktopActionError(
                "Windows did not allow HELIX to focus that window."
            ) from error

    @staticmethod
    def _list_windows_sync() -> dict[str, Any]:
        try:
            import win32gui
            import win32process
        except ImportError as error:
            raise HostDesktopUnavailable(
                "Window access requires the pywin32 package."
            ) from error

        foreground = int(win32gui.GetForegroundWindow())
        windows: list[dict[str, Any]] = []

        def collect(hwnd: int, _extra) -> bool:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = str(win32gui.GetWindowText(hwnd) or "").strip()
            if not title:
                return True
            try:
                left, top, right, bottom = win32gui.GetWindowRect(hwnd)
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                if title.casefold().startswith("helix"):
                    return True
            except Exception:
                return True
            width = max(0, int(right - left))
            height = max(0, int(bottom - top))
            if width <= 0 or height <= 0:
                return True
            windows.append({
                "window_handle": int(hwnd),
                "title": title[:200],
                "pid": int(pid),
                "bounds": {
                    "x": int(left),
                    "y": int(top),
                    "width": width,
                    "height": height,
                },
                "is_foreground": int(hwnd) == foreground,
                "is_minimized": bool(win32gui.IsIconic(hwnd)),
            })
            return True

        win32gui.EnumWindows(collect, None)
        windows.sort(
            key=lambda item: (
                item["is_foreground"],
                item["bounds"]["width"] * item["bounds"]["height"],
            ),
            reverse=True,
        )
        return {"windows": windows[:80], "window_count": len(windows)}

    @staticmethod
    def _cursor_position(monitor: dict[str, Any]) -> dict[str, Any]:
        """Legacy helper retained for callers that still request the physical pointer."""
        try:
            import win32api

            x, y = win32api.GetCursorPos()
        except Exception:
            return {"x": 0.0, "y": 0.0, "visible": False}
        left = int(monitor["left"])
        top = int(monitor["top"])
        width = max(1, int(monitor["width"]))
        height = max(1, int(monitor["height"]))
        visible = left <= x < left + width and top <= y < top + height
        return {
            "x": max(0.0, min(1.0, (x - left) / width)),
            "y": max(0.0, min(1.0, (y - top) / height)),
            "visible": visible,
        }
