from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from .base_tool import BaseTool, ToolResult

logger = logging.getLogger(__name__)

# Singleton or managed browser session
_active_browser_session = None
_active_extension_session_id: str | None = None


class BrowserControlTool(BaseTool):
    """Direct browser automation control tool (Operator mode for HELIX).

    Allows HELIX to navigate the web, click elements, fill forms, scroll,
    press keys, capture screenshots, and read interactive web pages directly.
    """

    @property
    def name(self) -> str:
        return "browser_control"

    @property
    def description(self) -> str:
        return (
            "Control a dedicated HELIX tab in the paired Chrome/Edge browser. Other browser tabs are not controlled. "
            "Navigate, inspect the page and its numbered controls, click/fill elements, or use the virtual page mouse "
            "with viewport coordinates from a screenshot when using HELIX's isolated browser mode. "
            "Typing does not submit by default; submit only when the user requested it. Ask before sending, "
            "publishing, purchasing, deleting, or other irreversible actions."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def get_schema(self) -> Dict[str, Any]:
        actions = [
            "navigate",
            "click",
            "move_mouse",
            "click_at",
            "double_click_at",
            "drag",
            "type",
            "scroll",
            "scroll_at",
            "press_key",
            "screenshot",
            "get_content",
            "go_back",
            "refresh",
            "close",
        ]
        if os.environ.get("HELIX_BROWSER_CONTROL_MODE") == "extension":
            actions.remove("drag")
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": actions,
                    "description": "The browser action to perform.",
                },
                "url": {
                    "type": "string",
                    "description": "The website URL to navigate to (e.g., https://google.com).",
                },
                "selector": {
                    "type": "string",
                    "description": "CSS selector or text content of the element to click or type into.",
                },
                "x": {
                    "type": "integer",
                    "description": "Horizontal page coordinate in CSS pixels.",
                },
                "y": {
                    "type": "integer",
                    "description": "Vertical page coordinate in CSS pixels.",
                },
                "end_x": {
                    "type": "integer",
                    "description": "Horizontal destination coordinate for a drag.",
                },
                "end_y": {
                    "type": "integer",
                    "description": "Vertical destination coordinate for a drag.",
                },
                "button": {
                    "type": "string",
                    "enum": ["left", "right", "middle"],
                    "description": "Mouse button for click_at (default: left).",
                },
                "text": {
                    "type": "string",
                    "description": "The text to type into the selected input field.",
                },
                "submit": {
                    "type": "boolean",
                    "description": "Press Enter after filling only when the user asked to submit (default: false).",
                },
                "direction": {
                    "type": "string",
                    "enum": ["down", "up", "left", "right"],
                    "description": "Direction to scroll (default: 'down').",
                },
                "amount": {
                    "type": "integer",
                    "description": "Number of pixels to scroll (default: 500).",
                },
                "key": {
                    "type": "string",
                    "description": "Key name to press (e.g., 'Enter', 'Tab', 'Escape').",
                },
            },
            "required": ["action"],
        }

    def validate_params(self, params: Dict[str, Any]) -> bool:
        if not isinstance(params, dict):
            return False
        action = params.get("action")
        allowed = {
            "navigate", "click", "move_mouse", "click_at", "double_click_at",
            "drag", "type", "scroll", "scroll_at", "press_key", "screenshot",
            "get_content", "go_back", "refresh", "close",
        }
        if action not in allowed:
            return False
        coordinate_actions = {
            "move_mouse", "click_at", "double_click_at", "scroll_at",
        }
        if action in coordinate_actions or action == "drag":
            coordinate_keys = ["x", "y"]
            if action == "drag":
                coordinate_keys.extend(["end_x", "end_y"])
            if any(
                not isinstance(params.get(key), int)
                or isinstance(params.get(key), bool)
                or not 0 <= params[key] <= 10000
                for key in coordinate_keys
            ):
                return False
            if action == "click_at" and params.get("button", "left") not in {
                "left", "right", "middle",
            }:
                return False
            if action == "scroll_at":
                direction = params.get("direction", "down")
                amount = params.get("amount", 500)
                return (
                    direction in {"up", "down", "left", "right"}
                    and isinstance(amount, int)
                    and not isinstance(amount, bool)
                    and 1 <= amount <= 3000
                )
            return True
        if action == "navigate":
            url = params.get("url")
            if not isinstance(url, str) or not url.strip():
                return False
            candidate = url.strip()
            if "://" not in candidate:
                authority = candidate.split("/", 1)[0]
                if ":" in authority and not authority.startswith("["):
                    host, _, port = authority.partition(":")
                    if not host or not port.isdecimal() or not 1 <= int(port) <= 65535:
                        return False
                candidate = f"https://{candidate}"
            parsed = urlparse(candidate)
            try:
                port = parsed.port
            except ValueError:
                return False
            return (
                parsed.scheme in {"http", "https"}
                and bool(parsed.hostname)
                and parsed.username is None
                and parsed.password is None
                and (port is None or 1 <= port <= 65535)
            )
        if action in {"click", "type"}:
            if not isinstance(params.get("selector"), str) or not params["selector"].strip():
                return False
            if action == "type":
                return isinstance(params.get("text"), str) and isinstance(
                    params.get("submit", False), bool
                )
            return True
        if action == "scroll":
            direction = params.get("direction", "down")
            amount = params.get("amount", 500)
            return (
                direction in {"up", "down", "left", "right"}
                and isinstance(amount, int)
                and not isinstance(amount, bool)
                and 1 <= amount <= 3000
            )
        if action == "press_key":
            return isinstance(params.get("key", "Enter"), str) and bool(
                params.get("key", "Enter").strip()
            )
        return True

    async def _get_or_create_session(self):
        global _active_browser_session
        from ..browser.browser_session import BrowserSession
        if _active_browser_session is None or not _active_browser_session.is_running():
            _active_browser_session = BrowserSession(headless=False)
            await _active_browser_session.start()
        return _active_browser_session

    @staticmethod
    def _extension_request(method: str, path: str, payload: dict | None = None) -> dict:
        token = os.environ.get("HELIX_BROWSER_EXTENSION_TOKEN", "")
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise RuntimeError(
                "The paired browser extension is not configured. Open HELIX Toolbox "
                "and pair the Desktop Companion extension."
            )
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            f"http://127.0.0.1:47831{path}",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
            method=method,
        )
        try:
            with urlopen(request, timeout=80) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                message = json.loads(detail).get("error", detail)
            except json.JSONDecodeError:
                message = detail or str(error)
            raise RuntimeError(f"Browser companion request failed: {message}") from error
        except (URLError, TimeoutError, OSError) as error:
            raise RuntimeError(
                "The local browser companion is unavailable. Restart HELIX Desktop "
                "and verify the extension bridge."
            ) from error
        if not isinstance(result, dict):
            raise RuntimeError("The browser companion returned an invalid response.")
        return result

    async def _extension_command(self, command: dict) -> Any:
        result = await asyncio.to_thread(
            self._extension_request,
            "POST",
            "/control",
            command,
        )
        if result.get("ok") is not True:
            raise RuntimeError(str(result.get("error", "Browser command failed.")))
        return result.get("result")

    async def _extension_result(
        self,
        action: str,
        *,
        session_id: str,
        include_page: bool = True,
        **details: Any,
    ) -> ToolResult:
        output = {"action": action, **details}
        if include_page:
            page = await self._extension_command({
                "action": "snapshot",
                "session_id": session_id,
            })
            if not isinstance(page, dict):
                raise RuntimeError("The browser companion returned an invalid page snapshot.")
            output["page"] = {
                "title": page.get("title", ""),
                "url": page.get("url", ""),
                "text": page.get("text", "")[:12000],
                "links": page.get("links", [])[:50],
                "forms": page.get("forms", [])[:50],
                "controls": page.get("controls", [])[:80],
            }
        return ToolResult(success=True, output=output)

    async def _execute_with_extension(self, params: Dict[str, Any]) -> ToolResult:
        global _active_extension_session_id
        action = params["action"]
        supported = {
            "navigate", "click", "click_at", "double_click_at", "move_mouse",
            "type", "scroll", "scroll_at", "press_key", "go_back", "refresh",
            "get_content", "screenshot", "close",
        }
        if action not in supported:
            return ToolResult(
                success=False,
                output=None,
                error=(
                    f"Browser action '{action}' is not supported in the paired browser tab. "
                    "Use semantic controls from get_content instead."
                ),
            )

        status = await asyncio.to_thread(
            self._extension_request,
            "GET",
            "/status",
        )
        if status.get("connected") is not True:
            raise RuntimeError(
                "The Chrome/Edge companion extension is not connected. Install it from "
                "HELIX Toolbox, save the pairing token, and retry."
            )

        if action == "close":
            session_id = _active_extension_session_id
            if session_id is not None:
                await self._extension_command({
                    "action": "close",
                    "session_id": session_id,
                })
                _active_extension_session_id = None
            return ToolResult(success=True, output={"action": action, "status": "closed"})

        if action == "navigate":
            url = params["url"].strip()
            if not url.startswith(("http://", "https://")):
                url = f"https://{url}"
            if _active_extension_session_id is None:
                opened = await self._extension_command({
                    "action": "open_session",
                    "url": url,
                })
                if not isinstance(opened, dict) or not isinstance(opened.get("session_id"), str):
                    raise RuntimeError("The browser companion could not open a HELIX tab.")
                _active_extension_session_id = opened["session_id"]
            else:
                await self._extension_command({
                    "action": "navigate",
                    "session_id": _active_extension_session_id,
                    "url": url,
                })
            return await self._extension_result(
                action,
                session_id=_active_extension_session_id,
                url=url,
            )

        session_id = _active_extension_session_id
        if session_id is None:
            raise RuntimeError("Open a page with the navigate action before controlling the browser.")

        if action in {"click", "type"}:
            selector = params["selector"].strip()
            if selector.isdecimal():
                selector = f'[data-helix-control="{selector}"]'
            command = {
                "action": action,
                "session_id": session_id,
                "selector": selector,
            }
            if action == "type":
                command["text"] = params["text"]
                command["submit"] = params.get("submit", False)
            await self._extension_command(command)
            return await self._extension_result(action, session_id=session_id)

        if action == "scroll":
            direction = params.get("direction", "down")
            amount = params.get("amount", 500)
            await self._extension_command({
                "action": "scroll",
                "session_id": session_id,
                "direction": direction,
                "amount": amount,
            })
            return await self._extension_result(
                action,
                session_id=session_id,
                direction=direction,
                amount=amount,
            )

        if action in {"move_mouse", "click_at", "double_click_at", "scroll_at"}:
            command = {
                "action": action,
                "session_id": session_id,
                "x": params["x"],
                "y": params["y"],
            }
            if action == "click_at":
                command["button"] = params.get("button", "left")
            if action == "scroll_at":
                command["direction"] = params.get("direction", "down")
                command["amount"] = params.get("amount", 500)
            await self._extension_command(command)
            return await self._extension_result(action, session_id=session_id)

        if action == "press_key":
            await self._extension_command({
                "action": action,
                "session_id": session_id,
                "key": params.get("key", "Enter"),
            })
            return await self._extension_result(action, session_id=session_id)

        if action in {"go_back", "refresh"}:
            await self._extension_command({
                "action": action,
                "session_id": session_id,
            })
            return await self._extension_result(action, session_id=session_id)

        if action == "screenshot":
            result = await self._extension_command({
                "action": "screenshot",
                "session_id": session_id,
            })
            data_url = result.get("data_url") if isinstance(result, dict) else None
            if not isinstance(data_url, str) or not data_url.startswith("data:image/jpeg;base64,"):
                raise RuntimeError("The browser companion did not return a valid screenshot.")
            screenshot_bytes = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            return ToolResult(
                success=True,
                output={
                    "action": action,
                    "mime_type": "image/jpeg",
                    "screenshot_bytes": screenshot_bytes,
                },
            )

        return await self._extension_result(action, session_id=session_id)

    async def _visual_result(
        self, session, action: str, *, include_page: bool = True, **details
    ) -> ToolResult:
        output = {"action": action, **details}
        if include_page:
            output["page"] = (await session.get_visible_text())[:5000]
        output["screenshot_bytes"] = await session.screenshot()
        return ToolResult(success=True, output=output)

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(success=False, output=None, error="Invalid browser action or parameters.")
        if os.environ.get("HELIX_BROWSER_CONTROL_MODE") == "extension":
            try:
                return await self._execute_with_extension(params)
            except Exception as error:
                logger.exception("Paired browser action %s failed", params["action"])
                return ToolResult(
                    success=False,
                    output=None,
                    error=f"Browser action '{params['action']}' failed: {error}",
                )
        action = params["action"]
        global _active_browser_session
        try:
            if action == "close":
                if _active_browser_session is not None:
                    await _active_browser_session.stop()
                    _active_browser_session = None
                return ToolResult(success=True, output={"action": action, "status": "closed"})

            session = await self._get_or_create_session()
            if action == "navigate":
                url = params["url"].strip()
                if not url.startswith(("http://", "https://")):
                    url = f"https://{url}"
                await session.navigate(url)
                return await self._visual_result(
                    session,
                    action,
                    url=await session.get_current_url(),
                )
            if action == "click":
                await session.click(params["selector"].strip())
                return await self._visual_result(session, action)
            if action == "move_mouse":
                await session.move_mouse(params["x"], params["y"])
                return await self._visual_result(
                    session, action, x=params["x"], y=params["y"]
                )
            if action == "click_at":
                button = params.get("button", "left")
                await session.click_at(params["x"], params["y"], button)
                return await self._visual_result(
                    session, action, x=params["x"], y=params["y"], button=button
                )
            if action == "double_click_at":
                await session.double_click_at(params["x"], params["y"])
                return await self._visual_result(
                    session, action, x=params["x"], y=params["y"]
                )
            if action == "drag":
                await session.drag(
                    params["x"], params["y"], params["end_x"], params["end_y"]
                )
                return await self._visual_result(
                    session,
                    action,
                    x=params["x"],
                    y=params["y"],
                    end_x=params["end_x"],
                    end_y=params["end_y"],
                )
            if action == "type":
                await session.type_text(params["selector"].strip(), params["text"])
                submit = params.get("submit", False)
                if submit:
                    await session.press_key("Enter")
                return await self._visual_result(
                    session,
                    action,
                    selector=params["selector"],
                    characters_typed=len(params["text"]),
                    submitted=submit,
                )
            if action == "scroll":
                await session.scroll(params.get("direction", "down"), params.get("amount", 500))
                return await self._visual_result(
                    session,
                    action,
                    direction=params.get("direction", "down"),
                    amount=params.get("amount", 500),
                )
            if action == "scroll_at":
                direction = params.get("direction", "down")
                amount = params.get("amount", 500)
                await session.scroll_at(
                    params["x"], params["y"], direction, amount
                )
                return await self._visual_result(
                    session,
                    action,
                    x=params["x"],
                    y=params["y"],
                    direction=direction,
                    amount=amount,
                )
            if action == "press_key":
                await session.press_key(params.get("key", "Enter"))
                return await self._visual_result(
                    session, action, key=params.get("key", "Enter")
                )
            if action == "get_content":
                return ToolResult(
                    success=True,
                    output={"action": action, "content": await session.get_visible_text()},
                )
            if action == "screenshot":
                return await self._visual_result(
                    session, action, include_page=False, mime_type="image/jpeg"
                )
            if action == "go_back":
                await session.go_back()
            elif action == "refresh":
                await session.refresh()
            return await self._visual_result(session, action)
        except Exception as error:
            logger.exception("Browser action %s failed", action)
            return ToolResult(
                success=False,
                output=None,
                error=f"Browser action '{action}' failed: {error}",
            )
