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
from services.agent.core.task_manager import TaskStatus


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


def test_workflow_condition_skips_unselected_branch_without_failing():
    plan = Plan([
        PlanStep("trigger", "__workflow_trigger__", {"input": "hello"}, []),
        PlanStep(
            "condition",
            "__workflow_condition__",
            {"source": "trigger", "operator": "truthy"},
            ["trigger"],
        ),
        PlanStep(
            "true-output",
            "__workflow_output__",
            {"value": "selected"},
            ["condition"],
            when=[{"source": "condition", "value": True}],
        ),
        PlanStep(
            "false-output",
            "__workflow_output__",
            {"value": "not selected"},
            ["condition"],
            when=[{"source": "condition", "value": False}],
        ),
    ])
    task_manager = SimpleNamespace(
        is_cancelled=AsyncMock(return_value=False),
        update_progress=AsyncMock(),
        set_progress_label=AsyncMock(),
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=None,
        react_loop=None,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-condition",
        plan,
        screen_request_active=False,
    ))

    assert result["status"] == "completed"
    assert result["steps"]["true-output"]["status"] == "completed"
    assert result["steps"]["false-output"]["status"] == "skipped"
    assert task_manager.update_progress.await_args_list[-1].args == ("task-condition", 100)


def test_saved_workflow_task_publishes_output_to_chat():
    events = []

    async def publish(event_name, payload):
        events.append((event_name, payload))

    task_manager = SimpleNamespace(
        is_cancelled=AsyncMock(return_value=False),
        get_task=AsyncMock(return_value=None),
        update_status=AsyncMock(),
        set_result=AsyncMock(),
    )
    store = SimpleNamespace(
        to_plan=lambda _workflow, input_text: Plan([
            PlanStep("trigger", "__workflow_trigger__", {"input": input_text}, []),
            PlanStep("output", "__workflow_output__", {"value": "Workflow result"}, ["trigger"]),
        ])
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=SimpleNamespace(publish=publish),
        react_loop=None,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        workflow_store=store,
    )

    result = asyncio.run(orchestrator.execute_task(
        "task-saved-workflow",
        "Run summary",
        {
            "workflow_definition": {"id": "summary", "name": "Summary"},
            "workflow_id": "summary",
            "workflow_input": "Document text",
            "conversation_id": "conversation-1",
        },
    ))

    assert result["status"] == "completed"
    response = next(payload for event, payload in events if event == "AGENT_MESSAGE")
    assert response["content"].endswith("Workflow result")
    assert response["conversation_id"] == "conversation-1"
    task_manager.update_status.assert_awaited_with("task-saved-workflow", TaskStatus.COMPLETED)


def test_saved_workflow_exception_publishes_safe_chat_failure():
    events = []

    async def publish(event_name, payload):
        events.append((event_name, payload))

    task_manager = SimpleNamespace(
        is_cancelled=AsyncMock(return_value=False),
        get_task=AsyncMock(return_value=None),
        update_status=AsyncMock(),
        set_result=AsyncMock(),
    )

    def fail_to_build_plan(*_args, **_kwargs):
        raise RuntimeError("internal workflow details")

    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=SimpleNamespace(publish=publish),
        react_loop=None,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        workflow_store=SimpleNamespace(to_plan=fail_to_build_plan),
    )

    result = asyncio.run(orchestrator.execute_task(
        "task-workflow-failure",
        "Run summary",
        {
            "workflow_definition": {"id": "summary", "name": "Summary"},
            "workflow_id": "summary",
            "conversation_id": "conversation-1",
        },
    ))
    message = next(
        payload
        for event, payload in events
        if event == "AGENT_MESSAGE"
    )

    assert result["status"] == "failed"
    assert task_manager.update_status.await_args_list[-1].args == (
        "task-workflow-failure",
        TaskStatus.FAILED,
    )
    assert message["conversation_id"] == "conversation-1"
    assert "internal workflow details" not in message["content"]


