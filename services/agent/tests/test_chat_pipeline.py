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
from services.agent.core.orchestrator import (
    Orchestrator,
    _compact_conversation_history,
    _fast_os_answer,
)
from services.agent.core.runtime_context import describe_runtime_os
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


def test_shell_output_is_truncated_before_being_added_to_model_history():
    from services.agent.core.react_loop import _SHELL_OUTPUT_LIMIT, _model_tool_output
    from services.agent.tools.shell_tool import ShellResult

    output = ShellResult(
        stdout="x" * 5000,
        stderr="",
        exit_code=0,
        execution_time_ms=1,
    )

    serialized = _model_tool_output("powershell_tool", output)

    assert len(serialized) == _SHELL_OUTPUT_LIMIT
    assert serialized.endswith("[... Output truncated ...]")


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
    assert "Runtime OS:" in messages[0].content
    assert "one direct tool action" in messages[0].content
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


def test_long_conversation_history_is_compacted_without_losing_current_request():
    history = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"Turn {index}: " + ("context " * 100),
        }
        for index in range(12)
    ]
    history.append({"role": "user", "content": "Current request must stay exact."})

    compacted, summary = _compact_conversation_history(history, turn_limit=3)

    assert compacted[-1] == history[-1]
    assert len(compacted) < len(history)
    assert summary.startswith("Earlier conversation, compact extract")
    assert len(compacted) == 6
    assert len(summary) <= 900


def test_disabled_auto_compaction_slides_window_without_summary():
    history = [
        {"role": "user", "content": f"request {index}"}
        for index in range(8)
    ]

    compacted, summary = _compact_conversation_history(
        history,
        turn_limit=2,
        auto_compaction=False,
    )

    assert compacted == history[-4:]
    assert summary == ""


