import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from services.agent.ai.base_provider import (
    ChatMessage,
    ChatResponse,
    ToolCall,
    ToolCallResponse,
)
from services.agent.ai.capability_registry import CapabilityRegistry
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.model_router import RouteCandidate, TaskRequirements
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.core.orchestrator import (
    _append_requested_screen_observation,
    _should_observe_screen,
)
from services.agent.core.react_loop import ReActLoop
from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.event_bus import EventBus
from services.agent.core.task_manager import TaskManager
from services.agent.perception.screen_observation_policy import (
    screen_observation_scope,
    screen_observation_is_allowed,
)
from services.agent.tools.computer_tool import ScreenObserveTool
from services.agent.tools.keyboard_tool import KeyboardTool
from services.agent.perception.screen_engine import ScreenEngine
from services.agent.tools.computer_tool import ComputerTool
from services.agent.tools.screenshot_tool import ScreenshotTool


@pytest.fixture
def settings_handler(tmp_path):
    key_manager = KeyManager()
    return DesktopRequestHandler(
        TaskManager(EventBus()),
        ProviderRegistry(key_manager),
        CapabilityRegistry(),
        key_manager,
        tmp_path / "settings.json",
    )


def _make_loop(
    *,
    enabled,
    request_active,
    capture_tool,
    continuous_enabled=False,
    model_decides_enabled=False,
    tool_name="computer.observe_screen",
    description="What is on my screen?",
    event_bus=None,
):
    candidate = RouteCandidate(
        provider_id="mock-provider",
        model_id="mock-vision-model",
        key_slot=0,
        score=1,
        fallback_available=False,
    )
    provider = SimpleNamespace(
        tool_call=AsyncMock(side_effect=[
            ToolCallResponse(
                tool_calls=[
                    ToolCall(id="capture-1", name=tool_name, arguments={})
                ],
                content="",
                model=candidate.model_id,
                provider=candidate.provider_id,
            ),
            ChatResponse(
                content="Done.",
                model=candidate.model_id,
                provider=candidate.provider_id,
                usage=None,
                finish_reason="stop",
            ),
        ]),
        chat=AsyncMock(),
    )
    requirements_seen = []

    class Fallback:
        async def execute_with_fallback(self, call, requirements, context):
            requirements_seen.append(requirements.vision)
            return await call(candidate, context)

    schemas = [{
        "name": tool_name,
        "description": "Perform the requested screen operation.",
        "parameters": {"type": "object", "properties": {}},
    }]
    tool_registry = SimpleNamespace(
        get_tool_schemas=lambda **_kwargs: schemas,
        get_tool=lambda _name: capture_tool,
    )
    event_bus = event_bus or SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=SimpleNamespace(
            get_provider=lambda _provider_id: provider
        ),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=tool_registry,
        key_manager=SimpleNamespace(
            get_key=lambda _provider_id, _slot: "mock-key"
        ),
        event_bus=event_bus,
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(
                requirements=TaskRequirements()
            )
        ),
    )
    loop.screen_context_enabled = enabled
    loop.continuous_screen_vision_enabled = continuous_enabled
    loop.model_decides_screen_vision_enabled = model_decides_enabled
    response = asyncio.run(loop.execute(
        [ChatMessage(role="user", content=description)],
        screen_request_active=request_active,
    ))
    return response, provider, requirements_seen


def test_screen_context_settings_are_independent_and_default_off(settings_handler):
    settings = settings_handler.get_settings()

    assert settings["screen_context_enabled"] is False
    assert settings["model_decides_screen_vision_enabled"] is False
    assert settings["continuous_screen_vision_enabled"] is False
    assert settings["continuous_screen_vision_interval_ms"] == 10_000


def test_screen_context_settings_round_trip(settings_handler):
    runtime = SimpleNamespace(
        screen_context_enabled=False,
        model_decides_screen_vision_enabled=False,
        on_demand_screen_context_enabled=False,
        continuous_screen_vision_enabled=False,
    )
    settings_handler.react_loop = runtime

    async def save_and_load():
        saved = await settings_handler._save_settings({
            "screen_context_enabled": True,
            "model_decides_screen_vision_enabled": True,
            "continuous_screen_vision_enabled": True,
            "continuous_screen_vision_interval_ms": 12_000,
        })
        loaded = settings_handler.get_settings()
        return saved, loaded

    saved, loaded = asyncio.run(save_and_load())

    assert saved["screen_context_enabled"] is True
    assert saved["model_decides_screen_vision_enabled"] is True
    assert saved["continuous_screen_vision_enabled"] is True
    assert saved["continuous_screen_vision_interval_ms"] == 12_000
    assert loaded["screen_context_enabled"] is True
    assert loaded["model_decides_screen_vision_enabled"] is True
    assert loaded["continuous_screen_vision_enabled"] is True
    assert loaded["continuous_screen_vision_interval_ms"] == 12_000
    assert runtime.screen_context_enabled is True
    assert runtime.on_demand_screen_context_enabled is True
    assert runtime.continuous_screen_vision_enabled is True
    assert runtime.model_decides_screen_vision_enabled is True

    settings_handler._apply_runtime_settings({
        **loaded,
        "screen_context_enabled": False,
        "model_decides_screen_vision_enabled": False,
        "continuous_screen_vision_enabled": True,
    })
    assert runtime.screen_context_enabled is False
    assert runtime.model_decides_screen_vision_enabled is False
    assert runtime.on_demand_screen_context_enabled is False
    assert runtime.continuous_screen_vision_enabled is True


