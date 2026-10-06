import heapq
import asyncio
from typing import Tuple, Callable, List, Optional
from services.agent.tasks.task_state import Task, TaskStatus

class TaskQueue:
    def __init__(self):
        # elements are (-priority, increment, task_id)
        self._queue = []
        self._tasks = {}
        self._executors = {}
        self._counter = 0
        self._lock = asyncio.Lock()

    async def enqueue(self, task: Task, executor_fn: Callable) -> str:
        async with self._lock:
            self._counter += 1
            # heapq acts as min-heap, so we invert priority
            heapq.heappush(self._queue, (-task.priority, self._counter, task.id))
            self._tasks[task.id] = task
            self._executors[task.id] = executor_fn
            return task.id

    async def dequeue(self) -> Optional[Tuple[Task, Callable]]:
        async with self._lock:
            while self._queue:
                _, _, task_id = heapq.heappop(self._queue)
                if task_id in self._tasks:
                    task = self._tasks[task_id]
                    if task.status == TaskStatus.QUEUED:
                        return task, self._executors[task_id]
            return None

    async def get_all(self) -> List[Task]:
        async with self._lock:
            return list(self._tasks.values())

    async def get_by_status(self, status: TaskStatus) -> List[Task]:
        async with self._lock:
            return [t for t in self._tasks.values() if t.status == status]

    async def get_task(self, task_id: str) -> Optional[Task]:
        async with self._lock:
            return self._tasks.get(task_id)

    async def remove(self, task_id: str):
        async with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
            if task_id in self._executors:
                del self._executors[task_id]

    async def is_empty(self) -> bool:
        async with self._lock:
            return len(self._tasks) == 0

    async def size(self) -> int:
        async with self._lock:
            return len(self._tasks)
