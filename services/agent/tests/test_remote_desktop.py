import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.agent.core.desktop_event_routing import select_desktop_event_recipients
from services.agent.core.desktop_streamer import DesktopStreamer


def test_desktop_event_routing_recipient_selection():
    clients = {"client_all_1", "client_all_2"}
    conv_clients = {
        "mobile_dev123": {"client_dev123"},
        "mobile_dev456": {"client_dev456"},
    }

    # Normal events go to all clients
    recipients = select_desktop_event_recipients("TASK_UPDATE", {}, clients, conv_clients)
    assert recipients == clients

    # DESKTOP_FRAME with source_device_id routes specifically to that mobile client
    payload = {"source_device_id": "dev123", "image_base64": "abc"}
    recipients = select_desktop_event_recipients("DESKTOP_FRAME", payload, clients, conv_clients)
    assert recipients == {"client_dev123"}

    # DESKTOP_FRAME with conversation_id directly
    payload_conv = {"conversation_id": "mobile_dev456"}
    recipients = select_desktop_event_recipients("DESKTOP_FRAME", payload_conv, clients, conv_clients)
    assert recipients == {"client_dev456"}

    # Unknown device gets empty set
    payload_unknown = {"source_device_id": "unknown_device"}
    recipients = select_desktop_event_recipients("DESKTOP_FRAME", payload_unknown, clients, conv_clients)
    assert recipients == set()


@pytest.mark.asyncio
async def test_desktop_streamer_lifecycle():
    published = []
    frame_published = asyncio.Event()

    async def mock_publish(event_name, payload):
        published.append((event_name, payload))
        frame_published.set()

    mock_screen = MagicMock()
    # Mock a minimal 10x10 PNG
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color="blue").save(buf, format="PNG")
    mock_screen.capture_full.return_value = buf.getvalue()

    streamer = DesktopStreamer(mock_publish, mock_screen, fps=30)
    device_id = "test_device_12345678901234567890"

    assert streamer.active_devices == set()
    streamer.start(device_id)
    assert device_id in streamer.active_devices

    try:
        await asyncio.wait_for(frame_published.wait(), timeout=2)
        assert len(published) >= 1
        event_name, frame_payload = published[0]
        assert event_name == "DESKTOP_FRAME"
        assert frame_payload["source_device_id"] == device_id
        assert "image_base64" in frame_payload
        assert frame_payload["mime_type"] == "image/jpeg"
    finally:
        streamer.stop(device_id)

    assert device_id not in streamer.active_devices

    # Calling stop again is safe
    streamer.stop(device_id)


@pytest.mark.asyncio
async def test_remote_control_dispatch_bridge():
    from services.agent.core.desktop_bridge import DesktopRequestHandler
    from pathlib import Path

    task_manager = MagicMock()
    task_manager.event_bus = MagicMock()
    handler = DesktopRequestHandler(
        task_manager=task_manager,
        provider_registry=MagicMock(),
        capability_registry=MagicMock(),
        key_manager=MagicMock(),
        settings_path=Path("mock_settings.json"),
    )

    # Test REMOTE_CONTROL_MOUSE without importing the host display backend.
    mock_pyautogui = MagicMock()
    mock_pyautogui.size.return_value = (1920, 1080)
    with patch.dict("sys.modules", {"pyautogui": mock_pyautogui}):
        await handler.dispatch({
            "type": "REMOTE_CONTROL_MOUSE",
            "payload": {
                "action": "click",
                "x_ratio": 0.5,
                "y_ratio": 0.5,
                "button": "left",
            }
        })
    assert mock_pyautogui.click.called

    # Test REMOTE_CONTROL_KEYBOARD text typing
    mock_pyautogui = MagicMock()
    with patch.dict("sys.modules", {"pyautogui": mock_pyautogui}):
        await handler.dispatch({
            "type": "REMOTE_CONTROL_KEYBOARD",
            "payload": {
                "text": "Hello Helix",
            }
        })
    assert mock_pyautogui.write.called
    assert mock_pyautogui.write.call_args[0][0] == "Hello Helix"

    # Test REMOTE_CONTROL_KEYBOARD safe key pressing
    mock_pyautogui = MagicMock()
    with patch.dict("sys.modules", {"pyautogui": mock_pyautogui}):
        await handler.dispatch({
            "type": "REMOTE_CONTROL_KEYBOARD",
            "payload": {
                "key": "Enter",
            }
        })
    assert mock_pyautogui.press.called
    assert mock_pyautogui.press.call_args[0][0] == "enter"
