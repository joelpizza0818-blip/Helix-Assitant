import pytest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from services.agent.ai.anthropic_provider import AnthropicProvider
from services.agent.ai.capability_registry import CapabilityRegistry
from services.agent.ai.google_provider import GoogleProvider
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.openai_provider import OpenAIProvider
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.ai.base_provider import KeyHealth
from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.event_bus import EventBus
from services.agent.core.browser_page_context import clear_current_page, get_current_page
from services.agent.core.task_manager import TaskManager
from services.agent.skills.skill_loader import SkillLoader
from services.agent.skills.skill_registry import SkillRegistry


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


def test_microphone_sensitivity_default_is_more_sensitive(request_handler):
    assert request_handler.get_settings()["vad_threshold"] == 250


def test_wake_word_threshold_default_and_range_validation(request_handler):
    assert request_handler.get_settings()["wake_word_threshold"] == 0.5

    for invalid_threshold in (True, 0.05, 0.95):
        with pytest.raises(ValueError, match="wake_word_threshold must be between 0.1 and 0.9"):
            request_handler._apply_runtime_settings({
                **request_handler.get_settings(),
                "wake_word_threshold": invalid_threshold,
            })


@pytest.mark.asyncio
async def test_custom_skill_can_be_created_listed_and_deleted(request_handler):
    request_handler.skill_registry = SkillRegistry(SkillLoader())
    request_handler.skill_registry.discover_skills(
        str(Path(__file__).parents[1] / "skills")
    )

    saved = await request_handler.dispatch({
        "type": "SAVE_SKILL",
        "request_id": "create-skill",
        "payload": {
            "skill": {
                "name": "meeting-notes",
                "description": "Summarize meeting notes",
                "triggers": ["minutes", "meeting notes"],
                "tools": [],
                "instructions": "Summarize decisions and action items.",
            },
        },
    })
    assert saved["payload"]["custom"] is True
    assert request_handler.skill_registry.get_skill("meeting-notes").instructions == (
        "Summarize decisions and action items."
    )

    listed = await request_handler.dispatch({
        "type": "GET_SKILLS",
        "request_id": "list-skills",
        "payload": {},
    })
    assert any(skill["name"] == "meeting-notes" for skill in listed["payload"])

    await request_handler.dispatch({
        "type": "DELETE_SKILL",
        "request_id": "delete-skill",
        "payload": {"name": "meeting-notes"},
    })
    assert request_handler.skill_registry.get_skill("meeting-notes") is None


@pytest.mark.asyncio
async def test_browser_page_update_is_available_to_agent_tools(request_handler):
    clear_current_page()
    page = {
        "title": "Search results",
        "url": "https://example.com/search",
        "text": "Visible result text",
        "links": [{"text": "First result", "url": "https://example.com/first"}],
        "forms": [{"label": "Search", "type": "search"}],
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }

    await request_handler.dispatch({
        "type": "BROWSER_PAGE_UPDATE",
        "payload": page,
    })

    assert get_current_page() == page
    clear_current_page()


@pytest.mark.asyncio
async def test_browser_page_update_rejects_invalid_urls(request_handler):
    with pytest.raises(ValueError, match="HTTP or HTTPS"):
        await request_handler.dispatch({
            "type": "BROWSER_PAGE_UPDATE",
            "payload": {
                "title": "Invalid",
                "url": "file:///private/data",
                "text": "not allowed",
                "captured_at": "2026-01-01T00:00:00+00:00",
                "links": [],
                "forms": [],
            },
        })


@pytest.mark.asyncio
async def test_custom_skill_cannot_overwrite_builtin(request_handler):
    request_handler.skill_registry = SkillRegistry(SkillLoader())
    request_handler.skill_registry.discover_skills(
        str(Path(__file__).parents[1] / "skills")
    )

    with pytest.raises(ValueError, match="Cannot replace built-in"):
        await request_handler.dispatch({
            "type": "SAVE_SKILL",
            "request_id": "replace-builtin",
            "payload": {
                "skill": {
                    "name": "coding",
                    "description": "overwrite",
                    "triggers": [],
                    "tools": [],
                    "instructions": "no",
                },
            },
        })


