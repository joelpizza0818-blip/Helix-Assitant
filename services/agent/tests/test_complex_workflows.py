import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.agent.core.orchestrator import (
    Orchestrator,
    _resolve_plan_value,
)
from services.agent.core.planner import Plan, PlanStep, Planner
from services.agent.core.react_loop import ReActLoop


def _tool_schema(name):
    return {"name": name, "description": name, "parameters": {"type": "object"}}


@pytest.mark.parametrize(
    "steps, message",
    [
        (
            [
                {"id": "a", "action": "tool_a", "params": {}, "dependencies": ["b"]},
                {"id": "b", "action": "tool_b", "params": {}, "dependencies": ["a"]},
            ],
            "cycle",
        ),
        (
            [
                {"id": "a", "action": "missing_tool", "params": {}, "dependencies": []},
            ],
            "unavailable tool",
        ),
        (
            [
                {"id": "a", "action": "tool_a", "params": {}, "dependencies": ["missing"]},
            ],
            "unknown steps",
        ),
    ],
)
def test_planner_rejects_invalid_workflow_plans(steps, message):
    with pytest.raises(ValueError, match=message):
        Planner._validate_plan(
            {"steps": steps},
            [_tool_schema("tool_a"), _tool_schema("tool_b")],
        )


def test_planner_accepts_empty_plan_for_normal_conversation():
    plan = Planner._validate_plan({"steps": []}, [_tool_schema("tool_a")])

    assert plan.steps == []


def test_planner_disables_tool_calls_and_rejects_tool_call_responses():
    react_loop = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(
            content='{"steps": []}',
            tool_calls=[SimpleNamespace(name="tool_a")],
        ))
    )
    planner = Planner(
        react_loop,
        role_config=None,
        tool_registry=SimpleNamespace(
            get_tool_schemas=lambda: [_tool_schema("tool_a")],
            get_tool=lambda _name: None,
        ),
    )

    with pytest.raises(ValueError, match="requested tool calls"):
        asyncio.run(planner.create_plan("Do something", {}))

    assert react_loop.execute.await_args.kwargs["allow_tool_calls"] is False


def test_react_loop_rejects_unexpected_tool_calls_when_disabled():
    from services.agent.ai.base_provider import ChatMessage, ToolCall, ToolCallResponse
    from services.agent.ai.model_router import RouteCandidate, TaskRequirements

    candidate = RouteCandidate(
        provider_id="test",
        model_id="test-model",
        key_slot=0,
        score=1,
        fallback_available=False,
    )
    provider = SimpleNamespace(
        chat=AsyncMock(return_value=ToolCallResponse(
            tool_calls=[ToolCall(id="call-1", name="tool_a", arguments={})],
            content="",
            model="test-model",
            provider="test",
        ))
    )

    class Fallback:
        async def execute_with_fallback(self, call, requirements, context):
            return await call(candidate, context)

    tool = SimpleNamespace(
        execute=AsyncMock(),
        validate_params=lambda _arguments: True,
    )
    loop = ReActLoop(
        provider_registry=SimpleNamespace(get_provider=lambda _provider: provider),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=SimpleNamespace(
            get_tool_schemas=lambda: [_tool_schema("tool_a")],
            get_tool=lambda _name: tool,
        ),
        key_manager=SimpleNamespace(get_key=lambda _provider, _slot: "test-key"),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(
                requirements=TaskRequirements()
            )
        ),
    )

    with pytest.raises(RuntimeError, match="tool calling was disabled"):
        asyncio.run(loop.execute(
            [ChatMessage(role="user", content="Plan this")],
            role="planning",
            max_iterations=1,
            allow_tool_calls=False,
        ))

        provider.chat.assert_awaited_once()
        tool.execute.assert_not_awaited()


def test_planner_requires_result_sources_to_be_declared_dependencies():
    with pytest.raises(ValueError, match="without declaring it as a dependency"):
        Planner._validate_plan(
            {
                "steps": [
                    {
                        "id": "first",
                        "action": "tool_a",
                        "params": {},
                        "dependencies": [],
                    },
                    {
                        "id": "second",
                        "action": "tool_b",
                        "params": {
                            "path": {"$from_step": "first", "path": ["path"]}
                        },
                        "dependencies": [],
                    },
                ]
            },
            [_tool_schema("tool_a"), _tool_schema("tool_b")],
        )


