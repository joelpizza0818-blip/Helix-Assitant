import asyncio
import base64
from http import HTTPStatus
import json
import sys
import textwrap

import pytest
import websockets

from services.agent.core.desktop_bridge import (
    MAX_AGENT_WEBSOCKET_MESSAGE_BYTES,
    MAX_USER_TEXT_ATTACHMENT_BYTES,
)
from services.agent.security.websocket_auth import (
    authenticate_websocket_handshake,
    websocket_token_is_valid,
)


EXPECTED_TOKEN = "a" * 64


@pytest.mark.asyncio
async def test_local_websocket_accepts_an_attachment_within_the_configured_limit():
    async def acknowledge_large_message(websocket):
        message = await websocket.recv()
        assert len(message.encode("utf-8")) <= MAX_AGENT_WEBSOCKET_MESSAGE_BYTES
        await websocket.send("received")

    server = await websockets.serve(
        acknowledge_large_message,
        "127.0.0.1",
        0,
        max_size=MAX_AGENT_WEBSOCKET_MESSAGE_BYTES,
    )
    port = server.sockets[0].getsockname()[1]
    image_payload = base64.b64encode(
        b"x" * MAX_USER_TEXT_ATTACHMENT_BYTES
    ).decode("ascii")
    message = json.dumps({
        "type": "USER_TEXT",
        "payload": {
            "text": "Describe the attached image",
            "attachments": [{
                "name": "large.png",
                "mime_type": "image/png",
                "data_base64": image_payload,
            }],
        },
    })

    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as websocket:
            await websocket.send(message)
            assert await websocket.recv() == "received"
    finally:
        server.close()
        await server.wait_closed()


def test_websocket_handshake_rejects_missing_token():
    response = authenticate_websocket_handshake(
        None,
        {"Authorization": ""},
        EXPECTED_TOKEN,
    )

    assert response[0] == HTTPStatus.UNAUTHORIZED


def test_websocket_handshake_rejects_invalid_token():
    response = authenticate_websocket_handshake(
        None,
        {"Authorization": "Bearer invalid"},
        EXPECTED_TOKEN,
    )

    assert response[0] == HTTPStatus.UNAUTHORIZED


def test_websocket_handshake_accepts_valid_token():
    assert authenticate_websocket_handshake(
        None,
        {"Authorization": f"Bearer {EXPECTED_TOKEN}"},
        EXPECTED_TOKEN,
    ) is None
    assert websocket_token_is_valid(
        {"Authorization": f"Bearer {EXPECTED_TOKEN}"},
        EXPECTED_TOKEN,
    )


def test_modern_websockets_rejects_with_http_401():
    class Connection:
        def respond(self, status, body):
            return status, body

    response = authenticate_websocket_handshake(
        Connection(),
        type("Request", (), {"headers": {"Authorization": "Bearer wrong"}})(),
        EXPECTED_TOKEN,
    )

    assert response == (HTTPStatus.UNAUTHORIZED, "Unauthorized\n")


@pytest.mark.asyncio
async def test_local_process_must_authenticate_during_websocket_handshake():
    async def wait_for_disconnect(websocket):
        await websocket.wait_closed()

    server = await websockets.serve(
        wait_for_disconnect,
        "127.0.0.1",
        0,
        process_request=lambda connection, request: authenticate_websocket_handshake(
            connection, request, EXPECTED_TOKEN
        ),
    )
    port = server.sockets[0].getsockname()[1]
    client_script = textwrap.dedent(
        """
        import asyncio
        import sys

        async def probe(port, authorization):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            headers = [
                "GET / HTTP/1.1",
                f"Host: 127.0.0.1:{port}",
                "Upgrade: websocket",
                "Connection: Upgrade",
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
                "Sec-WebSocket-Version: 13",
            ]
            if authorization:
                headers.append(f"Authorization: {authorization}")
            writer.write(("\\r\\n".join(headers) + "\\r\\n\\r\\n").encode("ascii"))
            await writer.drain()
            status = await reader.readline()
            print(status.decode("ascii").strip())
            writer.close()
            await writer.wait_closed()

        async def main():
            port = int(sys.argv[1])
            token = "a" * 64
            await probe(port, "")
            await probe(port, "Bearer invalid")
            await probe(port, f"Bearer {token}")

        asyncio.run(main())
        """
    )

    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            client_script,
            str(port),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        assert process.returncode == 0, stderr.decode("utf-8", errors="replace")
        statuses = stdout.decode("ascii").splitlines()
        assert statuses[0].startswith("HTTP/1.1 401")
        assert statuses[1].startswith("HTTP/1.1 401")
        assert statuses[2].startswith("HTTP/1.1 101")
    finally:
        server.close()
        await server.wait_closed()
