import asyncio
import logging
from datetime import datetime, timezone

try:
    from services.agent.core.context_compression import close_ccl
    from services.agent.core.task_manager import TaskStatus, _safe_text
    from services.agent.core.orchestrator_intents import _conversation_failure_message
except ImportError:
    from core.context_compression import close_ccl
    from core.task_manager import TaskStatus, _safe_text
    from core.orchestrator_intents import _conversation_failure_message

logger = logging.getLogger(__name__)


class TaskLifecycleMixin:
    """Guard task concurrency, cancellation, reporting, and resource cleanup."""

    async def execute_task(self, task_id: str, description: str, context: dict = None):
        """Run a task while preserving cancellation and terminal state."""
        context = context or {}
        started = False
        async with self._execution_lock:
            if task_id in self._active_execution_ids:
                logger.warning(
                    "Rejected duplicate concurrent execution for task %s.",
                    task_id,
                )
                return {"status": "already_running", "task_id": task_id}
            self._active_execution_ids.add(task_id)
        try:
            if await self._is_cancelled(task_id):
                await self.event_bus.publish(
                    "ORCHESTRATION_CANCELLED",
                    {
                        "task_id": task_id,
                        "reason": "Task was cancelled before execution.",
                    },
                )
                return {"status": "cancelled", "task_id": task_id}
            getter = getattr(self.task_manager, "get_task", None)
            existing_task = await getter(task_id) if getter is not None else None
            if existing_task is not None and existing_task.status in {
                TaskStatus.RUNNING,
                TaskStatus.WAITING_CONFIRMATION,
                TaskStatus.PAUSED,
                TaskStatus.COMPLETED,
                TaskStatus.FAILED,
                TaskStatus.CANCELLED,
            }:
                logger.warning(
                    "Rejected duplicate execution for task %s in state %s.",
                    task_id,
                    existing_task.status.value,
                )
                return {
                    "status": "already_running"
                    if existing_task.status
                    in {
                        TaskStatus.RUNNING,
                        TaskStatus.WAITING_CONFIRMATION,
                        TaskStatus.PAUSED,
                    }
                    else "already_finished",
                    "task_id": task_id,
                }
            try:
                started = True
                result = await self._execute_task(task_id, description, context)
                if (
                    isinstance(result, dict)
                    and result.get("status") == "cancelled"
                ):
                    self._clear_workflow_checkpoint(task_id)
                return result
            except asyncio.CancelledError:
                self._clear_workflow_checkpoint(task_id)
                await self.task_manager.update_status(task_id, TaskStatus.CANCELLED)
                await self.event_bus.publish(
                    "ORCHESTRATION_CANCELLED",
                    {"task_id": task_id, "reason": "Task execution was cancelled."},
                )
                return {"status": "cancelled", "task_id": task_id}
        except Exception as error:
            logger.exception("Unhandled task execution failure for task %s.", task_id)
            status = await self._report_unhandled_task_failure(
                task_id,
                error,
                context,
            )
            return {"status": status, "task_id": task_id}
        finally:
            if started:
                await self._record_project_execution(task_id, description, context)
            release_resources = getattr(
                self.react_loop, "release_task_resources", None
            )
            if callable(release_resources):
                try:
                    await release_resources(task_id)
                except Exception:
                    logger.exception(
                        "Could not release resources for task %s.",
                        task_id,
                    )
            try:
                close_ccl(task_id)
            except Exception:
                logger.exception(
                    "Could not close the context store for task %s.",
                    task_id,
                )
            async with self._execution_lock:
                self._active_execution_ids.discard(task_id)
    async def _record_project_execution(
        self,
        task_id: str,
        description: str,
        context: dict,
    ) -> None:
        """Persist a completed task summary to the active project memory when available."""
        store = self.project_memory_store
        project_id = context.get("project_id")
        if store is None or not project_id:
            return
        try:
            task = await self.task_manager.get_task(task_id)
            if task is None:
                return
            status = getattr(task.status, "value", task.status)
            if status not in {"completed", "failed", "cancelled"}:
                return
            result = getattr(task, "result", None)
            summary = _safe_text(
                f"Task: {description}. Result: {result or 'No result recorded.'}",
                1000,
            )
            store.record_execution(
                project_id,
                task_id,
                status,
                summary,
                session_id=context.get("conversation_id"),
            )
        except Exception:
            logger.exception("Could not save project execution memory.")
    async def _is_cancelled(self, task_id: str) -> bool:
        """Read cancellation state through the task manager compatibility interface."""
        checker = getattr(self.task_manager, "is_cancelled", None)
        if checker is not None:
            return await checker(task_id)
        getter = getattr(self.task_manager, "get_task", None)
        if getter is None:
            return False
        task = await getter(task_id)
        return bool(task and (task.cancelled or task.status == TaskStatus.CANCELLED))
    async def _report_unhandled_task_failure(
        self,
        task_id: str,
        error: Exception,
        context: dict,
    ) -> str:
        """Convert unexpected execution errors into safe task state and user events."""
        getter = getattr(self.task_manager, "get_task", None)
        task = None
        if callable(getter):
            try:
                task = await getter(task_id)
            except Exception:
                logger.exception(
                    "Could not inspect task %s after an unhandled failure.",
                    task_id,
                )

        status = getattr(task, "status", None)
        status = getattr(status, "value", status)
        if status in {"completed", "failed", "cancelled"}:
            return status

        message = _conversation_failure_message(error)
        set_result = getattr(self.task_manager, "set_result", None)
        if callable(set_result):
            try:
                await set_result(task_id, error=message)
            except Exception:
                logger.exception(
                    "Could not save failure details for task %s.",
                    task_id,
                )
        try:
            await self.task_manager.update_status(task_id, TaskStatus.FAILED)
        except Exception:
            logger.exception(
                "Could not mark task %s as failed after an unhandled error.",
                task_id,
            )

        timestamp = datetime.now(timezone.utc).isoformat()
        try:
            await self.event_bus.publish(
                "AGENT_MESSAGE",
                {
                    "task_id": task_id,
                    "role": "assistant",
                    "content": message,
                    "timestamp": timestamp,
                    "conversation_id": context.get("conversation_id"),
                },
            )
        except Exception:
            logger.exception(
                "Could not publish the failure message for task %s.",
                task_id,
            )
        try:
            await self.event_bus.publish(
                "ORCHESTRATION_FAILED",
                {
                    "task_id": task_id,
                    "conversation_id": context.get("conversation_id"),
                    "error": type(error).__name__,
                },
            )
        except Exception:
            logger.exception(
                "Could not publish the failure event for task %s.",
                task_id,
            )
        return "failed"
