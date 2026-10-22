import json
import hashlib
import pytest
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from services.agent.ai.anthropic_provider import AnthropicProvider
from services.agent.ai.capability_registry import CapabilityRegistry
from services.agent.ai.google_provider import GoogleProvider
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.openai_provider import OpenAIProvider
from services.agent.ai.custom_provider import OpenAICompatibleProvider
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.ai.base_provider import KeyHealth
from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.desktop_bridge import _serialize_task_for_desktop
from services.agent.core.event_bus import EventBus
from services.agent.core.browser_page_context import clear_current_page, get_current_page
from services.agent.core.mcp_settings import _mcp_server_statuses
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


def test_cross_provider_failover_migrates_old_default(request_handler):
    request_handler.settings_path.write_text(
        json.dumps({"cross_provider_fallback": False}),
        encoding="utf-8",
    )

    settings = request_handler.get_settings()

    assert settings["cross_provider_fallback"] is True
    assert settings["_cross_provider_failover_migrated"] is True


@pytest.mark.asyncio
async def test_complex_workflow_setting_is_opt_in_and_updates_runtime(request_handler):
    runtime = SimpleNamespace(complex_workflows_enabled=False)
    request_handler.react_loop = runtime
    assert request_handler.get_settings()["complex_workflows_enabled"] is False

    saved = await request_handler._save_settings({
        "complex_workflows_enabled": True,
    })

    assert saved["complex_workflows_enabled"] is True
    assert runtime.complex_workflows_enabled is True
    assert json.loads(request_handler.settings_path.read_text(encoding="utf-8"))[
        "complex_workflows_enabled"
    ] is True


@pytest.mark.asyncio
async def test_subagent_setting_is_available_with_the_active_provider(
    request_handler,
):
    assert request_handler.get_settings()["subagents_available"] is True
    saved = await request_handler._save_settings({"subagents_enabled": True})
    assert saved["subagents_enabled"] is True

    assert request_handler.get_settings()["subagents_available"] is True
    persisted = json.loads(request_handler.settings_path.read_text(encoding="utf-8"))
    assert persisted["subagents_enabled"] is True
    assert "subagents_available" not in persisted


@pytest.mark.asyncio
async def test_adding_second_valid_credential_refreshes_subagent_availability(
    request_handler, monkeypatch,
):
    request_handler.key_manager.keys["google"] = ["first-configured-key"]
    provider = request_handler.provider_registry.get_registered_provider("openai")
    monkeypatch.setattr(
        provider,
        "validate_key",
        AsyncMock(return_value=KeyHealth.HEALTHY),
    )
    availability = []
    request_handler.credentials_updated_callback = lambda: availability.append(
        request_handler.get_settings()["subagents_available"]
    )

    result = await request_handler._validate_key({
        "provider": "openai",
        "slot": 1,
        "key": "second-configured-key",
    })

    assert result == "healthy"
    assert availability == [True]
    assert request_handler.key_manager.get_distinct_configured_credential_count() == 2


@pytest.mark.asyncio
async def test_subagent_task_serialization_exposes_only_allowlisted_metadata():
    task_manager = TaskManager(EventBus())
    task = await task_manager.create_task(
        "child-id",
        "Research task",
        context={"api_key": "never expose"},
        parent_id="parent-id",
        role="research",
        metadata={"task_type": "subagent", "private": "never expose"},
    )

    serialized = _serialize_task_for_desktop(task)

    assert serialized["task_type"] == "subagent"
    assert serialized["parent_id"] == "parent-id"
    assert serialized["role"] == "research"
    assert "metadata" not in serialized
    assert "result" not in serialized
    assert "never expose" not in str(serialized)