def test_plan_values_resolve_dependency_outputs_without_guessing():
    value = {
        "source": {"$from_step": "discover", "path": ["files", 0, "path"]},
        "fixed": "archive",
    }

    assert _resolve_plan_value(
        value,
        {"discover": {"files": [{"path": "C:\\data\\report.pdf"}]}},
    ) == {
        "source": "C:\\data\\report.pdf",
        "fixed": "archive",
    }
    with pytest.raises(ValueError, match="did not return the requested value"):
        _resolve_plan_value(
            {"source": {"$from_step": "discover", "path": ["missing"]}},
            {"discover": {}},
        )


def test_workflow_executes_dependencies_and_passes_real_results():
    first = PlanStep("find", "find_files", {"folder": "C:\\data"}, [])
    second = PlanStep(
        "archive",
        "archive_file",
        {"path": {"$from_step": "find", "path": ["path"]}},
        ["find"],
    )
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(
                success=True,
                output='{"path": "C:\\\\data\\\\report.pdf"}',
                raw_output={"path": "C:\\data\\report.pdf"},
            ),
            SimpleNamespace(
                success=True,
                output="Archived",
                raw_output="Archived",
            ),
        ])
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-1",
        Plan([first, second]),
        screen_request_active=False,
    ))

    assert result["status"] == "completed"
    assert [
        call.args[0]
        for call in react_loop.execute_planned_tool.await_args_list
    ] == ["find_files", "archive_file"]
    assert react_loop.execute_planned_tool.await_args_list[1].args[1] == {
        "path": "C:\\data\\report.pdf"
    }


def test_failed_workflow_step_skips_dependents_and_runs_independent_steps():
    failed = PlanStep("first", "write_file", {}, [])
    dependent = PlanStep("dependent", "send_file", {}, ["first"])
    independent = PlanStep("independent", "list_files", {}, [])
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(
                success=False,
                output="Error: write failed",
                raw_output=None,
            ),
            SimpleNamespace(
                success=True,
                output="Listed",
                raw_output=["report.pdf"],
            ),
        ])
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-2",
        Plan([failed, dependent, independent]),
        screen_request_active=False,
    ))

    assert result["status"] == "failed"
    assert result["steps"]["dependent"]["status"] == "skipped"
    assert result["steps"]["independent"]["status"] == "completed"
    assert react_loop.execute_planned_tool.await_count == 2


def test_orchestrator_rejects_concurrent_duplicate_task_execution():
    started = asyncio.Event()
    release = asyncio.Event()

    async def execute_once(*_args, **_kwargs):
        started.set()
        await release.wait()
        return {"status": "completed"}

    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(
            is_cancelled=AsyncMock(return_value=False),
            get_task=AsyncMock(return_value=None),
        ),
        event_bus=None,
        react_loop=None,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )
    orchestrator._execute_task = AsyncMock(side_effect=execute_once)

    async def run():
        first = asyncio.create_task(orchestrator.execute_task(
            "task-once",
            "Perform one action",
        ))
        await started.wait()
        duplicate = await orchestrator.execute_task(
            "task-once",
            "Perform the same action again",
        )
        release.set()
        return await first, duplicate

    first, duplicate = asyncio.run(run())

    assert first["status"] == "completed"
    assert duplicate == {"status": "already_running", "task_id": "task-once"}
    orchestrator._execute_task.assert_awaited_once()


