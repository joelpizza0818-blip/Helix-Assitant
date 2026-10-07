import asyncio
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.agent.ai.anthropic_provider import AnthropicProvider
from services.agent.ai.base_provider import (
    ChatMessage,
    ChatResponse,
    ToolCall,
    ToolCallResponse,
)
from services.agent.ai.google_provider import GoogleProvider
from services.agent.ai.model_router import RouteCandidate, TaskRequirements
from services.agent.ai.openai_provider import OpenAIProvider
from google.genai.errors import ClientError
from services.agent.core.orchestrator import Orchestrator
from services.agent.core.task_manager import TaskStatus
from services.agent.core.tool_registry import ToolRegistry
from services.agent.core.agent import Agent
from services.agent.core.state_manager import StateManager
from services.agent.core.event_bus import EventBus
from services.agent.core.task_manager import TaskManager


def test_user_text_is_routed_as_a_conversation():
    orchestrator = SimpleNamespace(execute_task=AsyncMock())
    agent = Agent.__new__(Agent)
    agent.intent_matcher = None
    agent.skill_registry = None
    agent.task_manager = SimpleNamespace(create_task=AsyncMock())
    agent.orchestrator = orchestrator
    agent.state_manager = StateManager()

    async def send_text():
        await agent.handle_user_input("USER_TEXT", {
            "text": "Hi",
            "conversation_id": "conversation-1",
            "conversation_history": [{"role": "user", "content": "Hi"}],
        })
        await asyncio.sleep(0)

    asyncio.run(send_text())

    agent.task_manager.create_task.assert_awaited_once()
    orchestrator.execute_task.assert_awaited_once()
    assert orchestrator.execute_task.await_args.kwargs["context"] == {
        "input_source": "text",
        "conversation_id": "conversation-1",
        "conversation_history": [{"role": "user", "content": "Hi"}],
    }


def test_single_user_text_creates_exactly_one_task_created_event():
    event_bus = EventBus()
    task_manager = TaskManager(event_bus)
    agent = Agent.__new__(Agent)
    agent.intent_matcher = None
    agent.skill_registry = None
    agent.task_manager = task_manager
    agent.state_manager = StateManager()
    task_finished = asyncio.Event()

    async def execute_task(*_args, **_kwargs):
        task_finished.set()

    agent.orchestrator = SimpleNamespace(execute_task=execute_task)
    created_events = []

    async def capture(_event_name, payload):
        created_events.append(payload)

    async def run_input():
        await event_bus.subscribe("TASK_CREATED", capture)
        await agent.handle_user_input("USER_TEXT", {"text": "Start a task."})
        await asyncio.wait_for(task_finished.wait(), timeout=1)
        await asyncio.sleep(0)

    asyncio.run(run_input())

    assert len(created_events) == 1
    assert len(task_manager.tasks) == 1


def test_task_context_is_isolated_by_task_id():
    event_bus = EventBus()
    task_manager = TaskManager(event_bus)
    context_a = {
        "conversation_id": "conversation-a",
        "messages": [{"role": "user", "content": "Task A"}],
    }
    context_b = {
        "conversation_id": "conversation-b",
        "messages": [{"role": "user", "content": "Task B"}],
    }

    async def create_tasks():
        await task_manager.create_task("task-a", "Task A", context=context_a)
        await task_manager.create_task("task-b", "Task B", context=context_b)
        stored_a = await task_manager.get_task_context("task-a")
        stored_b = await task_manager.get_task_context("task-b")
        stored_a["messages"][0]["content"] = "mutated"
        return (
            stored_a,
            stored_b,
            await task_manager.get_task_context("task-a"),
            await task_manager.get_task_context("task-b"),
        )

    stored_a, stored_b, isolated_a, isolated_b = asyncio.run(create_tasks())

    assert stored_a["conversation_id"] == "conversation-a"
    assert stored_b["conversation_id"] == "conversation-b"
    assert isolated_a["messages"][0]["content"] == "Task A"
    assert isolated_b["messages"][0]["content"] == "Task B"