@pytest.mark.asyncio
async def test_validated_key_is_saved_for_model_routing(request_handler, monkeypatch):
    provider = request_handler.provider_registry.get_registered_provider("google")

    async def validate_key(_api_key):
        return KeyHealth.HEALTHY

    monkeypatch.setattr(provider, "validate_key", validate_key)
    response = await request_handler.dispatch({
        "type": "VALIDATE_KEY",
        "request_id": "save-google-key",
        "payload": {"provider": "google", "slot": 2, "key": "validated-key"},
    })

    assert response["payload"] == "healthy"
    assert request_handler.key_manager.get_key("google", 1) == "validated-key"
    models = await request_handler.dispatch({
        "type": "GET_MODELS",
        "request_id": "vision-models",
        "payload": {"requirements": {"vision": True, "tool_calling": True}},
    })
    assert any(
        model["provider"] == "google"
        and model["capabilities"]["vision"]
        and model["capabilities"]["tool_calling"]
        for model in models["payload"]
    )

@pytest.mark.asyncio
async def test_validated_key_supports_slots_beyond_three(request_handler, monkeypatch):
    provider = request_handler.provider_registry.get_registered_provider("openai")

    async def validate_key(_api_key):
        return KeyHealth.HEALTHY

    monkeypatch.setattr(provider, "validate_key", validate_key)
    response = await request_handler.dispatch({
        "type": "VALIDATE_KEY",
        "request_id": "save-openai-key-4",
        "payload": {"provider": "openai", "slot": 4, "key": "validated-key-4"},
    })

    assert response["payload"] == "healthy"
    assert request_handler.key_manager.get_key("openai", 3) == "validated-key-4"
    assert request_handler.key_manager.get_available_keys("openai")[-1] == (
        3,
        "validated-key-4",
    )

@pytest.mark.asyncio
async def test_task_model_request_history_updates_by_request_id():
    event_bus = AsyncMock()
    manager = TaskManager(event_bus)
    await manager.create_task("task-audit", "Inspect model calls")

    await manager.record_model_request("task-audit", {
        "request_id": "request-1",
        "status": "attempting",
        "provider": "google",
    })
    await manager.record_model_request("task-audit", {
        "request_id": "request-1",
        "status": "succeeded",
        "provider": "google",
    })

    task = await manager.get_task("task-audit")
    assert len(task.model_requests) == 1
    assert task.model_requests[0]["status"] == "succeeded"
    assert event_bus.publish.await_args_list[-1].args == (
        "TASK_DETAILS_CHANGED",
        {"task_id": "task-audit"},
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
async def test_custom_endpoint_key_is_not_written_to_settings(request_handler, monkeypatch):
    stored = {}
    monkeypatch.setattr(
        "services.agent.ai.key_manager.keyring.set_password",
        lambda service, name, value: stored.__setitem__((service, name), value),
    )
    monkeypatch.setattr(
        "services.agent.ai.key_manager.keyring.get_password",
        lambda service, name: stored.get((service, name)),
    )

    saved = await request_handler.dispatch({
        "type": "SAVE_SETTINGS",
        "request_id": "save-custom-endpoint",
        "payload": {
            "settings": {
                "custom_endpoints": [{
                    "id": "local_ollama",
                    "name": "Ollama",
                    "baseUrl": "http://localhost:11434/v1",
                    "apiKey": "endpoint-secret",
                    "enabled": True,
                }]
            }
        },
    })

    assert "apiKey" not in saved["payload"]["custom_endpoints"][0]
    assert saved["payload"]["custom_endpoints"][0]["api_key_configured"] is True
    assert "endpoint-secret" not in request_handler.settings_path.read_text()
    assert stored[("helix_agent", "custom_endpoint_api_key_local_ollama")] == "endpoint-secret"

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