def test_enabled_workflow_setting_uses_planner_for_conversation_request():
    plan = Plan([
        PlanStep("one", "find_files", {"folder": "C:\\data"}, []),
        PlanStep(
            "two",
            "archive_file",
            {"path": {"$from_step": "one", "path": ["path"]}},
            ["one"],
        ),
    ])
    planner = SimpleNamespace(create_plan=AsyncMock(return_value=plan))
    react_loop = SimpleNamespace(
        complex_workflows_enabled=True,
        on_demand_screen_context_enabled=False,
        continuous_screen_vision_enabled=False,
        model_decides_screen_vision_enabled=False,
        execute=AsyncMock(),
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(
                success=True,
                output='{"path": "C:\\\\data\\\\report.pdf"}',
                raw_output={"path": "C:\\data\\report.pdf"},
            ),
            SimpleNamespace(success=True, output="Archived", raw_output="Archived"),
        ]),
    )
    task_manager = SimpleNamespace(
        update_status=AsyncMock(),
        set_result=AsyncMock(),
        is_cancelled=AsyncMock(return_value=False),
    )
    event_bus = SimpleNamespace(publish=AsyncMock())
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: None),
        role_config=None,
    )

    result = asyncio.run(orchestrator.execute_task(
        "task-3",
        "Find a report in C:\\data and archive it.",
        {"input_source": "text"},
    ))

    assert result["status"] == "completed"
    planner.create_plan.assert_awaited_once()
    react_loop.execute.assert_not_awaited()
    assert react_loop.execute_planned_tool.await_count == 2


def test_disabled_workflow_setting_skips_planner():
    planner = SimpleNamespace(create_plan=AsyncMock())
    react_loop = SimpleNamespace(
        complex_workflows_enabled=False,
        on_demand_screen_context_enabled=False,
        continuous_screen_vision_enabled=False,
        model_decides_screen_vision_enabled=False,
        execute=AsyncMock(return_value=SimpleNamespace(
            content="Normal reply",
            model="mock-model",
            provider="mock-provider",
        )),
    )
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=SimpleNamespace(
            update_status=AsyncMock(),
            set_result=AsyncMock(),
            is_cancelled=AsyncMock(return_value=False),
        ),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: None),
        role_config=None,
    )

    asyncio.run(orchestrator.execute_task(
        "task-4",
        "Tell me a short joke.",
        {"input_source": "text"},
    ))

    planner.create_plan.assert_not_awaited()
    react_loop.execute.assert_awaited_once()


def test_planned_high_risk_tool_still_requires_confirmation():
    tool = SimpleNamespace(
        name="delete_file",
        permission_level="EXECUTE",
        requires_confirmation=False,
        validate_params=lambda _arguments: True,
        execute=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="deleted",
            error=None,
        )),
    )
    event_bus = SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: tool),
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
    )
    loop._request_tool_confirmation = AsyncMock(return_value=False)

    outcome = asyncio.run(loop.execute_planned_tool(
        "delete_file",
        {"path": "C:\\data\\report.pdf"},
        task_id="task-5",
    ))

    assert not outcome.success
    assert "confirmation was rejected" in outcome.output
    loop._request_tool_confirmation.assert_awaited_once()
    tool.execute.assert_not_awaited()


@pytest.mark.parametrize(
    ("decision", "verification", "expected_success", "expected_status"),
    [
        ("SKIP", None, True, "not_required"),
        ("MAYBE", None, False, "decision_error"),
        ("VERIFY", "VERIFIED", True, "verified"),
        ("VERIFY", "NOT_VERIFIED", False, "not_verified"),
    ],
)
def test_model_decides_whether_tool_results_need_verification(
    decision,
    verification,
    expected_success,
    expected_status,
):
    from services.agent.core.react_loop import _ToolExecutionOutcome

    responses = [SimpleNamespace(content=decision)]
    if verification:
        responses.append(SimpleNamespace(content=verification))
    loop = ReActLoop.__new__(ReActLoop)
    loop.execute = AsyncMock(side_effect=responses)
    outcome = _ToolExecutionOutcome(
        success=True,
        output="Saved report.",
        raw_output={"saved": True},
        execution_succeeded=True,
    )

    result = asyncio.run(loop._verify_if_important(
        "Save the report.",
        SimpleNamespace(
            name="filesystem_tool",
            arguments={"operation": "write_file", "path": "C:\\data\\report.txt"},
        ),
        outcome,
        task_id="task-verify",
        screen_request_active=False,
        vision_model_to_exclude=None,
    ))

    assert result.success is expected_success
    assert result.verification_status == expected_status
    assert all(
        call.kwargs["allow_tool_calls"] is False
        for call in loop.execute.await_args_list
    )
    if not expected_success:
        assert result.execution_succeeded is True
        assert result.raw_output is None
        assert "Do not repeat it automatically" in result.output


