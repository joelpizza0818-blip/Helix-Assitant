import base64
import json

import pytest

from services.agent.desktop_control.guest import client as guest_client_module
from services.agent.desktop_control.guest.client import GuestDesktopClient


class FakeSocket:
    def __init__(self) -> None:
        self.sent = None

    async def send(self, message: str) -> None:
        self.sent = json.loads(message)

    async def recv(self) -> str:
        return json.dumps({
            "ok": True,
            "image_base64": base64.b64encode(b"guest-frame").decode("ascii"),
            "virtual_cursor": {"x": 0.2, "y": 0.3, "visible": True},
        })


class FakeConnection:
    def __init__(self) -> None:
        self.socket = FakeSocket()

    async def __aenter__(self) -> FakeSocket:
        return self.socket

    async def __aexit__(self, *_args) -> None:
        return None


def _session_config(**overrides):
    return {
        "endpoint": "ws://127.0.0.1:49152",
        "token": "a" * 64,
        "runtime": "docker",
        "container_name": "helix-computer-desktop",
        "image": "helix-computer-use:1",
        "installation_complete": True,
        **overrides,
    }


def _mock_docker(monkeypatch, *, running=True, port=49152):
    calls = []

    async def run_docker(self, *arguments):
        calls.append(arguments)
        if arguments[0] == "inspect":
            return "true" if running else "false"
        if arguments[0] == "port":
            return f"127.0.0.1:{port}"
        if arguments[0] == "start":
            return "helix-computer-desktop"
        raise AssertionError(f"Unexpected Docker command: {arguments}")

    async def wait_for_agent(self, _port):
        return None

    monkeypatch.setattr(GuestDesktopClient, "_run_docker", run_docker)
    monkeypatch.setattr(GuestDesktopClient, "_wait_for_agent", wait_for_agent)
    return calls


@pytest.mark.asyncio
async def test_guest_client_returns_only_authenticated_docker_desktop_frames(tmp_path, monkeypatch):
    config_path = tmp_path / "session.json"
    config_path.write_text(json.dumps(_session_config()))
    calls = _mock_docker(monkeypatch, port=49152)
    connection = FakeConnection()
    monkeypatch.setattr(
        guest_client_module,
        "connect",
        lambda *_args, **_kwargs: connection,
    )

    result = await GuestDesktopClient(config_path).execute("screenshot")

    assert result["screenshot_bytes"] == b"guest-frame"
    assert result["capture_source"] == "docker_guest"
    assert connection.socket.sent == {
        "action": "screenshot",
        "token": "a" * 64,
    }
    assert calls == [
        ("inspect", "--format", "{{.State.Running}}", "helix-computer-desktop"),
        ("port", "helix-computer-desktop", "8765/tcp"),
    ]
    saved = json.loads(config_path.read_text())
    assert isinstance(saved["last_activity_at"], str)


@pytest.mark.asyncio
async def test_guest_client_starts_only_the_configured_helix_container(tmp_path, monkeypatch):
    config_path = tmp_path / "session.json"
    config_path.write_text(json.dumps(_session_config()))
    calls = _mock_docker(monkeypatch, running=False, port=45678)

    endpoint, token = await GuestDesktopClient(config_path)._ensure_guest_running()

    assert endpoint == "ws://127.0.0.1:45678"
    assert token == "a" * 64
    assert calls == [
        ("inspect", "--format", "{{.State.Running}}", "helix-computer-desktop"),
        ("start", "helix-computer-desktop"),
        ("port", "helix-computer-desktop", "8765/tcp"),
    ]
    assert json.loads(config_path.read_text())["endpoint"] == endpoint


@pytest.mark.asyncio
async def test_guest_client_does_not_start_a_container_that_is_still_being_prepared(tmp_path):
    config_path = tmp_path / "session.json"
    config_path.write_text(json.dumps(_session_config(installation_complete=False)))

    with pytest.raises(RuntimeError, match="still being prepared"):
        await GuestDesktopClient(config_path).execute("screenshot")


@pytest.mark.asyncio
async def test_guest_client_rejects_an_unsafe_container_name(tmp_path):
    config_path = tmp_path / "session.json"
    config_path.write_text(json.dumps(_session_config(
        container_name="helix; docker rm -f other",
    )))

    with pytest.raises(RuntimeError, match="container is invalid"):
        await GuestDesktopClient(config_path).execute("screenshot")


@pytest.mark.asyncio
async def test_guest_client_rejects_non_loopback_endpoint_and_invalid_token(tmp_path):
    config_path = tmp_path / "session.json"
    config_path.write_text(json.dumps(_session_config(endpoint="ws://192.168.1.4:49152")))
    with pytest.raises(RuntimeError, match="settings are invalid"):
        await GuestDesktopClient(config_path)._ensure_guest_running()

    config_path.write_text(json.dumps(_session_config(token="short")))
    with pytest.raises(RuntimeError, match="settings are invalid"):
        await GuestDesktopClient(config_path)._ensure_guest_running()
