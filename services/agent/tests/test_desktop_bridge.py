import pytest

from services.agent.ai.anthropic_provider import AnthropicProvider
from services.agent.ai.capability_registry import CapabilityRegistry
from services.agent.ai.google_provider import GoogleProvider
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.openai_provider import OpenAIProvider
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.event_bus import EventBus
from services.agent.core.task_manager import TaskManager


@pytest.fixture
def request_handler(tmp_path, clean_env):
    key_manager = KeyManager()
    provider_registry = ProviderRegistry(key_manager)
    provider_registry.register_provider(OpenAIProvider())
    provider_registry.register_provider(AnthropicProvider())
    provider_registry.register_provider(GoogleProvider())
    return DesktopRequestHandler(
        TaskManager(EventBus()),
        provider_registry,
        CapabilityRegistry(),
        key_manager,
        tmp_path / "settings.json",
    )


@pytest.mark.asyncio
async def test_desktop_requests_return_serializable_data(request_handler):
    await request_handler.task_manager.create_task("task-1", "Test task")

    tasks = await request_handler.dispatch({
        "type": "GET_TASKS",
        "request_id": "tasks-1",
        "payload": {},
    })
    providers = await request_handler.dispatch({
        "type": "GET_PROVIDERS",
        "request_id": "providers-1",
        "payload": {},
    })
    models = await request_handler.dispatch({
        "type": "GET_MODELS",
        "request_id": "models-1",
        "payload": {"requirements": {}},
    })

    assert tasks["request_id"] == "tasks-1"
    assert tasks["payload"][0]["id"] == "task-1"
    assert tasks["payload"][0]["error"] is None
    assert providers["payload"][0]["configured"] is False
    assert models["payload"] == []


@pytest.mark.asyncio
async def test_settings_are_saved_and_loaded(request_handler):
    saved = await request_handler.dispatch({
        "type": "SAVE_SETTINGS",
        "request_id": "save-1",
        "payload": {"settings": {"wake_word": "computer"}},
    })
    loaded = await request_handler.dispatch({
        "type": "GET_SETTINGS",
        "request_id": "load-1",
        "payload": {},
    })

    assert saved["payload"]["wake_word"] == "computer"
    assert saved["payload"]["voice_enabled"] is True
    assert loaded["payload"] == saved["payload"]

@pytest.mark.asyncio
async def test_camera_settings_default_to_environment(request_handler, monkeypatch):
    monkeypatch.setenv("CAMERA_ENABLED", "true")
    monkeypatch.setenv("CAMERA_DEVICE_INDEX", "2")
    monkeypatch.setenv("GESTURE_SENSITIVITY", "0.65")

    response = await request_handler.dispatch({
        "type": "GET_SETTINGS",
        "request_id": "camera-settings-1",
        "payload": {},
    })

    assert response["payload"]["camera_enabled"] is True
    assert response["payload"]["camera_device_index"] == 2
    assert response["payload"]["gesture_sensitivity"] == 0.65


@pytest.mark.asyncio
async def test_provider_models_require_a_configured_key(request_handler, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY_1", "test-key")
    request_handler.key_manager = KeyManager()

    response = await request_handler.dispatch({
        "type": "GET_MODELS",
        "request_id": "models-2",
        "payload": {"requirements": {"vision": True}},
    })

    assert response["payload"]
    assert all(model["provider"] == "openai" for model in response["payload"])
    assert all(model["capabilities"]["vision"] for model in response["payload"])


@pytest.mark.asyncio
async def test_unknown_request_is_reported(request_handler):
    with pytest.raises(ValueError, match="Unsupported desktop request"):
        await request_handler.dispatch({
            "type": "NOT_SUPPORTED",
            "request_id": "unknown-1",
            "payload": {},
        })
@pytest.mark.asyncio
async def test_user_text_forwards_conversation_context(request_handler):
    events = []

    async def capture(event_name, payload):
        events.append((event_name, payload))

    await request_handler.task_manager.event_bus.subscribe("USER_TEXT", capture)
    payload = {
        "text": "Continue",
        "conversation_id": "conversation-1",
        "conversation_history": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "Continue"},
        ],
    }

    await request_handler.dispatch({
        "type": "USER_TEXT",
        "payload": payload,
    })

    assert events == [("USER_TEXT", payload)]
