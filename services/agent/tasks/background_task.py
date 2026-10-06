import logging
import asyncio
from datetime import datetime
from typing import Coroutine, Callable
from services.agent.tasks.task_state import Task, TaskStatus, TaskLog

logger = logging.getLogger(__name__)

class BackgroundTask:
    def __init__(self, task: Task, executor_fn: Callable[..., Coroutine], event_bus):
        self.task = task
        self.executor_fn = executor_fn
        self.event_bus = event_bus
        self._asyncio_task = None
        self._pause_event = asyncio.Event()
        self._pause_event.set() # Initially not paused

    async def start(self):
        self._update_status(TaskStatus.RUNNING)
        self.task.started_at = datetime.utcnow()
        self.log("Task started", "INFO")
        self.event_bus.emit("TASK_STARTED", {"task_id": self.task.id})
        
        self._asyncio_task = asyncio.create_task(self._run_wrapper())

    async def _run_wrapper(self):
        try:
            # Wait if paused
            await self._pause_event.wait()
            
            # Execute main function
            result = await self.executor_fn(self)
            
            if not self.task.cancelled:
                self.task.result = result
                self._update_status(TaskStatus.COMPLETED)
                self.task.completed_at = datetime.utcnow()
                self.log("Task completed successfully", "INFO")
                self.event_bus.emit("TASK_COMPLETED", {"task_id": self.task.id, "result": result})
                
        except asyncio.CancelledError:
            self.task.cancelled = True
            self._update_status(TaskStatus.CANCELLED)
            self.task.completed_at = datetime.utcnow()
            self.log("Task cancelled", "WARNING")
            self.event_bus.emit("TASK_CANCELLED", {"task_id": self.task.id})
        except Exception as e:
            self.task.error = str(e)
            self._update_status(TaskStatus.FAILED)
            self.task.completed_at = datetime.utcnow()
            self.log(f"Task failed: {e}", "ERROR")
            self.event_bus.emit("TASK_FAILED", {"task_id": self.task.id, "error": str(e)})

    async def pause(self):
        if self.task.status == TaskStatus.RUNNING:
            self._pause_event.clear()
            self._update_status(TaskStatus.PAUSED)
            self.log("Task paused", "INFO")

    async def resume(self):
        if self.task.status == TaskStatus.PAUSED:
            self._pause_event.set()
            self._update_status(TaskStatus.RUNNING)
            self.log("Task resumed", "INFO")

    async def cancel(self):
        self.task.cancelled = True
        if self._asyncio_task and not self._asyncio_task.done():
            self._asyncio_task.cancel()
            try:
                await self._asyncio_task
            except asyncio.CancelledError:
                pass

    def get_state(self) -> Task:
        return self.task

    def log(self, message: str, level: str = 'INFO', action: str = None):
        if action:
            self.task.current_action = action
        log_entry = TaskLog(timestamp=datetime.utcnow(), level=level, message=message, action=action)
        self.task.logs.append(log_entry)
        logger.log(logging.getLevelName(level), f"[{self.task.id}] {message}")

    async def request_confirmation(self, action: str, what: str, why: str) -> bool:
        self.log(f"Requesting confirmation for: {what}", "INFO", action=action)
        previous_status = self.task.status
        self._update_status(TaskStatus.WAITING_CONFIRMATION)
        
        # This requires an async mechanism to wait for user input from event bus
        # Here we just emit and assume the agent/manager will resume or fail it
        self.event_bus.emit("TASK_WAITING_CONFIRMATION", {
            "task_id": self.task.id,
            "action": action,
            "what": what,
            "why": why
        })
        
        # Await an external signal...
        # In a complete implementation, we'd wait on an Future that is set by event_bus
        # For this, we'll simulate an auto-approval if testing, or raise an exception to pause
        
        # We will pause the task internally until resumed with confirmation
        self._pause_event.clear()
        await self._pause_event.wait()
        
        self._update_status(previous_status)
        return not self.task.cancelled

    def is_cancelled(self) -> bool:
        return self.task.cancelled

    def _update_status(self, status: TaskStatus):
        self.task.status = status