def test_workflow_resumes_from_encrypted_checkpoint_state():
    class CheckpointStore:
        def __init__(self):
            self.checkpoint = {
                "plan": [
                    {
                        "id": "find",
                        "action": "find_files",
                        "params": {},
                        "dependencies": [],
                    },
                    {
                        "id": "archive",
                        "action": "archive_file",
                        "params": {
                            "path": {"$from_step": "find", "path": ["path"]}
                        },
                        "dependencies": ["find"],
                    },
                ],
                "step_outputs": {
                    "find": {"path": "C:\\data\\report.pdf"},
                },
                "step_results": {
                    "find": {
                        "action": "find_files",
                        "status": "completed",
                        "output": "Found report",
                    },
                },
            }
            self.saved = []
            self.deleted = []

        def load(self, _task_id):
            return self.checkpoint

        def save(self, _task_id, checkpoint):
            self.saved.append(checkpoint.copy())

        def delete(self, task_id):
            self.deleted.append(task_id)

    checkpoint_store = CheckpointStore()
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="Archived",
            raw_output="Archived",
        ))
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-resume",
        Plan([PlanStep("new", "unused_tool", {}, [])]),
        screen_request_active=False,
    ))

    assert result["status"] == "completed"
    assert result["steps"]["find"]["status"] == "completed"
    assert result["steps"]["archive"]["status"] == "completed"
    assert react_loop.execute_planned_tool.await_count == 1
    assert react_loop.execute_planned_tool.await_args.args[0] == "archive_file"
    assert react_loop.execute_planned_tool.await_args.args[1] == {
        "path": "C:\\data\\report.pdf"
    }
    assert checkpoint_store.deleted == []


def test_recovery_does_not_repeat_an_action_interrupted_mid_execution():
    class CheckpointStore:
        def __init__(self):
            self.checkpoint = {
                "task_description": "Run an interrupted workflow",
                "screen_request_active": False,
                "plan": [
                    {
                        "id": "send",
                        "action": "send_email",
                        "params": {},
                        "dependencies": [],
                    },
                    {
                        "id": "follow-up",
                        "action": "write_log",
                        "params": {},
                        "dependencies": ["send"],
                    },
                    {
                        "id": "independent",
                        "action": "write_log",
                        "params": {},
                        "dependencies": [],
                    },
                ],
                "step_outputs": {},
                "step_results": {},
                "current_step": {"id": "send", "status": "running"},
            }
            self.saved = []

        def list_task_ids(self):
            return ["task-interrupted"]

        def load(self, _task_id):
            return self.checkpoint.copy()

        def save(self, _task_id, checkpoint):
            self.checkpoint = checkpoint.copy()
            self.saved.append(checkpoint.copy())

        def delete(self, _task_id):
            raise AssertionError("A failed recovery checkpoint must be retained.")

    checkpoint_store = CheckpointStore()
    event_bus = AsyncMock()
    from services.agent.core.task_manager import TaskManager

    task_manager = TaskManager(event_bus)
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="Logged",
            raw_output="Logged",
        ))
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )

    asyncio.run(orchestrator.recover_interrupted_workflows())

    assert react_loop.execute_planned_tool.await_count == 1
    assert react_loop.execute_planned_tool.await_args.args[0] == "write_log"
    assert checkpoint_store.checkpoint["step_results"]["send"]["status"] == "failed"
    assert checkpoint_store.checkpoint["step_results"]["follow-up"]["status"] == "skipped"
    task = asyncio.run(task_manager.get_task("task-interrupted"))
    assert task.status.value == "failed"
    assert "unknown" in task.result.lower()
    assert checkpoint_store.checkpoint["recovery_state"] == "needs_attention"
    assert (
        checkpoint_store.checkpoint["step_results"]["independent"]["status"]
        == "completed"
    )


