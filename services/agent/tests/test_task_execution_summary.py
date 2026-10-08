import pytest
from unittest.mock import AsyncMock

from services.agent.core.desktop_bridge import _serialize
from services.agent.core.task_manager import TaskManager, TaskStatus


@pytest.mark.asyncio
async def test_model_request_history_is_a_safe_shape_summary():
    event_bus = AsyncMock()
    manager = TaskManager(event_bus)
    await manager.create_task(
        "task-safe-summary",
        "Inspect the current screen",
        context={
            "input_source": "text",
            "conversation_history": [{"role": "user", "content": "private prompt"}],
        },
    )

    await manager.record_model_request("task-safe-summary", {
        "request_id": "request-1",
        "timestamp": "2026-10-07T12:00:00Z",
        "attempt": 1,
        "provider": "openai",
        "model": "test-model",
        "key_slot": 1,
        "status": "succeeded",
        "request": {
            "messages": [
                {"role": "system", "content": "private system context"},
                {"role": "user", "content": "authorization: bearer super-secret"},
            ],
            "context": {"api_key": "sk-private-value"},
        },
    })

    task = await manager.get_task("task-safe-summary")
    request = task.model_requests[0]
    assert "request" not in request
    assert request["input_summary"]["message_count"] == 2
    assert request["input_summary"]["roles"] == ["system", "user"]
    assert "sk-private-value" not in str(request)
    assert "super-secret" not in str(request)


@pytest.mark.asyncio
async def test_execution_summary_tracks_steps_tools_progress_and_result():
    event_bus = AsyncMock()
    manager = TaskManager(event_bus)
    await manager.create_task("task-progress", "Run a safe action")
    await manager.update_status("task-progress", TaskStatus.RUNNING)
    await manager.record_react_step("task-progress", 1, "main")
    await manager.record_tool_call(
        "task-progress",
        "filesystem.read",
        True,
        "authorization=secret-value should be redacted",
    )
    await manager.record_result("task-progress", "completed", "Finished successfully")

    task = await manager.get_task("task-progress")
    serialized = _serialize(task)
    summary = serialized["execution_summary"]
    assert task.progress >= 15
    assert summary["steps"][0]["label"] == "Model execution step 1"
    assert summary["tool_calls"][0]["status"] == "succeeded"
    assert "secret-value" not in str(summary)
    assert summary["result"] == {
        "status": "completed",
        "summary": "Finished successfully",
    }