def test_tool_registry_provides_named_parameter_schemas():
    registry = ToolRegistry()
    registry.register_tool(SimpleNamespace(
        name="lookup",
        description="Look something up.",
        get_schema=lambda: {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    ))

    schema = registry.get_tool_schemas()[0]
    assert schema == {
        "name": "lookup",
        "description": "Look something up.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    }


def test_provider_tool_formats_and_tool_result_history():
    canonical_tools = [{
        "name": "lookup",
        "description": "Look something up.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
    }]
    history = [
        ChatMessage(
            role="assistant",
            content="",
            tool_calls=[{"id": "call-1", "name": "lookup", "arguments": {"query": "hello"}}],
        ),
        ChatMessage(
            role="tool",
            content="found it",
            tool_call_id="call-1",
            tool_name="lookup",
        ),
    ]

    openai_tools = OpenAIProvider._convert_tools(canonical_tools)
    assert openai_tools[0]["function"]["name"] == "lookup"
    assert OpenAIProvider()._convert_messages(history)[0]["tool_calls"][0]["id"] == "call-1"

    anthropic_history = AnthropicProvider()._convert_messages(history)
    assert anthropic_history[0]["content"][0]["type"] == "tool_use"
    assert anthropic_history[1]["content"][0]["tool_use_id"] == "call-1"

    google_history = GoogleProvider()._convert_messages(history)
    assert google_history[0].parts[0].function_call.name == "lookup"
    assert google_history[1].parts[0].function_response.name == "lookup"
    google_tools = GoogleProvider._convert_tools(canonical_tools)
    assert google_tools[0].function_declarations[0].name == "lookup"

def test_google_messages_match_installed_sdk_and_preserve_roles_and_modal_parts():
    history = [
        ChatMessage(role="system", content="Be concise."),
        ChatMessage(role="user", content="What is in this image?", image_bytes=b"image"),
        ChatMessage(
            role="assistant",
            content="I will inspect it.",
            tool_calls=[{"id": "call-1", "name": "lookup", "arguments": {"query": "image"}}],
        ),
        ChatMessage(
            role="tool",
            content="A red ball.",
            tool_call_id="call-1",
            tool_name="lookup",
        ),
    ]

    contents = GoogleProvider()._convert_messages(history)

    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[0].parts[0].text == "What is in this image?"
    assert contents[0].parts[1].inline_data.data == b"image"
    assert contents[1].parts[0].text == "I will inspect it."
    assert contents[1].parts[1].function_call.name == "lookup"
    assert contents[2].parts[0].function_response.name == "lookup"
    assert GoogleProvider._get_system_instruction(history) == "Be concise."


def test_google_native_function_call_content_preserves_thought_signature():
    from google.genai import types

    native_content = types.Content(
        role="model",
        parts=[
            types.Part(
                function_call=types.FunctionCall(
                    name="lookup",
                    args={"query": "weather"},
                ),
                thought_signature=b"signature-bytes",
            )
        ],
    )
    message = ChatMessage(
        role="assistant",
        content="",
        tool_calls=[{
            "id": "lookup",
            "name": "lookup",
            "arguments": {"query": "weather"},
        }],
        provider_data=native_content,
    )

    converted = GoogleProvider()._convert_messages([message])

    assert converted == [native_content]
    assert converted[0].parts[0].thought_signature == b"signature-bytes"


def test_google_message_conversion_errors_are_internal_client_errors(monkeypatch):
    provider = GoogleProvider()

    def broken_text_part(*, text):
        raise TypeError("bad SDK call")

    from services.agent.ai import google_provider
    monkeypatch.setattr(google_provider.types.Part, "from_text", broken_text_part)
    with pytest.raises(Exception) as exc_info:
        provider._convert_messages([ChatMessage(role="user", content="hello")])

    assert exc_info.value.code == "INTERNAL_CLIENT_ERROR"

def test_google_provider_normalizes_request_and_quota_errors():
    provider = GoogleProvider()

    quota_error = ClientError(429, {
        "error": {
            "message": "Quota exceeded. Please check billing details.",
            "status": "RESOURCE_EXHAUSTED",
        }
    })
    billing_error = ClientError(402, {
        "error": {"message": "Payment required."}
    })
    request_error = ClientError(400, {
        "error": {"message": "Request blocked by safety policy."}
    })

    assert provider.normalize_error(quota_error).code == "QUOTA_EXCEEDED"
    assert provider.normalize_error(billing_error).code == "BILLING_EXHAUSTED"
    assert provider.normalize_error(request_error).code == "CONTENT_POLICY"


def test_anthropic_credit_balance_error_is_normalized_for_fallback():
    error = AnthropicProvider().normalize_error(
        RuntimeError("Your credit balance is too low to access the API.")
    )

    assert error.code == "BILLING_EXHAUSTED"


def test_react_loop_passes_candidate_key_and_named_tools():
    from services.agent.core.react_loop import ReActLoop

    provider = SimpleNamespace(tool_call=AsyncMock(return_value=ChatResponse(
        content="Hello.",
        model="gemini-3-flash-preview",
        provider="google",
        usage=None,
        finish_reason="stop",
    )))
    candidate = RouteCandidate(
        provider_id="google",
        model_id="gemini-3-flash-preview",
        key_slot=1,
        score=1,
        fallback_available=False,
    )

    class Fallback:
        async def execute_with_fallback(self, call, _requirements, context):
            return await call(candidate, context)

    tool_registry = SimpleNamespace(get_tool_schemas=lambda: [{
        "name": "lookup",
        "description": "Look something up.",
        "parameters": {"type": "object", "properties": {}},
    }])
    key_manager = SimpleNamespace(get_key=lambda provider_id, slot: "test-key")
    event_bus = SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=SimpleNamespace(get_provider=lambda _provider: provider),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=tool_registry,
        key_manager=key_manager,
        event_bus=event_bus,
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(requirements=TaskRequirements())
        ),
    )

    response = asyncio.run(loop.execute([ChatMessage(role="user", content="Hi")]))

    assert response.content == "Hello."
    assert provider.tool_call.await_args.kwargs == {"api_key": "test-key"}
    assert provider.tool_call.await_args.args[1][0]["name"] == "lookup"


