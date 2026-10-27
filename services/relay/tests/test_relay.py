import asyncio
import json
import time

import pytest
import websockets

from services.relay.server import MAX_MESSAGE_BYTES, RelayServer


@pytest.mark.asyncio
async def test_desktop_and_mobile_share_a_pairing_room():
    relay = RelayServer()
    server = await websockets.serve(relay.handle, "127.0.0.1", 0, max_size=MAX_MESSAGE_BYTES)
    port = server.sockets[0].getsockname()[1]
    token = "pairing-room-test"
    expires = str(time.time() + 30)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-HELIX-Role": "desktop",
        "X-HELIX-Pairing-Expires": expires,
    }
    mobile_headers = {
        "Authorization": f"Bearer {token}",
        "X-HELIX-Role": "mobile",
    }
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}", additional_headers=headers) as desktop:
            async with websockets.connect(f"ws://127.0.0.1:{port}", additional_headers=mobile_headers) as mobile:
                await mobile.send(json.dumps({"type": "USER_TEXT", "request_id": "relay-1"}))
                assert json.loads(await asyncio.wait_for(desktop.recv(), timeout=2))["request_id"] == "relay-1"
                await desktop.send(json.dumps({"type": "agent_message", "payload": {"text": "ok"}}))
                assert json.loads(await asyncio.wait_for(mobile.recv(), timeout=2))["type"] == "agent_message"
    finally:
        server.close()
        await server.wait_closed()
