import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.event_bus import EventBus
from services.agent.core.task_manager import TaskManager, TaskStatus
from services.agent.core.task_store import TaskStore


def test_task_history_restores_interrupted_tasks_as_paused(tmp_path):
    async def run():
        manager = TaskManager(EventBus(), store=TaskStore(tmp_path))
        await manager.create_task(
            "task-1",
            "Long task",
            context={
                "input_source": "text",
                "conversation_id": "conversation-1",
                "conversation_history": [{"role": "user", "content": "private"}],
            },
        )
        await manager.update_status("task-1", TaskStatus.RUNNING)
        await manager.set_progress_label("task-1", "Working")
        await manager.flush_persist()

        restored = TaskManager(EventBus(), store=TaskStore(tmp_path))
        assert await restored.restore() == 1
        task = await restored.get_task("task-1")
        assert task is not None
        assert task.status == TaskStatus.PAUSED
        assert task.metadata["interrupted"] is True
        context = await restored.get_task_context("task-1")
        assert context == {
            "input_source": "text",
            "conversation_id": "conversation-1",
        }

    asyncio.run(run())


def test_wait_if_paused_resumes_only_after_manual_resume():
    async def run():
        manager = TaskManager(EventBus())
        await manager.create_task("task-1", "Long task")
        await manager.update_status("task-1", TaskStatus.RUNNING)
        assert await manager.pause("task-1") is True
        waiter = asyncio.create_task(manager.wait_if_paused("task-1"))
        await asyncio.sleep(0.01)
        assert waiter.done() is False
        assert await manager.resume("task-1") is True
        assert await asyncio.wait_for(waiter, timeout=1) is True
        task = await manager.get_task("task-1")
        assert task.status == TaskStatus.RUNNING

    asyncio.run(run())


def test_cancel_wakes_a_paused_waiter():
    async def run():
        manager = TaskManager(EventBus())
        await manager.create_task("task-1", "Long task")
        await manager.update_status("task-1", TaskStatus.RUNNING)
        await manager.pause("task-1")
        waiter = asyncio.create_task(manager.wait_if_paused("task-1"))
        await asyncio.sleep(0.01)
        assert waiter.done() is False
        assert await manager.cancel("task-1") is True
        assert await asyncio.wait_for(waiter, timeout=1) is False

    asyncio.run(run())


def test_desktop_bridge_pauses_and_resumes_a_regular_task(tmp_path):
    async def run():
        manager = TaskManager(EventBus())
        await manager.create_task("task-1", "Long task")
        await manager.update_status("task-1", TaskStatus.RUNNING)
        orchestrator = SimpleNamespace(
            execute_task=AsyncMock(),
            checkpoint_store=None,
        )
        handler = DesktopRequestHandler(
            manager,
            None,
            None,
            None,
            tmp_path / "settings.json",
            orchestrator=orchestrator,
        )

        await handler._dispatch_event("TASK_PAUSE", {"task_id": "task-1"})
        assert (await manager.get_task("task-1")).status == TaskStatus.PAUSED

        await handler._dispatch_event("TASK_RESUME", {"task_id": "task-1"})
        await asyncio.sleep(0.05)

        orchestrator.execute_task.assert_awaited_once()
        assert (await manager.get_task("task-1")).status == TaskStatus.RUNNING

    asyncio.run(run())


def test_desktop_bridge_resumes_a_workflow_from_its_checkpoint(tmp_path):
    async def run():
        manager = TaskManager(EventBus())
        await manager.create_task("task-1", "Workflow task")
        await manager.update_status("task-1", TaskStatus.RUNNING)
        await manager.pause("task-1")
        checkpoint_store = SimpleNamespace(
            load=lambda task_id: {"task_description": "Workflow task"}
            if task_id == "task-1"
            else None,
        )
        orchestrator = SimpleNamespace(
            execute_task=AsyncMock(),
            resume_workflow=AsyncMock(),
            checkpoint_store=checkpoint_store,
        )
        handler = DesktopRequestHandler(
            manager,
            None,
            None,
            None,
            tmp_path / "settings.json",
            orchestrator=orchestrator,
        )

        await handler._dispatch_event("TASK_RESUME", {"task_id": "task-1"})
        await asyncio.sleep(0.05)

        orchestrator.resume_workflow.assert_awaited_once_with(
            "task-1",
            force=False,
            repeat_interrupted_actions=False,
        )
        orchestrator.execute_task.assert_not_awaited()

    asyncio.run(run())


