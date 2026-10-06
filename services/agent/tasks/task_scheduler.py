import logging
import asyncio
import uuid
from datetime import datetime
from typing import Callable, List, Optional
from services.agent.tasks.task_state import Task, TaskStatus
from services.agent.tasks.task_queue import TaskQueue
from services.agent.tasks.background_task import BackgroundTask

logger = logging.getLogger(__name__)

class TaskScheduler:
    def __init__(self, max_concurrent: int = 3, event_bus=None):
        self.max_concurrent = max_concurrent
        self.event_bus = event_bus
        self.queue = TaskQueue()
        self.running_tasks: dict[str, BackgroundTask] = {}
        self._is_running = False
        self._loop_task = None

    async def start(self):
        if self._is_running:
            return
        self._is_running = True
        self._loop_task = asyncio.create_task(self._scheduler_loop())
        logger.info("TaskScheduler started")

    async def stop(self):
        self._is_running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
                
        # Wait for running tasks to gracefully cancel
        cancel_coros = []
        for bg_task in self.running_tasks.values():
            cancel_coros.append(bg_task.cancel())
        if cancel_coros:
            await asyncio.gather(*cancel_coros)
            
        logger.info("TaskScheduler stopped")

    async def submit(self, description: str, executor_fn: Callable, priority: int = 5, 
                     required_permissions: List[str] = None, model: str = None, provider: str = None) -> str:
        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id,
            description=description,
            status=TaskStatus.QUEUED,
            priority=priority,
            created_at=datetime.utcnow(),
            required_permissions=required_permissions or [],
            model=model,
            provider=provider
        )
        await self.queue.enqueue(task, executor_fn)
        if self.event_bus:
            self.event_bus.emit("TASK_CREATED", {"task_id": task_id, "description": description})
        return task_id

    async def cancel(self, task_id: str):
        if task_id in self.running_tasks:
            await self.running_tasks[task_id].cancel()
            del self.running_tasks[task_id]
        else:
            task = await self.queue.get_task(task_id)
            if task:
                task.status = TaskStatus.CANCELLED
                task.cancelled = True
                if self.event_bus:
                    self.event_bus.emit("TASK_CANCELLED", {"task_id": task_id})

    async def pause(self, task_id: str):
        if task_id in self.running_tasks:
            await self.running_tasks[task_id].pause()

    async def resume(self, task_id: str):
        if task_id in self.running_tasks:
            await self.running_tasks[task_id].resume()

    async def get_tasks(self) -> List[Task]:
        queued = await self.queue.get_all()
        running = [bt.get_state() for bt in self.running_tasks.values()]
        return queued + running

    async def get_task(self, task_id: str) -> Optional[Task]:
        if task_id in self.running_tasks:
            return self.running_tasks[task_id].get_state()
        return await self.queue.get_task(task_id)

    def get_running_count(self) -> int:
        return len([t for t in self.running_tasks.values() if t.get_state().status == TaskStatus.RUNNING])

    async def _scheduler_loop(self):
        try:
            while self._is_running:
                # Clean up completed tasks
                completed = [tid for tid, bt in self.running_tasks.items() 
                             if bt.get_state().status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED)]
                for tid in completed:
                    del self.running_tasks[tid]

                # Pull new tasks if capacity allows
                while self.get_running_count() < self.max_concurrent:
                    item = await self.queue.dequeue()
                    if not item:
                        break
                    
                    task, executor_fn = item
                    bg_task = BackgroundTask(task, executor_fn, self.event_bus)
                    self.running_tasks[task.id] = bg_task
                    await bg_task.start()

                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass
