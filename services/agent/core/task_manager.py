import asyncio
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
from enum import Enum

class TaskStatus(Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    WAITING_CONFIRMATION = "waiting_confirmation"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"

@dataclass
class Task:
    id: str
    description: str
    status: TaskStatus = TaskStatus.QUEUED
    priority: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    current_action: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    cancelled: bool = False
    model: Optional[str] = None
    provider: Optional[str] = None
    required_permissions: List[str] = field(default_factory=list)

class TaskManager:
    def __init__(self, event_bus):
        self.tasks: Dict[str, Task] = {}
        self._task_contexts: Dict[str, dict] = {}
        self.lock = asyncio.Lock()
        self.event_bus = event_bus

    async def create_task(
        self,
        task_id: str,
        description: str,
        priority: int = 0,
        context: Optional[dict] = None,
    ) -> Task:
        async with self.lock:
            task = Task(id=task_id, description=description, priority=priority)
            self.tasks[task_id] = task
            self._task_contexts[task_id] = deepcopy(context or {})
        await self.event_bus.publish("TASK_CREATED", {"task_id": task_id})
        return task

    async def get_task_context(self, task_id: str) -> Optional[dict]:
        async with self.lock:
            context = self._task_contexts.get(task_id)
            return deepcopy(context) if context is not None else None

    async def update_status(self, task_id: str, status: TaskStatus):
        async with self.lock:
            if task_id in self.tasks:
                self.tasks[task_id].status = status
        await self.event_bus.publish("TASK_STATUS_CHANGED", {"task_id": task_id, "status": status.value})

    async def cancel(self, task_id: str):
        async with self.lock:
            if task_id in self.tasks:
                self.tasks[task_id].cancelled = True
                self.tasks[task_id].status = TaskStatus.CANCELLED
        await self.event_bus.publish("TASK_CANCELLED", {"task_id": task_id})

    async def pause(self, task_id: str):
        await self.update_status(task_id, TaskStatus.PAUSED)

    async def resume(self, task_id: str):
        await self.update_status(task_id, TaskStatus.RUNNING)

    async def get_tasks(self) -> List[Task]:
        async with self.lock:
            return list(self.tasks.values())

    async def get_task(self, task_id: str) -> Optional[Task]:
        async with self.lock:
            return self.tasks.get(task_id)

    async def get_running_tasks(self) -> List[Task]:
        async with self.lock:
            return [t for t in self.tasks.values() if t.status == TaskStatus.RUNNING]
