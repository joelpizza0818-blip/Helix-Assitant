import pytest
import asyncio
from datetime import datetime
from services.agent.tasks.task_state import Task, TaskStatus
from services.agent.tasks.task_queue import TaskQueue

@pytest.mark.asyncio
async def test_task_queue_priority_ordering():
    queue = TaskQueue()

    low_task = Task(
        id="task-low",
        description="Low priority background indexing",
        status=TaskStatus.QUEUED,
        priority=1,
        created_at=datetime.utcnow()
    )

    high_task = Task(
        id="task-high",
        description="High priority system action",
        status=TaskStatus.QUEUED,
        priority=10,
        created_at=datetime.utcnow()
    )

    await queue.enqueue(low_task, None)
    await queue.enqueue(high_task, None)

    size = await queue.size()
    assert size == 2

    # High priority task must dequeue first
    first = await queue.dequeue()
    assert first is not None
    assert first[0].id == "task-high"

    second = await queue.dequeue()
    assert second is not None
    assert second[0].id == "task-low"

def test_task_state_cancellation():
    task = Task(
        id="task-cancel-test",
        description="Search web for documents",
        status=TaskStatus.RUNNING,
        priority=5,
        created_at=datetime.utcnow()
    )

    assert not task.cancelled
    task.cancelled = True
    task.status = TaskStatus.CANCELLED
    assert task.status == TaskStatus.CANCELLED
