import asyncio
import logging
from typing import Optional
from .planner import Planner, Plan
from .task_manager import TaskManager, TaskStatus
from .event_bus import EventBus
try:
    from ai.fallback_manager import FallbackManager
except ImportError:
    from ..ai.fallback_manager import FallbackManager

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, planner: Planner, task_manager: TaskManager, event_bus: EventBus, fallback_manager: FallbackManager):
        self.planner = planner
        self.task_manager = task_manager
        self.event_bus = event_bus
        self.fallback_manager = fallback_manager

    async def execute_task(self, task_id: str, description: str):
        await self.task_manager.update_status(task_id, TaskStatus.RUNNING)
        try:
            plan = await self.planner.create_plan(description, {})
            for step in plan.steps:
                task = await self.task_manager.get_task(task_id)
                if task and task.cancelled:
                    logger.info(f"Task {task_id} cancelled.")
                    break
                
                if step.requires_confirmation:
                    await self.task_manager.update_status(task_id, TaskStatus.WAITING_CONFIRMATION)
                    await self.event_bus.publish("WAIT_CONFIRMATION", {"task_id": task_id, "step": step.description})

                await asyncio.sleep(0.1)

            await self.task_manager.update_status(task_id, TaskStatus.COMPLETED)
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            await self.task_manager.update_status(task_id, TaskStatus.FAILED)