@pytest.mark.asyncio
async def test_load_capability_pack_accepts_only_verified_managed_plugin(tmp_path, clean_env):
    key_manager = KeyManager()
    plugin_manager = SimpleNamespace(load_installed_pack=AsyncMock(return_value="system-diagnostics"))
    handler = DesktopRequestHandler(
        TaskManager(EventBus()),
        ProviderRegistry(key_manager),
        CapabilityRegistry(),
        key_manager,
        tmp_path / "settings.json",
        plugin_manager=plugin_manager,
    )
    plugin_path = tmp_path / "capabilities" / "packs" / "system-diagnostics" / "1.0.0.py"
    plugin_path.parent.mkdir(parents=True)
    plugin_path.write_text("# verified plugin\n", encoding="utf-8")
    digest = hashlib.sha256(plugin_path.read_bytes()).hexdigest()

    response = await handler.dispatch({
        "type": "LOAD_CAPABILITY_PACK",
        "request_id": "load-1",
        "payload": {"id": "system-diagnostics", "version": "1.0.0", "sha256": digest},
    })

    assert response["payload"] == {"loaded": True, "plugin": "system-diagnostics"}
    plugin_manager.load_installed_pack.assert_awaited_once_with(str(plugin_path.resolve()))


@pytest.mark.asyncio
async def test_load_capability_pack_rejects_modified_file(tmp_path, clean_env):
    key_manager = KeyManager()
    plugin_manager = SimpleNamespace(load_installed_pack=AsyncMock())
    handler = DesktopRequestHandler(
        TaskManager(EventBus()),
        ProviderRegistry(key_manager),
        CapabilityRegistry(),
        key_manager,
        tmp_path / "settings.json",
        plugin_manager=plugin_manager,
    )
    plugin_path = tmp_path / "capabilities" / "packs" / "system-diagnostics" / "1.0.0.py"
    plugin_path.parent.mkdir(parents=True)
    plugin_path.write_text("modified plugin\n", encoding="utf-8")

    with pytest.raises(ValueError, match="failed SHA-256 verification"):
        await handler._load_capability_pack({
            "id": "system-diagnostics",
            "version": "1.0.0",
            "sha256": "a" * 64,
        })
    plugin_manager.load_installed_pack.assert_not_awaited()


def test_complex_workflow_setting_rejects_non_boolean(request_handler):
    with pytest.raises(
        ValueError,
        match="complex_workflows_enabled must be a boolean",
    ):
        request_handler._apply_runtime_settings({
            **request_handler.get_settings(),
            "complex_workflows_enabled": "true",
        })