def test_cancelled_workflow_checkpoint_is_deleted():
    class CheckpointStore:
        def __init__(self):
            self.deleted = []

        def delete(self, task_id):
            self.deleted.append(task_id)

    checkpoint_store = CheckpointStore()
    task_manager = SimpleNamespace(
        is_cancelled=AsyncMock(return_value=False),
        get_task=AsyncMock(return_value=None),
        update_status=AsyncMock(),
    )
    event_bus = SimpleNamespace(publish=AsyncMock())
    react_loop = SimpleNamespace(release_task_resources=AsyncMock())
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )
    orchestrator._execute_task = AsyncMock(
        return_value={"status": "cancelled", "task_id": "task-cancelled"}
    )

    result = asyncio.run(
        orchestrator.execute_task("task-cancelled", "Stop this workflow")
    )

    assert result["status"] == "cancelled"
    assert checkpoint_store.deleted == ["task-cancelled"]


def test_checkpoint_load_failure_is_visible_as_failed_recovery_task():
    class CheckpointStore:
        def list_task_ids(self):
            return ["task-corrupt"]

        def load(self, _task_id):
            raise RuntimeError("decryption details must not reach UI")

    from services.agent.core.task_manager import TaskManager

    event_bus = AsyncMock()
    task_manager = TaskManager(event_bus)
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=SimpleNamespace(),
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=CheckpointStore(),
    )

    asyncio.run(orchestrator.recover_interrupted_workflows())

    task = asyncio.run(task_manager.get_task("task-corrupt"))
    assert task.status.value == "failed"
    assert "safely restore" in task.result
    assert "decryption details" not in str(task)
    assert any(
        call.args[0] == "ORCHESTRATION_FAILED"
        and call.args[1]["task_id"] == "task-corrupt"
        for call in event_bus.publish.await_args_list
    )


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


def test_browser_visual_action_screenshot_reaches_next_model_turn():
    from services.agent.ai.base_provider import (
        ChatMessage,
        ChatResponse,
        ToolCallResponse,
    )
    from services.agent.ai.model_router import TaskRequirements

    screenshot = b"\xff\xd8visual-browser-frame"
    tool = SimpleNamespace(
        name="browser_control",
        permission_level="LOW_RISK",
        requires_confirmation=False,
        validate_params=lambda _arguments: True,
        execute=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output={
                "action": "click_at",
                "screenshot_bytes": screenshot,
                "mime_type": "image/jpeg",
            },
            error=None,
        )),
    )
    model_messages = []

    async def model_tool_call(messages, *_args, **_kwargs):
        model_messages.append(messages)
        if len(model_messages) == 1:
            return ToolCallResponse(
                tool_calls=[
                    SimpleNamespace(
                        id="visual-call-1",
                        name="browser_control",
                        arguments={"action": "click_at", "x": 20, "y": 30},
                    )
                ],
                content="",
                model="test-model",
                provider="test",
            )
        return ChatResponse(
            content="The page now shows the requested result.",
            model="test-model",
            provider="test",
            usage=None,
            finish_reason="stop",
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

    async def publish(_event, _payload):
        return None

    loop = ReActLoop(
        provider_registry=SimpleNamespace(
            get_provider=lambda _provider: SimpleNamespace(tool_call=model_tool_call)
        ),
        model_router=None,
        fallback_manager=Fallback(),
        tool_registry=SimpleNamespace(
            get_tool_schemas=lambda: [_tool_schema("browser_control")],
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

    asyncio.run(loop.execute(
        [ChatMessage(role="user", content="Click the visual-only button.")],
        task_id="browser-visual",
    ))

    assert tool.execute.await_count == 1
    assert len(model_messages) == 2
    image_message = next(
        message
        for message in model_messages[1]
        if getattr(message, "image_bytes", None) is not None
    )
    assert image_message.image_bytes == screenshot
    assert image_message.image_mime_type == "image/jpeg"
    assert "Screen captured after browser_control" in image_message.content


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


def test_recovery_resumes_interrupted_action_where_it_left_off():
    class CheckpointStore:
        def __init__(self):
            self.checkpoint = {
                "task_description": "Resume an interrupted workflow",
                "screen_request_active": False,
                "plan": [
                    {
                        "id": "find",
                        "action": "find_file",
                        "params": {},
                        "dependencies": [],
                    },
                    {
                        "id": "process",
                        "action": "process_file",
                        "params": {},
                        "dependencies": ["find"],
                    },
                    {
                        "id": "notify",
                        "action": "notify_user",
                        "params": {},
                        "dependencies": ["process"],
                    },
                ],
                "step_outputs": {
                    "find": {"path": "/data/doc.txt"},
                },
                "step_results": {
                    "find": {
                        "action": "find_file",
                        "status": "completed",
                        "output": "Found /data/doc.txt",
                    },
                },
                "current_step": {"id": "process", "status": "running"},
            }
            self.saved = []
            self.deleted = []

        def list_task_ids(self):
            return ["task-resume-test"]

        def load(self, _task_id):
            return self.checkpoint.copy()

        def save(self, _task_id, checkpoint):
            self.checkpoint = checkpoint.copy()
            self.saved.append(checkpoint.copy())

        def delete(self, task_id):
            self.deleted.append(task_id)

    checkpoint_store = CheckpointStore()
    event_bus = AsyncMock()
    from services.agent.core.task_manager import TaskManager

    task_manager = TaskManager(event_bus)
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(
                success=True,
                output="Processed /data/doc.txt",
                raw_output={"result": "ok"},
            ),
            SimpleNamespace(
                success=True,
                output="Notified user",
                raw_output={"notified": True},
            ),
        ])
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )

    recovered = asyncio.run(orchestrator.recover_interrupted_workflows(repeat_interrupted_actions=True))

    assert "task-resume-test" in recovered
    assert react_loop.execute_planned_tool.await_count == 2
    assert react_loop.execute_planned_tool.await_args_list[0].args[0] == "process_file"
    assert react_loop.execute_planned_tool.await_args_list[1].args[0] == "notify_user"
    assert checkpoint_store.deleted == ["task-resume-test"]

    task = asyncio.run(task_manager.get_task("task-resume-test"))
    assert task.status.value == "completed"