def test_operating_system_question_is_answered_locally_without_model_call():
    events = []

    async def publish(event_name, payload):
        events.append((event_name, payload))

    task_manager = SimpleNamespace(
        update_status=AsyncMock(),
        set_result=AsyncMock(),
    )
    react_loop = SimpleNamespace(execute=AsyncMock())
    orchestrator = Orchestrator(
        planner=SimpleNamespace(create_plan=AsyncMock()),
        task_manager=task_manager,
        event_bus=SimpleNamespace(publish=publish),
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    asyncio.run(
        orchestrator.execute_task(
            "task-os",
            "¿Qué sistema operativo está ejecutando HELIX?",
            {"input_source": "text", "conversation_id": "conversation-os"},
        )
    )

    react_loop.execute.assert_not_awaited()
    task_manager.update_status.assert_awaited_with("task-os", TaskStatus.COMPLETED)
    response = next(payload for event, payload in events if event == "AGENT_MESSAGE")
    assert response["provider"] == "local"
    assert describe_runtime_os() in response["content"]
    assert any(event == "ORCHESTRATION_COMPLETED" for event, _payload in events)


def test_os_fast_path_only_handles_questions_about_the_current_runtime():
    assert _fast_os_answer("What OS is HELIX running on?")
    assert _fast_os_answer("¿Qué sistema operativo usa este equipo?")
    assert _fast_os_answer("What is my operating system?")
    assert _fast_os_answer("Which OS should I use for this project?") is None


def test_explicit_skill_mention_adds_only_requested_skill_context():
    from services.agent.skills.skill_loader import SkillDefinition

    skill = SkillDefinition(
        name="coding",
        description="Help with code",
        version="1.0.0",
        triggers=["code", "fix"],
        tools=["execute_code"],
        instructions="Follow the coding workflow.",
    )
    orchestrator = SimpleNamespace(execute_task=AsyncMock())
    agent = Agent.__new__(Agent)
    agent.intent_matcher = SimpleNamespace(
        match=lambda _text: (_ for _ in ()).throw(AssertionError("Auto-match called"))
    )
    agent.skill_registry = SimpleNamespace(
        get_skill=lambda name: skill if name == "coding" else None,
        get_all_skills=lambda: [skill],
    )
    agent.task_manager = SimpleNamespace(create_task=AsyncMock())
    agent.orchestrator = orchestrator
    agent.state_manager = StateManager()

    async def send_text():
        await agent.handle_user_input(
            "USER_TEXT",
            {"text": "@coding fix the parser"},
        )
        await asyncio.sleep(0)

    asyncio.run(send_text())

    context = orchestrator.execute_task.await_args.kwargs["context"]
    assert context["requested_skills"] == ["coding"]
    assert context["requested_skill_tools"] == ["execute_code"]
    assert "Follow the coding workflow." in context["requested_skill_instructions"]


def test_agent_automatically_selects_a_unique_matching_skill():
    from services.agent.skills.intent_matcher import SkillMatch
    from services.agent.skills.skill_loader import SkillDefinition

    skill = SkillDefinition(
        name="coding",
        description="Help with code",
        version="1.0.0",
        triggers=["debug", "fix bug"],
        tools=["execute_code"],
        instructions="Follow the coding workflow.",
    )
    matcher = SimpleNamespace(match=lambda text: [
        SkillMatch(
            skill=skill,
            confidence=0.3,
            matched_triggers=["debug"],
            reasoning="Matched keywords: debug",
        )
    ])
    orchestrator = SimpleNamespace(execute_task=AsyncMock())
    agent = Agent.__new__(Agent)
    agent.intent_matcher = matcher
    agent.skill_registry = SimpleNamespace(
        get_skill=lambda name: skill if name == "coding" else None,
        get_all_skills=lambda: [skill],
    )
    agent.task_manager = SimpleNamespace(create_task=AsyncMock())
    agent.orchestrator = orchestrator
    agent.state_manager = StateManager()

    async def send_text():
        await agent.handle_user_input(
            "USER_TEXT",
            {"text": "Please debug this"},
        )
        await asyncio.sleep(0)

    asyncio.run(send_text())

    context = orchestrator.execute_task.await_args.kwargs["context"]
    assert context["requested_skills"] == ["coding"]
    assert context["requested_skill_tools"] == ["execute_code"]
    assert "Follow the coding workflow." in context["requested_skill_instructions"]


def test_automatic_skill_selection_skips_ambiguous_matches():
    from services.agent.skills.intent_matcher import SkillMatch
    from services.agent.skills.skill_loader import SkillDefinition

    skills = [
        SkillDefinition(
            name=name,
            description=name,
            version="1.0.0",
            triggers=["search"],
            tools=[],
            instructions=f"{name} instructions",
        )
        for name in ("research", "browser")
    ]
    matches = [
        SkillMatch(skill, 0.3, ["search"], "Matched keywords: search")
        for skill in skills
    ]
    agent = Agent.__new__(Agent)
    agent.intent_matcher = SimpleNamespace(match=lambda _text: matches)
    agent.skill_registry = SimpleNamespace(
        get_skill=lambda _name: None,
        get_all_skills=lambda: skills,
    )
    agent.orchestrator = SimpleNamespace(execute_task=AsyncMock())
    agent.task_manager = SimpleNamespace(create_task=AsyncMock())
    agent.state_manager = StateManager()

    async def send_text():
        await agent.handle_user_input("USER_TEXT", {"text": "search"})
        await asyncio.sleep(0)

    asyncio.run(send_text())

    context = agent.orchestrator.execute_task.await_args.kwargs["context"]
    assert "requested_skills" not in context


def test_explicit_mcp_server_mention_prioritizes_its_tools():
    mcp_tool = SimpleNamespace(name="github_search_issues", server_name="github")
    other_tool = SimpleNamespace(name="filesystem_search", server_name="files")
    tool_registry = SimpleNamespace(
        get_tools_by_source=lambda source: [mcp_tool, other_tool] if source == "mcp" else [],
    )
    agent = Agent.__new__(Agent)
    agent.skill_registry = None
    agent.orchestrator = SimpleNamespace(
        execute_task=AsyncMock(),
        tool_registry=tool_registry,
    )
    agent.task_manager = SimpleNamespace(create_task=AsyncMock())
    agent.state_manager = StateManager()

    async def send_text():
        await agent.handle_user_input(
            "USER_TEXT",
            {"text": "/github search for the issue"},
        )
        await asyncio.sleep(0)

    asyncio.run(send_text())

    context = agent.orchestrator.execute_task.await_args.kwargs["context"]
    assert context["requested_mcp_servers"] == ["github"]
    assert context["requested_skill_tools"] == ["github_search_issues"]
    assert "Prefer their tools" in context["requested_mcp_instructions"]


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