@pytest.mark.asyncio
async def test_custom_skill_can_be_created_listed_and_deleted(request_handler):
    request_handler.skill_registry = SkillRegistry(SkillLoader())
    request_handler.skill_registry.discover_skills(
        str(Path(__file__).parents[1] / "skills")
    )

    instructions = "Review decisions and action items.\n\n" + "Detailed guidance. " * 40
    saved = await request_handler.dispatch({
        "type": "SAVE_SKILL",
        "request_id": "create-skill",
        "payload": {
            "skill": {
                "name": "meeting-notes",
                "description": "Summarize meeting notes",
                "triggers": ["minutes", "meeting notes"],
                "tools": [],
                "instructions": instructions,
            },
        },
    })
    assert saved["payload"]["custom"] is True
    assert request_handler.skill_registry.get_skill("meeting-notes").instructions == instructions.strip()

    listed = await request_handler.dispatch({
        "type": "GET_SKILLS",
        "request_id": "list-skills",
        "payload": {},
    })
    saved_skill = next(skill for skill in listed["payload"] if skill["name"] == "meeting-notes")
    assert saved_skill["instructions"] == instructions.strip()

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
async def test_legacy_url_mcp_status_is_visible_without_echoing_url_or_credentials(request_handler):
    secret_url = "https://mcp.example/private?token=url-secret"
    secret_credential = "credential-secret"
    request_handler.settings_path.write_text(
        json.dumps({
            "mcp_servers": [{
                "name": "legacy-remote",
                "server_url": secret_url,
                "headers": {"Authorization": secret_credential},
                "enabled": True,
            }],
        }),
        encoding="utf-8",
    )
    request_handler.mcp_status_provider = lambda servers: _mcp_server_statuses(
        servers,
        active_servers={},
        connecting_servers=set(),
        server_errors={},
        tools_cache={},
    )

    response = await request_handler.dispatch({
        "type": "GET_MCP_SERVERS",
        "request_id": "legacy-mcp-status",
        "payload": {},
    })

    status = response["payload"][0]
    assert status["status"] == "unsupported"
    assert "URL-based MCP servers are not supported" in status["error"]
    assert secret_url not in json.dumps(response)
    assert secret_credential not in json.dumps(response)


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
async def test_mcp_settings_accept_only_stdio_launch_commands(request_handler):
    settings = await request_handler._save_settings({
        "mcp_servers": [{
            "name": "local-files",
            "command": "python local_server.py",
            "enabled": True,
        }],
    })

    assert settings["mcp_servers"] == [{
        "name": "local-files",
        "command": "python local_server.py",
        "enabled": True,
    }]

    for url_field in ("url", "server_url"):
        with pytest.raises(ValueError, match="MCP URL transport is not supported"):
            await request_handler._save_settings({
                "mcp_servers": [{
                    "name": "remote",
                    "command": "python local_server.py",
                    "enabled": True,
                    url_field: "http://127.0.0.1/private?token=secret",
                }],
            })

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
async def test_custom_ollama_endpoint_routes_gemma_model_and_capabilities(
    request_handler, monkeypatch
):
    configured_endpoints = []
    monkeypatch.setattr(
        request_handler.key_manager,
        "configure_custom_endpoint",
        lambda endpoint_id, allow_empty=False: configured_endpoints.append(
            (endpoint_id, allow_empty)
        ),
    )
    request_handler._configure_custom_endpoints({
        "custom_endpoints": [{
            "id": "custom_ollama",
            "name": "Ollama",
            "baseUrl": "http://localhost:11434/v1",
            "enabled": True,
        }],
    })
    request_handler._configure_custom_models({
        "custom_models": [{
            "id": "gemma3:4b",
            "provider": "custom_ollama",
            "display_name": "Gemma 3 4B",
            "capabilities": {
                "text": True,
                "tool_calling": True,
                "vision": True,
            },
        }],
    })

    provider = request_handler.provider_registry.get_registered_provider(
        "custom_ollama"
    )
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "http://localhost:11434/v1"
    assert configured_endpoints == [("custom_ollama", True)]
    model = provider.get_available_models()[0]
    assert model.id == "gemma3:4b"
    assert model.capabilities.vision
    assert model.capabilities.tool_calling
    assert request_handler.capability_registry.get_models_for_provider(
        "custom_ollama"
    )[0].id == "gemma3:4b"

    routed = {}

    async def fake_chat(_provider, messages, model, **kwargs):
        routed.update({"messages": messages, "model": model, **kwargs})
        return "local response"

    monkeypatch.setattr(OpenAIProvider, "chat", fake_chat)
    response = await provider.chat(
        [{"role": "user", "content": "Hello"}],
        model="gemma3:4b",
    )

    assert response == "local response"
    assert routed["model"] == "gemma3:4b"
    assert routed["base_url"] == "http://localhost:11434/v1"

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


def test_lite_camera_default_is_enabled_but_saved_opt_out_is_preserved(
    request_handler, monkeypatch
):
    monkeypatch.delenv("CAMERA_ENABLED", raising=False)
    monkeypatch.delenv("HELIX_CAMERA_ENABLED_BY_DEFAULT", raising=False)
    assert request_handler.get_settings()["camera_enabled"] is False

    monkeypatch.setenv("HELIX_CAMERA_ENABLED_BY_DEFAULT", "true")

    assert request_handler.get_settings()["camera_enabled"] is True

    request_handler.settings_path.write_text(
        json.dumps({"camera_enabled": False}),
        encoding="utf-8",
    )

    assert request_handler.get_settings()["camera_enabled"] is False


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
