"""Small authenticated WebSocket relay for HELIX Desktop <-> Mobile.

The relay never executes agent commands. It only joins a Desktop connector and
one or more mobile clients that present the same short-lived pairing token.
Run behind TLS (wss://) in production; local development uses ws://.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

LOGGER = logging.getLogger("helix.relay")
MAX_MESSAGE_BYTES = 16 * 1024 * 1024


def _headers(websocket: Any) -> Any:
    request = getattr(websocket, "request", None)
    if request is not None and hasattr(request, "headers"):
        return request.headers
    return getattr(websocket, "request_headers", {})


def _header(headers: Any, name: str) -> str:
    value = headers.get(name) if hasattr(headers, "get") else None
    return value.strip() if isinstance(value, str) else ""


@dataclass
class Room:
    token: str
    expires_at: float
    desktop: Any | None = None
    mobiles: set[Any] = field(default_factory=set)

    def active(self) -> bool:
        return self.expires_at > time.time()


class RelayServer:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def _room_for(self, token: str, expires_at: float, role: str, websocket: Any) -> Room | None:
        async with self._lock:
            room = self.rooms.get(token)
            if room is not None and not room.active():
                self.rooms.pop(token, None)
                room = None
            if role == "desktop":
                if expires_at <= time.time():
                    return None
                if room is not None and room.desktop is not None and room.desktop is not websocket:
                    await room.desktop.close(code=4002, reason="Desktop session replaced")
                room = Room(token=token, expires_at=expires_at, desktop=websocket)
                self.rooms[token] = room
                return room
            if role != "mobile" or room is None or room.desktop is None:
                return None
            return room

    async def _remove(self, room: Room, websocket: Any) -> None:
        async with self._lock:
            if room.desktop is websocket:
                room.desktop = None
            room.mobiles.discard(websocket)
            if room.desktop is None and not room.mobiles:
                self.rooms.pop(room.token, None)

    async def handle(self, websocket: Any) -> None:
        headers = _headers(websocket)
        authorization = _header(headers, "Authorization")
        role = _header(headers, "X-HELIX-Role").lower()
        token = authorization[len("Bearer "):] if authorization.startswith("Bearer ") else ""
        try:
            expires_raw = _header(headers, "X-HELIX-Pairing-Expires")
            expires_at = float(expires_raw) if expires_raw else 0.0
        except ValueError:
            expires_at = 0.0
        if not token or role not in {"desktop", "mobile"}:
            await websocket.close(code=4401, reason="HELIX relay authentication required")
            return
        room = await self._room_for(token, expires_at, role, websocket)
        if room is None:
            await websocket.close(code=4404, reason="Pairing is unavailable or expired")
            return
        if role == "mobile":
            room.mobiles.add(websocket)
        LOGGER.info("Relay %s joined room %s", role, hmac.new(b"helix", token.encode(), "sha256").hexdigest()[:12])
        try:
            async for message in websocket:
                if isinstance(message, str) and len(message.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    await websocket.close(code=4409, reason="Message too large")
                    break
                target = room.mobiles if role == "desktop" else ({room.desktop} if room.desktop else set())
                stale = []
                for peer in target:
                    if peer is None:
                        stale.append(peer)
                        continue
                    try:
                        await peer.send(message)
                    except ConnectionClosed:
                        stale.append(peer)
                for peer in stale:
                    if peer is not None:
                        room.mobiles.discard(peer)
        except ConnectionClosed:
            pass
        finally:
            await self._remove(room, websocket)


async def serve(host: str | None = None, port: int | None = None) -> None:
    logging.basicConfig(level=os.environ.get("HELIX_RELAY_LOG_LEVEL", "INFO"))
    relay = RelayServer()
    bind_host = host or os.environ.get("HELIX_RELAY_HOST", "127.0.0.1")
    bind_port = port or int(os.environ.get("HELIX_RELAY_PORT", "8787"))
    async def dispatch(*connections: Any) -> None:
        await relay.handle(connections[0])

    async with websockets.serve(
        dispatch,
        bind_host,
        bind_port,
        max_size=MAX_MESSAGE_BYTES,
    ):
        LOGGER.info("HELIX relay listening on ws://%s:%s", bind_host, bind_port)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