def test_resume_workflow_api_resumes_from_checkpoint():
    class CheckpointStore:
        def __init__(self):
            self.checkpoint = {
                "task_description": "Manual resume workflow",
                "screen_request_active": False,
                "recovery_state": "needs_attention",
                "plan": [
                    {
                        "id": "step1",
                        "action": "step1_tool",
                        "params": {},
                        "dependencies": [],
                    },
                    {
                        "id": "step2",
                        "action": "step2_tool",
                        "params": {},
                        "dependencies": ["step1"],
                    },
                ],
                "step_outputs": {"step1": "output1"},
                "step_results": {
                    "step1": {
                        "action": "step1_tool",
                        "status": "completed",
                        "output": "Done 1",
                    },
                    "step2": {
                        "action": "step2_tool",
                        "status": "failed",
                        "output": "Temporary failure",
                    },
                },
                "current_step": {"id": "step2", "status": "failed"},
            }
            self.deleted = []

        def load(self, _task_id):
            return self.checkpoint.copy()

        def save(self, _task_id, checkpoint):
            self.checkpoint = checkpoint.copy()

        def delete(self, task_id):
            self.deleted.append(task_id)

    checkpoint_store = CheckpointStore()
    event_bus = AsyncMock()
    from services.agent.core.task_manager import TaskManager

    task_manager = TaskManager(event_bus)
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=True,
            output="Step 2 succeeded",
            raw_output="step2_val",
        ))
    )
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )

    result = asyncio.run(orchestrator.resume_workflow("task-manual-resume", force=True))

    assert result["status"] == "completed"
    assert react_loop.execute_planned_tool.await_count == 1
    assert react_loop.execute_planned_tool.await_args.args[0] == "step2_tool"
    assert checkpoint_store.deleted == ["task-manual-resume"]
    task = asyncio.run(task_manager.get_task("task-manual-resume"))
    assert task.status.value == "completed"