def test_legacy_five_second_interval_is_migrated_to_ten_seconds(
    settings_handler,
):
    settings_handler.settings_path.write_text(
        json.dumps({"continuous_screen_vision_interval_ms": 5_000}),
        encoding="utf-8",
    )

    settings = settings_handler.get_settings()

    assert settings["continuous_screen_vision_interval_ms"] == 10_000


@pytest.mark.parametrize("interval", [10_000, 60_000])
def test_screen_vision_sampling_interval_accepts_safe_bounds(
    settings_handler, interval
):
    settings_handler._apply_runtime_settings({
        **settings_handler.get_settings(),
        "continuous_screen_vision_interval_ms": interval,
    })


@pytest.mark.parametrize("interval", [9_999, 60_001, True, 10.0, "10000"])
def test_screen_vision_sampling_interval_rejects_invalid_values(
    settings_handler, interval
):
    with pytest.raises(ValueError, match="continuous_screen_vision_interval_ms"):
        settings_handler._apply_runtime_settings({
            **settings_handler.get_settings(),
            "continuous_screen_vision_interval_ms": interval,
        })


def test_screen_context_requires_setting_and_relevant_request():
    assert not _should_observe_screen(False, "Inspect the screen")
    assert not _should_observe_screen(False, "What is on my screen?")
    assert not _should_observe_screen(True, "Tell me a joke")
    assert _should_observe_screen(True, "Take a screenshot of the desktop")


def test_continuous_screen_vision_allows_model_selected_screen_capture():
    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=False,
        request_active=False,
        continuous_enabled=True,
        capture_tool=capture_tool,
        description="Help me with this task.",
    )

    capture_tool.execute.assert_awaited_once()


def test_continuous_screen_vision_allows_requested_desktop_actions():
    async def execute(_params):
        assert screen_observation_is_allowed()
        return SimpleNamespace(
            success=True,
            output={"clicked": "Save", "screenshot_bytes": b"verified-frame"},
            error=None,
        )

    action_tool = SimpleNamespace(
        name="computer.click_element",
        description="Click a visible control.",
        permission_level="LOW_RISK",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(side_effect=execute),
    )
    _make_loop(
        enabled=False,
        request_active=True,
        continuous_enabled=True,
        capture_tool=action_tool,
        tool_name="computer.click_element",
        description="Click Save on my screen.",
    )

    action_tool.execute.assert_awaited_once()


@pytest.mark.parametrize(
    "tool_name",
    ["computer.observe_screen", "screenshot_tool"],
)
def test_continuous_screen_vision_allows_screen_capture_when_requested(tool_name):
    capture_tool = SimpleNamespace(
        name=tool_name,
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=False,
        request_active=True,
        continuous_enabled=True,
        capture_tool=capture_tool,
        tool_name=tool_name,
        description="Describe my screen.",
    )

    capture_tool.execute.assert_awaited_once()


@pytest.mark.parametrize(
    "description",
    [
        "Explain what a word means",
        "Write a word in the answer",
        "Select a word in this sentence",
        "What is Microsoft Excel?",
        "¿Qué es Excel?",
        "¿Qué significa word?",
        "What does Word mean?",
        "What does the phrase 'click the Save button' mean?",
        "Explain what click the Save button means",
        "Explain the phrase 'inspect my screen'",
        "Explica la frase 'mira mi pantalla'",
        "Translate the phrase 'click the Save button'",
        "Traduce la frase 'click the Save button'",
        "¿Qué significa la frase 'click the Save button'?",
        "What is Notepad?",
        "Tell me about Excel",
        "Tell me a joke",
        "Open Word",
        "Abre Word",
    ],
)
def test_general_questions_and_app_launches_do_not_request_screen_capture(
    description,
):
    assert not _should_observe_screen(True, description)

    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=False,
        request_active=_should_observe_screen(True, description),
        capture_tool=capture_tool,
        description=description,
    )

    capture_tool.execute.assert_not_awaited()


