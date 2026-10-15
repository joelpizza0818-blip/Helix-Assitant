import asyncio
from types import SimpleNamespace

import pytest

from services.agent.core.agent_manager import AgentManager
from services.agent.core.event_bus import EventBus
from services.agent.core.task_manager import TaskManager, TaskStatus


class FakeContextManager:
    def __init__(self):
        self.messages = {}

    def get_system_prompt(self, _role):
        return "You are a test agent."

    def add_message(self, conversation_id, message):
        self.messages.setdefault(conversation_id, []).append(message)

    def get_messages(self, conversation_id):
        return self.messages.get(conversation_id, [])


class FakeReactLoop:
    def __init__(self, delay=0, fail=False, fail_message="provider failed"):
        self.delay = delay
        self.fail = fail
        self.fail_message = fail_message
        self.active = 0
        self.max_active = 0
        self.execute_kwargs = None

    async def execute(self, **kwargs):
        self.execute_kwargs = kwargs
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(self.delay)
            if self.fail:
                raise RuntimeError(self.fail_message)
            return SimpleNamespace(content="done")
        finally:
            self.active -= 1


async def make_manager(loop, task_manager=None):
    manager = AgentManager(
        react_loop=loop,
        context_manager=FakeContextManager(),
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
        task_manager=task_manager,
    )
    if task_manager is not None:
        await manager.attach_task_manager(task_manager)
    return manager


@pytest.mark.asyncio
async def test_delegate_parallel_runs_agents_concurrently_and_persists_results():
    task_manager = TaskManager(EventBus())
    loop = FakeReactLoop(delay=0.02)
    manager = await make_manager(loop, task_manager)

    results = await manager.delegate_parallel([
        {"task": "first", "role": "research", "parent_id": "parent"},
        {"task": "second", "role": "coding", "parent_id": "parent"},
    ])

    assert loop.max_active == 2
    assert [result["status"] for result in results] == ["success", "success"]
    child_tasks = await task_manager.get_tasks()
    assert len(child_tasks) == 2
    assert all(task.status == TaskStatus.COMPLETED for task in child_tasks)
    assert all(task.result == "done" for task in child_tasks)
    assert all(task.parent_id == "parent" for task in child_tasks)


@pytest.mark.asyncio
async def test_parent_cancellation_stops_all_active_children():
    task_manager = TaskManager(EventBus())
    await task_manager.create_task("parent", "parent task")
    started = asyncio.Event()

    class BlockingLoop(FakeReactLoop):
        async def execute(self, **kwargs):
            started.set()
            return await super().execute(**kwargs)

    manager = await make_manager(BlockingLoop(delay=10), task_manager)
    handle = await manager.delegate_task("child", role="research", parent_id="parent")
    await asyncio.wait_for(started.wait(), timeout=1)
    child_id = next(iter(manager.tasks))

    assert await task_manager.cancel("parent") is True
    result = await asyncio.wait_for(handle, timeout=1)

    assert result["status"] == "cancelled"
    child = await task_manager.get_task(child_id)
    assert child.status == TaskStatus.CANCELLED
    assert (await manager.get_status(child_id))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_agent_failure_is_retained_as_failed_task_result():
    task_manager = TaskManager(EventBus())
    manager = await make_manager(FakeReactLoop(fail=True), task_manager)

    handle = await manager.delegate_task("broken", role="coding")
    result = await handle
    agent_id = result["agent_id"]
    task = await task_manager.get_task(agent_id)

    assert result["status"] == "failed"
    assert "provider failed" in result["error"]
    assert task.status == TaskStatus.FAILED
    assert task.error == "provider failed"


@pytest.mark.asyncio
async def test_delegated_agent_excludes_parent_credential_without_persisting_or_logging_it(caplog):
    secret = "configured-private-credential"
    loop = FakeReactLoop(
        fail=True,
        fail_message=f"provider rejected credential={secret}",
    )
    loop.key_manager = SimpleNamespace(
        redact_configured_credentials=lambda value: str(value).replace(secret, "[REDACTED]")
    )
    event_bus = EventBus()
    events = []

    async def capture_event(event_name, payload):
        events.append((event_name, payload))

    await event_bus.subscribe("*", capture_event)
    task_manager = TaskManager(event_bus)
    manager = AgentManager(
        react_loop=loop,
        context_manager=FakeContextManager(),
        event_bus=event_bus,
        role_config=None,
        tool_registry=None,
        task_manager=task_manager,
    )
    await manager.attach_task_manager(task_manager)

    handle = await manager.delegate_task(
        "Research safely",
        role="research",
        parent_id="parent-id",
        context={"input_source": "subagent delegation"},
        excluded_api_keys=[secret],
    )
    result = await handle
    await asyncio.sleep(0.01)
    child_id = result["agent_id"]
    task = await task_manager.get_task(child_id)
    task_context = await task_manager.get_task_context(child_id)

    assert result["status"] == "failed"
    assert "[REDACTED]" in result["error"]
    assert loop.execute_kwargs["excluded_api_keys"] == [secret]
    assert secret not in str(task_context)
    assert secret not in str(task)
    assert secret not in caplog.text
    assert secret not in str(events)