def test_workflow_step_retries_on_transient_failure():
    attempts = 0

    async def flaky_tool(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 2:
            return SimpleNamespace(
                success=False,
                execution_succeeded=False,
                safe_to_retry=True,
                output="Temporary connection failure before the operation ran.",
                raw_output=None,
            )
        return SimpleNamespace(
            success=True,
            output="Finally connected",
            raw_output="ok",
        )

    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=flaky_tool)
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
        "task-flaky",
        Plan([PlanStep("flaky", "network_call", {}, [])]),
        screen_request_active=False,
        max_step_retries=3,
        step_retry_delay=0.01,
    ))

    assert result["status"] == "completed"
    assert attempts == 2
    assert result["steps"]["flaky"]["status"] == "completed"


def test_workflow_step_retries_explicit_not_executed_failure():
    attempts = 0

    async def flaky_tool(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return SimpleNamespace(
                success=False,
                execution_succeeded=False,
                safe_to_retry=True,
                output="Tool was unavailable before execution.",
                raw_output=None,
            )
        return SimpleNamespace(
            success=True,
            execution_succeeded=True,
            output="Recovered",
            raw_output={"ok": True},
        )

    orchestrator = Orchestrator(
        planner=None,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=SimpleNamespace(
            execute_planned_tool=AsyncMock(side_effect=flaky_tool)
        ),
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-explicit-failure",
        Plan([PlanStep("step", "read_tool", {}, [])]),
        screen_request_active=False,
        step_retry_delay=0,
    ))

    assert result["status"] == "completed"
    assert attempts == 2


def test_workflow_does_not_retry_action_with_uncertain_execution_result():
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=False,
            execution_succeeded=True,
            output="Action ran but its result was not verified.",
            raw_output=None,
        ))
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
        "task-uncertain-result",
        Plan([PlanStep("step", "write_tool", {}, [])]),
        screen_request_active=False,
    ))

    assert result["status"] == "failed"
    react_loop.execute_planned_tool.assert_awaited_once()


def test_workflow_switches_to_alternative_after_safe_failure():
    original = Plan([
        PlanStep("trigger", "__workflow_trigger__", {"input": "Report"}, []),
        PlanStep("read", "unavailable_tool", {}, ["trigger"]),
    ])
    replacement = Plan([PlanStep("fallback", "alternate_tool", {}, [])])
    planner = SimpleNamespace(
        replan=AsyncMock(return_value=replacement),
    )
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(
                success=False,
                execution_succeeded=False,
                allow_replan=True,
                output="Tool is unavailable.",
                raw_output=None,
            ),
            SimpleNamespace(
                success=True,
                raw_output={"matches": [{"path": "04 - Desarrollo/Recuperacion.md"}]},
            ),
            SimpleNamespace(
                success=True,
                raw_output={"content": "Use a bounded alternate strategy."},
            ),
            SimpleNamespace(
                success=True,
                execution_succeeded=True,
                output="Alternative succeeded.",
                raw_output={"ok": True},
            ),
        ])
    )
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=SimpleNamespace(
            is_cancelled=AsyncMock(return_value=False),
            set_progress_label=AsyncMock(),
        ),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=SimpleNamespace(
            get_tools_by_source=lambda source: [
                SimpleNamespace(name="helix-vault_search_notes"),
                SimpleNamespace(name="helix-vault_read_note"),
            ] if source == "mcp" else [],
        ),
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-replan",
        original,
        screen_request_active=False,
        task_description="Read the report.",
    ))

    assert result["status"] == "completed"
    assert result["replanned_from_step"] == "read"
    assert react_loop.execute_planned_tool.await_args_list[1].args[0] == "helix-vault_search_notes"
    assert react_loop.execute_planned_tool.await_args_list[2].args[0] == "helix-vault_read_note"
    assert react_loop.execute_planned_tool.await_args_list[3].args[0] == "alternate_tool"
    planner.replan.assert_awaited_once_with(
        original.steps[1],
        "Tool is unavailable.",
        original,
        task_description="Read the report.",
        reference_context=(
            "Note: 04 - Desarrollo/Recuperacion.md\n"
            "Use a bounded alternate strategy."
        ),
    )