@pytest.mark.parametrize(
    "description",
    [
        "Mira mi pantalla",
        "Describe my screen",
        "What is in the open window?",
        "What is visible in the active window?",
        "Describe the open Excel app",
        "Inspect my open Word window",
        "inspect my screen",
        "What is in the open Excel window?",
        "¿Qué ves en mi pantalla?",
        "¿Qué hay en la ventana abierta?",
        "Haz clic en la aplicación Word",
        "Click the Word application icon",
        "Click the Save button on screen",
        "Take a screenshot of the desktop",
    ],
)
def test_explicit_screen_inspection_and_actions_request_capture(description):
    assert _should_observe_screen(True, description)


def test_orchestrator_forwards_explicit_screen_context_as_ephemeral_image():
    screenshot = b"mock-screen-frame"
    context = {
        "screenshot_bytes": screenshot,
        "active_window": {"title": "Mock app"},
    }
    observe = SimpleNamespace(
        success=True,
        output=context,
        error=None,
    )
    tool = SimpleNamespace(execute=AsyncMock(return_value=observe))
    messages = []

    asyncio.run(_append_requested_screen_observation(
        messages,
        SimpleNamespace(get_tool=lambda _name: tool),
        "task-1",
    ))

    tool.execute.assert_awaited_once_with({})
    assert messages[0].image_bytes == screenshot
    assert "Mock app" in messages[0].content
    assert context["screenshot_bytes"] == screenshot
    assert not screen_observation_is_allowed()


def test_orchestrator_reports_screen_observation_exceptions(caplog):
    tool = SimpleNamespace(
        execute=AsyncMock(side_effect=RuntimeError("capture failed")),
    )
    messages = []

    asyncio.run(_append_requested_screen_observation(
        messages,
        SimpleNamespace(get_tool=lambda _name: tool),
        "task-2",
    ))

    tool.execute.assert_awaited_once_with({})
    assert "RuntimeError" in messages[0].content
    assert "Do not claim to know what is visible" in messages[0].content
    assert "On-demand screen observation raised an error" in caplog.text
    assert not screen_observation_is_allowed()


def test_react_loop_blocks_capture_when_feature_is_off():
    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    response, provider, requirements_seen = _make_loop(
        enabled=False,
        request_active=True,
        capture_tool=capture_tool,
    )

    assert response.content == "Done."
    capture_tool.execute.assert_not_awaited()
    assert requirements_seen == [False, False]
    assert provider.tool_call.await_count == 2


def test_react_loop_routes_ephemeral_capture_to_vision_model(tmp_path):
    screenshot = b"mock image bytes"

    async def observe(_arguments):
        assert screen_observation_is_allowed()
        return SimpleNamespace(
            success=True,
            output={"screenshot_bytes": screenshot, "active_window": "Mock app"},
            error=None,
        )

    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(side_effect=observe),
    )
    response, provider, requirements_seen = _make_loop(
        enabled=True,
        request_active=True,
        capture_tool=capture_tool,
    )

    assert response.content == "Done."
    capture_tool.execute.assert_awaited_once()
    assert requirements_seen == [False, True]
    assert any(
        message.image_bytes == screenshot
        for message in provider.tool_call.await_args_list[1].args[0]
    )
    assert list(tmp_path.iterdir()) == []


def test_screenshot_tool_image_is_attached_to_next_model_turn_when_enabled():
    screenshot = b"mock screenshot bytes"
    event_bus = SimpleNamespace(publish=AsyncMock())

    async def capture(_arguments):
        assert screen_observation_is_allowed()
        return SimpleNamespace(success=True, output=screenshot, error=None)

    screenshot_tool = SimpleNamespace(
        name="screenshot_tool",
        description="Capture a screenshot.",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(side_effect=capture),
    )
    response, provider, requirements_seen = _make_loop(
        enabled=True,
        continuous_enabled=True,
        request_active=True,
        capture_tool=screenshot_tool,
        tool_name="screenshot_tool",
        description="Take a screenshot of the desktop.",
        event_bus=event_bus,
    )

    assert response.content == "Done."
    screenshot_tool.execute.assert_awaited_once()
    assert requirements_seen == [False, True]
    follow_up_messages = provider.tool_call.await_args_list[1].args[0]
    assert any(message.image_bytes == screenshot for message in follow_up_messages)
    assert any(
        message.role == "tool"
        and "Screenshot captured successfully" in message.content
        for message in follow_up_messages
    )
    published_events = [call.args[0] for call in event_bus.publish.await_args_list]
    assert "AGENT_MESSAGE" not in published_events
    assert all(
        screenshot.decode() not in repr(call.args[1])
        for call in event_bus.publish.await_args_list
    )


