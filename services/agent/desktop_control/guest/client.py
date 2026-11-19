"""Host-side authenticated client for the isolated Docker desktop."""

import asyncio
import base64
import datetime
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from websockets.asyncio.client import connect
except ImportError:
    from websockets import connect


class GuestDesktopUnavailable(RuntimeError):
    """The isolated guest session is missing or cannot be started.

    This error is raised before any guest action is sent, so callers may safely
    select another backend without risking a duplicated desktop action.
    """


class GuestDesktopClient:
    _CONTAINER_NAME = "helix-computer-desktop"
    _CONTAINER_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,62}$")

    def __init__(self, config_path: Path | None = None) -> None:
        configured = os.environ.get("HELIX_DESKTOP_SESSION_PATH")
        self._config_path = config_path or (
            Path(configured) if configured else None
        )

    def _load_config(self) -> tuple[dict[str, Any], str, str]:
        if self._config_path is None:
            raise RuntimeError("The Docker desktop session is not configured.")
        try:
            config = json.loads(self._config_path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise RuntimeError("The Docker desktop session is not configured.") from error
        if not isinstance(config, dict):
            raise RuntimeError("The Docker desktop session file is invalid.")
        endpoint = config.get("endpoint")
        token = config.get("token")
        parsed_endpoint = urlparse(endpoint) if isinstance(endpoint, str) else None
        if (
            parsed_endpoint is None
            or parsed_endpoint.scheme != "ws"
            or parsed_endpoint.hostname != "127.0.0.1"
            or parsed_endpoint.port is None
            or not 1 <= parsed_endpoint.port <= 65_535
            or not isinstance(token, str)
            or re.fullmatch(r"[a-f0-9]{64}", token) is None
            or config.get("runtime") != "docker"
        ):
            raise RuntimeError("The Docker desktop session settings are invalid.")
        container_name = config.get("container_name")
        if (
            not isinstance(container_name, str)
            or container_name != self._CONTAINER_NAME
            or self._CONTAINER_NAME_PATTERN.fullmatch(container_name) is None
        ):
            raise RuntimeError("The configured Docker desktop container is invalid.")
        return config, endpoint, token

    async def _ensure_guest_running(self) -> tuple[str, str]:
        config, endpoint, token = self._load_config()
        if config.get("installation_complete") is False:
            raise RuntimeError(
                "The Docker desktop is still being prepared. Wait for setup to finish."
            )
        container_name = config["container_name"]
        running = await self._run_docker(
            "inspect",
            "--format",
            "{{.State.Running}}",
            container_name,
        )
        if running.strip() != "true":
            await self._run_docker("start", container_name)
        port_mapping = await self._run_docker(
            "port",
            container_name,
            "8765/tcp",
        )
        match = re.fullmatch(r"127\.0\.0\.1:(\d+)", port_mapping.strip().splitlines()[0])
        if match is None:
            raise RuntimeError("Docker returned an invalid loopback desktop port.")
        port = int(match.group(1))
        if not 1 <= port <= 65_535:
            raise RuntimeError("Docker returned a desktop port outside the allowed range.")
        endpoint = f"ws://127.0.0.1:{port}"
        config["endpoint"] = endpoint
        self._write_config(config)
        await self._wait_for_agent(port)
        return endpoint, token

    async def _run_docker(self, *arguments: str) -> str:
        process = await asyncio.create_subprocess_exec(
            "docker",
            *arguments,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError("Docker desktop startup timed out.")
        if process.returncode:
            detail = stderr.decode("utf-8", errors="replace").strip()[:500]
            raise RuntimeError(detail or "Docker desktop command failed.")
        return stdout.decode("utf-8", errors="replace").strip()

    async def _wait_for_agent(self, port: int) -> None:
        deadline = asyncio.get_running_loop().time() + 180
        while asyncio.get_running_loop().time() < deadline:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", port),
                    timeout=1,
                )
                del reader
                writer.close()
                await writer.wait_closed()
                return
            except (OSError, asyncio.TimeoutError):
                await asyncio.sleep(0.5)
        raise RuntimeError("The Docker desktop agent did not become reachable within 180 seconds.")

    def is_configured(self) -> bool:
        """Report whether a valid guest session file is available."""
        try:
            self._load_config()
            return True
        except Exception:
            return False

    def _write_config(self, config: dict[str, Any]) -> None:
        if self._config_path is None:
            raise RuntimeError("The Docker desktop session is not configured.")
        temporary_path = self._config_path.with_name(
            f"{self._config_path.name}.{uuid.uuid4().hex}.tmp"
        )
        temporary_path.write_text(
            json.dumps(config, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary_path, self._config_path)

    def _mark_activity(self) -> None:
        config, _, _ = self._load_config()
        config["last_activity_at"] = datetime.datetime.now(
            datetime.timezone.utc
        ).isoformat()
        self._write_config(config)

    async def execute(self, action: str, **parameters: Any) -> dict[str, Any]:
        try:
            endpoint, token = await self._ensure_guest_running()
        except Exception as error:
            raise GuestDesktopUnavailable(str(error)) from error
        request = {"action": action, "token": token, **parameters}
        async with connect(endpoint, open_timeout=10, close_timeout=3, max_size=750_000) as websocket:
            await websocket.send(json.dumps(request, separators=(",", ":")))
            response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=20))
        if not isinstance(response, dict) or response.get("ok") is not True:
            error = response.get("error") if isinstance(response, dict) else None
            raise RuntimeError(error if isinstance(error, str) else "Guest desktop action failed.")
        image_base64 = response.get("image_base64")
        if image_base64 is not None:
            if not isinstance(image_base64, str):
                raise RuntimeError("Guest returned an invalid desktop image.")
            try:
                image = base64.b64decode(image_base64, validate=True)
            except ValueError as error:
                raise RuntimeError("Guest returned an invalid desktop image.") from error
            if not image or len(image) > 560_000:
                raise RuntimeError("Guest returned a desktop image outside the allowed size.")
            response["screenshot_bytes"] = image
            response["capture_source"] = "docker_guest"
            del response["image_base64"]
        self._mark_activity()
        return response

    async def stream_frames(self):
        try:
            endpoint, token = await self._ensure_guest_running()
        except Exception as error:
            raise GuestDesktopUnavailable(str(error)) from error
        async with connect(
            endpoint,
            open_timeout=10,
            close_timeout=3,
            max_size=750_000,
        ) as websocket:
            await websocket.send(json.dumps({"action": "stream", "token": token}))
            async for message in websocket:
                response = json.loads(message)
                if not isinstance(response, dict) or response.get("ok") is not True:
                    error = response.get("error") if isinstance(response, dict) else None
                    raise RuntimeError(
                        error if isinstance(error, str) else "Guest desktop stream failed."
                    )
                image_base64 = response.get("image_base64")
                if not isinstance(image_base64, str):
                    raise RuntimeError("Guest stream returned an invalid image.")
                image = base64.b64decode(image_base64, validate=True)
                if not image or len(image) > 560_000:
                    raise RuntimeError("Guest stream returned an image outside the allowed size.")
                response["screenshot_bytes"] = image
                response["capture_source"] = "docker_guest"
                del response["image_base64"]
                yield response