def test_react_loop_keeps_execution_model_exclusions_between_tool_iterations():
    from services.agent.core.react_loop import ReActLoop

    candidate = RouteCandidate(
        provider_id="google",
        model_id="gemini-3.5-flash-lite",
        key_slot=0,
        score=1,
        fallback_available=False,
    )
    function_response = ToolCallResponse(
        tool_calls=[ToolCall(id="lookup", name="lookup", arguments={})],
        content="",
        model=candidate.model_id,
        provider=candidate.provider_id,
    )
    final_response = ChatResponse(
        content="Done.",
        model=candidate.model_id,
        provider=candidate.provider_id,
        usage=None,
        finish_reason="stop",
    )
    provider = SimpleNamespace(
        tool_call=AsyncMock(side_effect=[function_response, final_response])
    )
    context_ids = []

    class Fallback:
        async def execute_with_fallback(self, call, _requirements, context):
            context_ids.append(id(context))
            if len(context_ids) == 1:
                context["_execution_failed_models"].add(
                    ("google", "gemini-3-flash-preview")
                )
            else:
                assert ("google", "gemini-3-flash-preview") in context[
                    "_execution_failed_models"
                ]
            return await call(candidate, context)

    class Tool:
        requires_confirmation = False

        def validate_params(self, _arguments):
            return True

        async def execute(self, _arguments):
            return SimpleNamespace(success=True, output="ok", error=None)

    tool_registry = SimpleNamespace(
        get_tool_schemas=lambda: [{
            "name": "lookup",
            "description": "Look something up.",
            "parameters": {"type": "object", "properties": {}},
        }],
        get_tool=lambda _name: Tool(),
    )
    loop = ReActLoop(
        provider_registry=SimpleNamespace(get_provider=lambda _provider: provider),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=tool_registry,
        key_manager=SimpleNamespace(get_key=lambda _provider, _slot: "test-key"),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(
                requirements=TaskRequirements()
            )
        ),
    )

    response = asyncio.run(
        loop.execute([ChatMessage(role="user", content="Do the lookup.")])
    )

    assert response.content == "Done."
    assert len(context_ids) == 2
    assert len(set(context_ids)) == 1
    assert provider.tool_call.await_count == 2


def test_react_loop_preserves_google_thought_signature_after_tool_execution():
    from google.genai import types
    from services.agent.core.react_loop import ReActLoop

    native_content = types.Content(
        role="model",
        parts=[
            types.Part(
                function_call=types.FunctionCall(
                    name="lookup",
                    args={"query": "weather"},
                ),
                thought_signature=b"thought-signature",
            )
        ],
    )

    class Tool:
        name = "lookup"
        requires_confirmation = False

        def validate_params(self, _arguments):
            return True

        async def execute(self, _arguments):
            return SimpleNamespace(success=True, output="sunny", error=None)

    class ToolRegistry:
        def get_tool_schemas(self):
            return [{
                "name": "lookup",
                "description": "Look up weather.",
                "parameters": {"type": "object", "properties": {}},
            }]

        def get_tool(self, name):
            return Tool() if name == "lookup" else None

    candidate = RouteCandidate(
        provider_id="google",
        model_id="gemini-3-flash-preview",
        key_slot=0,
        score=1,
        fallback_available=False,
    )

    class Fallback:
        async def execute_with_fallback(self, call, _requirements, context):
            return await call(candidate, context)

    async def tool_call(messages, _tools, _model, **_kwargs):
        if not any(message.role == "tool" for message in messages):
            return ToolCallResponse(
                tool_calls=[
                    ToolCall(
                        id="lookup",
                        name="lookup",
                        arguments={"query": "weather"},
                    )
                ],
                content="",
                model="gemini-3-flash-preview",
                provider="google",
                provider_data=native_content,
            )
        contents = GoogleProvider()._convert_messages(messages)
        assert contents[1] == native_content
        assert contents[1].parts[0].thought_signature == b"thought-signature"
        return ToolCallResponse(
            tool_calls=[],
            content="It is sunny.",
            model="gemini-3-flash-preview",
            provider="google",
        )

    provider = SimpleNamespace(tool_call=AsyncMock(side_effect=tool_call))
    loop = ReActLoop(
        provider_registry=SimpleNamespace(get_provider=lambda _provider: provider),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=ToolRegistry(),
        key_manager=SimpleNamespace(get_key=lambda _provider, _slot: "test-key"),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(
                requirements=TaskRequirements()
            )
        ),
    )

    result = asyncio.run(
        loop.execute([ChatMessage(role="user", content="What is the weather?")])
    )

    assert result.content == "It is sunny."
    assert provider.tool_call.await_count == 2