@pytest.mark.parametrize(
    "tool_registry",
    [
        None,
        SimpleNamespace(get_tools_by_source=lambda _source: []),
    ],
)
def test_optional_vault_mcp_absence_does_not_report_workflow_error(tool_registry):
    task_manager = SimpleNamespace(set_progress_label=AsyncMock())
    orchestrator = Orchestrator(
        planner=None,
        task_manager=task_manager,
        event_bus=None,
        react_loop=None,
        agent_manager=None,
        tool_registry=tool_registry,
        role_config=None,
    )

    context = asyncio.run(orchestrator._read_vault_context(
        task_id="task-no-vault-mcp",
        task_description="Do the workflow task.",
        failed_step=PlanStep("step", "read_tool", {}, []),
        conversation_id=None,
        source_device_id=None,
    ))

    assert context == ""
    task_manager.set_progress_label.assert_not_awaited()


def test_safe_replan_intent_survives_checkpoint_reload():
    checkpoint = {
        "plan": [
            {
                "id": "trigger",
                "action": "__workflow_trigger__",
                "params": {"input": "Report"},
                "dependencies": [],
                "when": [],
                "run_if_any": False,
            },
            {
                "id": "read",
                "action": "unavailable_tool",
                "params": {},
                "dependencies": ["trigger"],
                "when": [],
                "run_if_any": False,
            },
        ],
        "step_outputs": {"trigger": "Report"},
        "step_results": {
            "trigger": {"action": "__workflow_trigger__", "status": "completed", "output": "Report"},
            "read": {"action": "unavailable_tool", "status": "failed", "output": "Not available."},
        },
        "recovery_attempt": 0,
        "replan_pending": {"step_id": "read", "error": "Not available."},
    }

    class CheckpointStore:
        def __init__(self):
            self.checkpoint = checkpoint
            self.saved = []

        def load(self, _task_id):
            return self.checkpoint

        def save(self, _task_id, data):
            self.saved.append(data.copy())
            self.checkpoint = data.copy()

    replacement = Plan([PlanStep("fallback", "alternate_tool", {}, [])])
    planner = SimpleNamespace(replan=AsyncMock(return_value=replacement))
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(return_value=SimpleNamespace(
            success=True,
            execution_succeeded=True,
            output="Recovered.",
            raw_output="Recovered.",
        ))
    )
    checkpoint_store = CheckpointStore()
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=SimpleNamespace(
            is_cancelled=AsyncMock(return_value=False),
            set_progress_label=AsyncMock(),
        ),
        event_bus=SimpleNamespace(publish=AsyncMock()),
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
        checkpoint_store=checkpoint_store,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-replan-recovery",
        Plan([]),
        screen_request_active=False,
        task_description="Read the report.",
    ))

    assert result["status"] == "completed"
    planner.replan.assert_awaited_once()
    assert checkpoint_store.saved[0]["recovery_attempt"] == 1
    assert "replan_pending" not in checkpoint_store.saved[-1]


def test_workflow_does_not_replan_after_completed_side_effect():
    planner = SimpleNamespace(replan=AsyncMock())
    react_loop = SimpleNamespace(
        execute_planned_tool=AsyncMock(side_effect=[
            SimpleNamespace(success=True, output="Changed file.", raw_output=None),
            SimpleNamespace(
                success=False,
                execution_succeeded=False,
                allow_replan=True,
                output="Tool is unavailable.",
                raw_output=None,
            ),
        ])
    )
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=SimpleNamespace(is_cancelled=AsyncMock(return_value=False)),
        event_bus=None,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )

    result = asyncio.run(orchestrator._execute_workflow_plan(
        "task-no-replan",
        Plan([
            PlanStep("write", "write_file", {}, []),
            PlanStep("next", "missing_tool", {}, ["write"]),
        ]),
        screen_request_active=False,
    ))

    assert result["status"] == "failed"
    planner.replan.assert_not_awaited()