def test_task_store_ignores_a_corrupt_history_file(tmp_path):
    store = TaskStore(tmp_path)
    store.directory.mkdir(parents=True, exist_ok=True)
    store.path.write_text("{not valid json", encoding="utf-8")

    assert store.load() == []


def test_desktop_bridge_rejects_resume_without_task_or_checkpoint(tmp_path):
    async def run():
        manager = TaskManager(EventBus())
        orchestrator = SimpleNamespace(
            execute_task=AsyncMock(),
            resume_workflow=AsyncMock(),
            checkpoint_store=SimpleNamespace(load=lambda _task_id: None),
        )
        handler = DesktopRequestHandler(
            manager,
            None,
            None,
            None,
            tmp_path / "settings.json",
            orchestrator=orchestrator,
        )

        try:
            await handler._dispatch_event("TASK_RESUME", {"task_id": "missing"})
        except ValueError as error:
            assert "existing task or a saved workflow checkpoint" in str(error)
        else:
            raise AssertionError("TASK_RESUME should reject unknown tasks")

        orchestrator.resume_workflow.assert_not_awaited()

    asyncio.run(run())


def test_desktop_bridge_refuses_resume_when_checkpoint_cannot_be_read(tmp_path):
    async def run():
        manager = TaskManager(EventBus())
        await manager.create_task("task-1", "Workflow task")
        await manager.update_status("task-1", TaskStatus.RUNNING)
        await manager.pause("task-1")

        def fail_to_load(_task_id):
            raise RuntimeError("corrupt checkpoint")

        orchestrator = SimpleNamespace(
            execute_task=AsyncMock(),
            resume_workflow=AsyncMock(),
            checkpoint_store=SimpleNamespace(load=fail_to_load),
        )
        handler = DesktopRequestHandler(
            manager,
            None,
            None,
            None,
            tmp_path / "settings.json",
            orchestrator=orchestrator,
        )

        try:
            await handler._dispatch_event("TASK_RESUME", {"task_id": "task-1"})
        except RuntimeError as error:
            assert "could not be read" in str(error)
        else:
            raise AssertionError("A corrupt checkpoint must block resumption")

        orchestrator.resume_workflow.assert_not_awaited()
        orchestrator.execute_task.assert_not_awaited()
        assert (await manager.get_task("task-1")).status == TaskStatus.PAUSED

    asyncio.run(run())


def test_workflow_waits_while_its_task_is_paused():
    from services.agent.core.orchestrator import Orchestrator
    from services.agent.core.planner import Plan, PlanStep

    async def run():
        event_bus = EventBus()
        manager = TaskManager(event_bus)
        await manager.create_task("workflow-1", "Summarize input")
        await manager.update_status("workflow-1", TaskStatus.RUNNING)
        assert await manager.pause("workflow-1") is True
        react_loop = SimpleNamespace(
            execute_planned_tool=AsyncMock(
                return_value=SimpleNamespace(
                    success=True,
                    output="done",
                    raw_output="done",
                    execution_succeeded=True,
                )
            )
        )
        orchestrator = Orchestrator(
            planner=None,
            task_manager=manager,
            event_bus=event_bus,
            react_loop=react_loop,
            agent_manager=None,
            tool_registry=None,
            role_config=None,
        )
        plan = Plan(
            steps=[
                PlanStep(
                    id="summarize",
                    action="summarize",
                    params={},
                    dependencies=[],
                )
            ],
        )

        execution = asyncio.create_task(
            orchestrator._execute_workflow_plan(
                "workflow-1",
                plan,
                screen_request_active=False,
                task_description="Summarize input",
            )
        )
        await asyncio.sleep(0.02)
        react_loop.execute_planned_tool.assert_not_awaited()
        assert (await manager.get_task("workflow-1")).status == TaskStatus.PAUSED

        assert await manager.resume("workflow-1") is True
        result = await asyncio.wait_for(execution, timeout=2)

        assert result["status"] == "completed"
        react_loop.execute_planned_tool.assert_awaited_once()

    asyncio.run(run())