@pytest.mark.parametrize(
    ("tool_calls", "expected_executions"),
    [
        (
            [
                SimpleNamespace(id="same-id", name="lookup", arguments={}),
                SimpleNamespace(id="same-id", name="lookup", arguments={}),
            ],
            1,
        ),
        (
            [SimpleNamespace(id="call-1", name="hidden_tool", arguments={})],
            0,
        ),
    ],
    ids=["duplicate-call-id", "tool-not-offered"],
)
def test_react_loop_blocks_duplicate_and_unoffered_tool_calls(
    tool_calls,
    expected_executions,
):
    from services.agent.ai.base_provider import (
        ChatMessage,
        ChatResponse,
        ToolCallResponse,
    )
    from services.agent.ai.model_router import TaskRequirements

    tool = SimpleNamespace(
        name="lookup",
        permission_level="READ_ONLY",
        requires_confirmation=False,
        validate_params=lambda _arguments: True,
        execute=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="Found it.",
            error=None,
        )),
    )
    provider = SimpleNamespace(
        tool_call=AsyncMock(side_effect=[
            ToolCallResponse(
                tool_calls=tool_calls,
                content="",
                model="test-model",
                provider="test",
            ),
            ChatResponse(
                content="Done.",
                model="test-model",
                provider="test",
                usage=None,
                finish_reason="stop",
            ),
        ])
    )

    class Fallback:
        async def execute_with_fallback(self, call, requirements, context):
            return await call(
                SimpleNamespace(
                    provider_id="test",
                    model_id="test-model",
                    key_slot=0,
                ),
                context,
            )

    events = []

    async def publish(event, payload):
        events.append((event, payload))

    loop = ReActLoop(
        provider_registry=SimpleNamespace(
            get_provider=lambda _provider: provider
        ),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=SimpleNamespace(
            get_tool_schemas=lambda: [_tool_schema("lookup")],
            get_tool=lambda _name: tool,
        ),
        key_manager=SimpleNamespace(get_key=lambda _provider, _slot: "test-key"),
        event_bus=SimpleNamespace(publish=publish),
        role_config=SimpleNamespace(
            get_assignment=lambda _role: SimpleNamespace(
                requirements=TaskRequirements()
            )
        ),
    )
    loop._verify_if_important = AsyncMock(
        side_effect=lambda _description, _tool_call, outcome, **_kwargs: outcome
    )

    asyncio.run(loop.execute(
        [ChatMessage(role="user", content="Look up the requested item.")],
        task_id="task-dedup",
    ))

    assert tool.execute.await_count == expected_executions
    outcomes = [payload for event, payload in events if event == "TOOL_EXECUTED"]
    assert len(outcomes) == len(tool_calls)
    if expected_executions == 0:
        assert outcomes[0]["execution_succeeded"] is False
    else:
        assert outcomes[0]["execution_succeeded"] is True
        assert outcomes[1]["execution_succeeded"] is False


@pytest.mark.parametrize(
    "verification_text, expected_status",
    [("VERIFIED.", "completed"), ("NOT_VERIFIED", "failed")],
)
def test_desktop_workflow_actions_require_visual_verification(
    verification_text,
    expected_status,
):
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="Clicked Save",
            raw_output={"clicked": "Save"},
            image_bytes=b"post-action-frame",
        )),
        execute=AsyncMock(return_value=SimpleNamespace(content=verification_text)),
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-6",
        Plan([PlanStep("click", "computer.click_element", {"description": "Save"}, [])]),
        screen_request_active=True,
    ))

    assert result["status"] == expected_status
    react_loop.execute.assert_awaited_once()
    assert react_loop.execute.await_args.kwargs["allow_tool_calls"] is False
    image_message = react_loop.execute.await_args.args[0][1]
    assert image_message.image_bytes == b"post-action-frame"
