"""Desktop-side connector for the HELIX Mobile relay."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

LOGGER = logging.getLogger("helix.relay.client")


def _read_pairing(path: str | None) -> tuple[str, float] | None:
    if not path:
        return None
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        token = payload.get("token")
        expires_at = payload.get("expires_at")
        if not isinstance(token, str) or not token:
            return None
        if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
            return None
        return token, float(expires_at)
    except (OSError, ValueError, TypeError):
        return None


def _read_relay_url(source: str | None) -> str:
    if not source:
        return ""
    try:
        candidate = Path(source)
        if candidate.is_file():
            payload = json.loads(candidate.read_text(encoding="utf-8"))
            value = payload.get("url")
            return value.strip() if isinstance(value, str) else ""
    except (OSError, ValueError, TypeError):
        return ""
    return source.strip()


async def _pipe(source: Any, target: Any) -> None:
    async for message in source:
        await target.send(message)


async def _connect(url: str, headers: dict[str, str]) -> Any:
    """Support websockets 12 (extra_headers) and 15+ (additional_headers)."""
    try:
        return await websockets.connect(url, additional_headers=headers, max_size=16 * 1024 * 1024)
    except TypeError as error:
        if "additional_headers" not in str(error):
            raise
        return await websockets.connect(url, extra_headers=headers, max_size=16 * 1024 * 1024)


async def _watch_pairing(path: str, token: str, relay: Any, local: Any) -> None:
    while True:
        await asyncio.sleep(1)
        current = _read_pairing(path)
        if current is None or current[0] != token:
            await relay.close(code=4003, reason="Pairing rotated or expired")
            await local.close()
            return


async def run_relay_connector(
    relay_url: str | None,
    pairing_file: str | None,
    local_port: int,
    desktop_token: str,
) -> None:
    """Keep a Desktop agent connected to the relay while a pairing is live."""
    if not relay_url or not pairing_file:
        return
    while True:
        configured_url = _read_relay_url(relay_url)
        if not configured_url:
            await asyncio.sleep(1)
            continue
        pairing = _read_pairing(pairing_file)
        if pairing is None:
            await asyncio.sleep(1)
            continue
        token, expires_at = pairing
        relay = None
        local = None
        try:
            relay = await _connect(
                configured_url,
                {
                    "Authorization": f"Bearer {token}",
                    "X-HELIX-Role": "desktop",
                    "X-HELIX-Pairing-Expires": str(expires_at),
                },
            )
            local = await _connect(
                f"ws://127.0.0.1:{local_port}",
                {"Authorization": f"Bearer {desktop_token}"},
            )
            LOGGER.info("Desktop relay connector established")
            tasks = [
                asyncio.create_task(_pipe(local, relay)),
                asyncio.create_task(_pipe(relay, local)),
                asyncio.create_task(_watch_pairing(pairing_file, token, relay, local)),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                if not task.cancelled():
                    task.exception()
        except (OSError, ConnectionClosed, asyncio.TimeoutError) as error:
            LOGGER.warning("Relay connector unavailable: %s", error)
        finally:
            if relay is not None:
                await relay.close()
            if local is not None:
                await local.close()
        await asyncio.sleep(2)
