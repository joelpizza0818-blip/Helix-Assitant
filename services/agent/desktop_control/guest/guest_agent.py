"""Authenticated, allow-listed control endpoint installed inside the Linux guest."""

import asyncio
import base64
import hmac
import json
import os
import re
import subprocess
from typing import Any

try:
    from websockets.asyncio.server import serve
except ImportError:
    from websockets import serve

MAX_TEXT_LENGTH = 16_000
MAX_FRAME_BYTES = 560_000
KEY_PATTERN = re.compile(r"^[A-Za-z0-9_+-]{1,48}$")
APPLICATION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$")


class GuestDesktopAgent:
    def __init__(
        self,
        token: str,
        *,
        runner=None,
        launcher=None,
        frame_provider=None,
        cursor_provider=None,
    ) -> None:
        if not isinstance(token, str) or len(token) < 32:
            raise ValueError("Guest control token must contain at least 32 characters.")
        self._token = token
        self._runner = runner or self._run
        self._launcher = launcher or self._launch_application
        self._frame_provider = frame_provider or self._capture_frame
        self._cursor_provider = cursor_provider or self._cursor_position

    async def handle(self, websocket) -> None:
        async for message in websocket:
            try:
                request = json.loads(message)
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                await websocket.send(json.dumps({"ok": False, "error": str(error)}))
                continue
            if isinstance(request, dict) and request.get("action") == "stream":
                token = request.get("token")
                if not isinstance(token, str) or not hmac.compare_digest(token, self._token):
                    await websocket.send(json.dumps({
                        "ok": False,
                        "error": "Guest desktop authorization failed.",
                    }))
                    continue
                while True:
                    frame = await self.dispatch({
                        "token": self._token,
                        "action": "screenshot",
                    })
                    await websocket.send(json.dumps(frame, separators=(",", ":")))
                    await asyncio.sleep(0.5)
            try:
                response = await self.dispatch(request)
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                response = {"ok": False, "error": str(error)}
            except Exception as error:
                response = {"ok": False, "error": str(error)}
            await websocket.send(json.dumps(response, separators=(",", ":")))

    async def dispatch(self, request: Any) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise TypeError("Guest desktop requests must be JSON objects.")
        token = request.get("token")
        if not isinstance(token, str) or not hmac.compare_digest(token, self._token):
            return {"ok": False, "error": "Guest desktop authorization failed."}

        action = request.get("action")
        if action == "screenshot":
            image = await self._frame_provider()
            if not isinstance(image, bytes) or not image or len(image) > MAX_FRAME_BYTES:
                raise RuntimeError("The guest did not return a valid desktop frame.")
            return {
                "ok": True,
                "capture_source": "docker_guest",
                "mime_type": "image/jpeg",
                "image_base64": base64.b64encode(image).decode("ascii"),
                "virtual_cursor": await self._cursor_provider(),
            }
        if action == "click":
            x = _coordinate(request.get("x"), "x")
            y = _coordinate(request.get("y"), "y")
            button = request.get("button", 1)
            if (
                isinstance(button, bool)
                or not isinstance(button, int)
                or button not in (1, 2, 3)
            ):
                raise ValueError("Mouse button must be 1, 2, or 3.")
            await self._runner("xdotool", "mousemove", str(x), str(y), "click", str(button))
            return {"ok": True, "action": action}
        if action == "move":
            x = _coordinate(request.get("x"), "x")
            y = _coordinate(request.get("y"), "y")
            await self._runner("xdotool", "mousemove", str(x), str(y))
            return {"ok": True, "action": action}
        if action == "type":
            text = request.get("text")
            if not isinstance(text, str) or not text or len(text) > MAX_TEXT_LENGTH:
                raise ValueError("Text must contain between 1 and 16000 characters.")
            await self._runner(
                "xdotool",
                "type",
                "--clearmodifiers",
                "--delay",
                "1",
                "--",
                text,
            )
            return {"ok": True, "action": action}
        if action == "key":
            key = request.get("key")
            if not isinstance(key, str) or not KEY_PATTERN.fullmatch(key):
                raise ValueError("Key name contains unsupported characters.")
            await self._runner("xdotool", "key", "--clearmodifiers", key)
            return {"ok": True, "action": action}
        if action == "scroll":
            direction = request.get("direction")
            amount = request.get("amount", 3)
            if direction not in {"up", "down", "left", "right"}:
                raise ValueError("Scroll direction is invalid.")
            if isinstance(amount, bool) or not isinstance(amount, int) or not 1 <= amount <= 20:
                raise ValueError("Scroll amount must be an integer from 1 to 20.")
            button = {"up": 4, "down": 5, "left": 6, "right": 7}[direction]
            await self._runner("xdotool", "click", "--repeat", str(amount), str(button))
            return {"ok": True, "action": action}
        if action == "launch":
            application = request.get("application")
            if (
                not isinstance(application, str)
                or not APPLICATION_PATTERN.fullmatch(application)
            ):
                raise ValueError("Application must be a valid desktop-file identifier.")
            await self._launcher(application)
            return {"ok": True, "action": action, "application": application}
        raise ValueError("Guest desktop action is not supported.")

    async def _run(self, *arguments: str) -> bytes:
        process = await asyncio.create_subprocess_exec(
            *arguments,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")},
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError(f"Guest command timed out: {arguments[0]}")
        if process.returncode:
            detail = stderr.decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Guest command failed ({arguments[0]}): {detail}")
        return stdout

    async def _launch_application(self, application: str) -> None:
        # Detach the launched application from the agent's pipes so that a
        # long-running desktop program does not keep communicate() blocked.
        process = await asyncio.create_subprocess_exec(
            "gtk-launch",
            application,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
            env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")},
        )
        try:
            returncode = await asyncio.wait_for(process.wait(), timeout=10)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError("Guest application launch timed out: gtk-launch")
        if returncode:
            raise RuntimeError(
                f"Guest application launch failed (gtk-launch): exit status {returncode}"
            )

    async def _capture_frame(self) -> bytes:
        width, height = await self._screen_dimensions()
        return await self._runner(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "x11grab",
            "-draw_mouse",
            "0",
            "-video_size",
            f"{width}x{height}",
            "-i",
            os.environ.get("DISPLAY", ":0"),
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "mjpeg",
            "-q:v",
            "6",
            "pipe:1",
        )

    async def _cursor_position(self) -> dict[str, Any]:
        width, height = await self._screen_dimensions()
        output = await self._runner("xdotool", "getmouselocation", "--shell")
        values = {}
        for line in output.decode("ascii", errors="ignore").splitlines():
            name, separator, raw = line.partition("=")
            if separator and name in {"X", "Y"}:
                try:
                    values[name] = int(raw)
                except ValueError:
                    continue
        return {
            "x": max(0.0, min(1.0, values.get("X", 0) / width)),
            "y": max(0.0, min(1.0, values.get("Y", 0) / height)),
            "visible": True,
        }

    async def _screen_dimensions(self) -> tuple[int, int]:
        output = await self._runner("xdotool", "getdisplaygeometry")
        try:
            width, height = (int(value) for value in output.split())
        except (TypeError, ValueError) as error:
            raise RuntimeError("The guest returned invalid screen dimensions.") from error
        if not (1 <= width <= 16_384 and 1 <= height <= 16_384):
            raise RuntimeError("The guest screen dimensions are outside the allowed range.")
        return width, height


def _coordinate(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 16_384:
        raise ValueError(f"Coordinate '{name}' must be an integer from 0 to 16384.")
    return value


async def run_server() -> None:
    token = os.environ.get("HELIX_GUEST_TOKEN")
    if not isinstance(token, str):
        raise RuntimeError("Guest control token is missing from the container environment.")
    agent = GuestDesktopAgent(token)
    async with serve(agent.handle, "0.0.0.0", 8765, max_size=32_768):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(run_server())