def test_disabled_screen_context_blocks_model_selected_observation():
    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Screen observation tool",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=False,
        request_active=True,
        capture_tool=capture_tool,
    )

    capture_tool.execute.assert_not_awaited()


@pytest.mark.parametrize(
    ("enabled", "continuous_enabled", "model_decides_enabled"),
    [
        (False, True, False),
        (False, False, True),
    ],
    ids=["continuous", "model-decides"],
)
def test_enabled_screen_vision_mode_allows_model_selected_capture(
    enabled,
    continuous_enabled,
    model_decides_enabled,
):
    screenshot = b"model-selected-frame"

    async def observe(_arguments):
        assert screen_observation_is_allowed()
        return SimpleNamespace(
            success=True,
            output={"screenshot_bytes": screenshot, "active_window": "Mock app"},
            error=None,
        )

    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Capture the current screen.",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(side_effect=observe),
    )
    response, provider, requirements_seen = _make_loop(
        enabled=enabled,
        request_active=False,
        continuous_enabled=continuous_enabled,
        model_decides_enabled=model_decides_enabled,
        capture_tool=capture_tool,
        description="Help me with this task.",
    )

    assert response.content == "Done."
    capture_tool.execute.assert_awaited_once()
    assert requirements_seen == [False, True]
    assert any(
        message.image_bytes == screenshot
        for message in provider.tool_call.await_args_list[1].args[0]
    )


def test_on_demand_screen_context_does_not_allow_unsolicited_capture():
    capture_tool = SimpleNamespace(
        name="computer.observe_screen",
        description="Capture the current screen.",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=True,
        request_active=False,
        capture_tool=capture_tool,
        description="Help me with this task.",
    )

    capture_tool.execute.assert_not_awaited()


def test_model_decides_screen_vision_does_not_enable_desktop_actions():
    action_tool = SimpleNamespace(
        name="computer.click_element",
        description="Click a visible control.",
        permission_level="LOW_RISK",
        requires_confirmation=False,
        validate_params=lambda _args: True,
        execute=AsyncMock(),
    )
    _make_loop(
        enabled=False,
        request_active=False,
        model_decides_enabled=True,
        capture_tool=action_tool,
        tool_name="computer.click_element",
        description="Help me with this task.",
    )

    action_tool.execute.assert_not_awaited()


def test_observe_tool_requires_explicit_policy_and_keeps_image_in_memory():
    tool = ScreenObserveTool()
    tool.capture_context = AsyncMock(return_value={
        "screenshot_bytes": b"ephemeral",
        "active_window": {"title": "Mock window"},
    })

    blocked = asyncio.run(tool.execute({}))
    assert not blocked.success
    tool.capture_context.assert_not_awaited()

    with screen_observation_scope(True):
        allowed = asyncio.run(tool.execute({}))

    assert allowed.success
    assert allowed.output["screenshot_bytes"] == b"ephemeral"
    tool.capture_context.assert_awaited_once()
    assert not screen_observation_is_allowed()


def test_keyboard_action_skips_screenshot_when_screen_context_is_disabled(monkeypatch):
    keyboard = KeyboardTool.__new__(KeyboardTool)
    keyboard.press_key = AsyncMock()
    capture = Mock(return_value={"screenshot_bytes": b"mock"})
    monkeypatch.setattr(ScreenEngine, "capture_context", capture)

    result = asyncio.run(keyboard.execute({"key": "tab"}))

    assert result.success
    assert result.output == {"key": "tab"}
    keyboard.press_key.assert_awaited_once_with("tab")
    capture.assert_not_called()


def test_desktop_capture_and_uia_tools_do_not_access_screen_without_consent():
    computer = ComputerTool()
    active_window = Mock(return_value={"hwnd": 1})
    computer.screen_engine = SimpleNamespace(
        get_active_window_info=active_window,
        capture_full=Mock(return_value=b"must-not-capture"),
    )

    with pytest.raises(RuntimeError, match="disabled"):
        asyncio.run(computer.click_on_element("Save"))

    assert not active_window.called
    assert not computer.screen_engine.capture_full.called

    screenshot_tool = ScreenshotTool()
    screenshot_tool.capture_screen = AsyncMock(return_value=b"must-not-capture")
    result = asyncio.run(screenshot_tool.execute({"operation": "capture_screen"}))
    assert not result.success
    screenshot_tool.capture_screen.assert_not_awaited()