def test_tool_confirmation_is_required_and_resolved_by_request_id():
    from services.agent.core.react_loop import ReActLoop

    class ConfirmingEventBus:
        def __init__(self):
            self.handlers = {}
            self.confirmation_payload = None
            self.events = []

        async def subscribe(self, event, handler):
            self.handlers[event] = handler

        async def publish(self, event, payload):
            self.events.append((event, payload))
            if event == "WAIT_CONFIRMATION":
                self.confirmation_payload = payload
                await self.handlers["CONFIRMATION_GRANTED"](
                    "CONFIRMATION_GRANTED",
                    {"request_id": payload["id"]},
                )

    event_bus = ConfirmingEventBus()
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=None,
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
    )
    tool = SimpleNamespace(
        name="shell_tool",
        permission_level="EXECUTE",
    )

    async def request_confirmation():
        await loop._ensure_confirmation_subscriptions()
        return await loop._request_tool_confirmation(
            tool,
            {"command": "echo hello"},
            "task-1",
        )

    assert asyncio.run(request_confirmation()) is True
    assert event_bus.confirmation_payload["task_id"] == "task-1"
    assert event_bus.confirmation_payload["action"] == "shell_tool"
    assert event_bus.confirmation_payload["level"] == "EXECUTE"
    assert loop._pending_confirmations == {}
    assert event_bus.events[-1][0] == "CONFIRMATION_RESOLVED"


def test_text_chat_uses_conversation_loop_and_returns_renderable_message():
    event_bus = SimpleNamespace(publish=AsyncMock())
    task_manager = SimpleNamespace(update_status=AsyncMock())
    react_loop = SimpleNamespace(execute=AsyncMock(return_value=ChatResponse(
        content="Hola.",
        model="claude-sonnet-5-5",
        provider="anthropic",
        usage=None,
        finish_reason="stop",
    )))
    planner = SimpleNamespace(create_plan=AsyncMock())
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    history = [
        {"role": "user", "content": "Hola."},
        {"role": "assistant", "content": "Hola, ¿en qué ayudo?"},
        {"role": "user", "content": "Busca un archivo."},
    ]
    asyncio.run(orchestrator.execute_task(
        "task-1",
        "Busca un archivo.",
        {
            "input_source": "text",
            "conversation_id": "conversation-1",
            "conversation_history": history,
        },
    ))

    planner.create_plan.assert_not_awaited()
    messages = react_loop.execute.await_args.args[0]
    assert messages[0].role == "system"
    assert messages[-3:] == [
        ChatMessage(role="user", content="Hola."),
        ChatMessage(role="assistant", content="Hola, ¿en qué ayudo?"),
        ChatMessage(role="user", content="Busca un archivo."),
    ]
    assert task_manager.update_status.await_args_list == [
        (( "task-1", TaskStatus.RUNNING),),
        (( "task-1", TaskStatus.COMPLETED),),
    ]
    message_events = [
        call.args for call in event_bus.publish.await_args_list
        if call.args[0] == "AGENT_MESSAGE"
    ]
    assert message_events[0][1]["role"] == "assistant"
    assert message_events[0][1]["content"] == "Hola."
    assert message_events[0][1]["model"] == "claude-sonnet-5-5"


def test_text_chat_surfaces_provider_failure_instead_of_marking_task_complete():
    event_bus = SimpleNamespace(publish=AsyncMock())
    task_manager = SimpleNamespace(update_status=AsyncMock())
    react_loop = SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError("provider unavailable")))
    orchestrator = Orchestrator(
        planner=SimpleNamespace(create_plan=AsyncMock()),
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    asyncio.run(orchestrator.execute_task("task-2", "Hola.", {"input_source": "text"}))

    assert task_manager.update_status.await_args_list[-1].args == (
        "task-2",
        TaskStatus.FAILED,
    )
    assert any(
        call.args[0] == "AGENT_MESSAGE"
        and call.args[1]["role"] == "assistant"
        and "No pude completar" in call.args[1]["content"]
        for call in event_bus.publish.await_args_list
    )
