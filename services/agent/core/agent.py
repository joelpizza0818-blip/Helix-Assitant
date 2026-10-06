import logging
from .event_bus import EventBus
from .state_manager import StateManager
from .orchestrator import Orchestrator
from .task_manager import TaskManager
import uuid
import asyncio

logger = logging.getLogger(__name__)

class Agent:
    def __init__(self, event_bus: EventBus, state_manager: StateManager, orchestrator: Orchestrator, task_manager: TaskManager):
        self.event_bus = event_bus
        self.state_manager = state_manager
        self.orchestrator = orchestrator
        self.task_manager = task_manager

        asyncio.create_task(self.event_bus.subscribe("USER_TEXT", self.handle_user_input))
        asyncio.create_task(self.event_bus.subscribe("VOICE_COMMAND", self.handle_user_input))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_CONFIRM", self.handle_gesture_confirm))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_REJECT", self.handle_gesture_reject))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_SEARCH", self.handle_gesture_search))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_STOP", self.handle_gesture_stop))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_CLOSE", self.handle_gesture_close))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_OPEN", self.handle_gesture_open))

    async def handle_user_input(self, event_name: str, payload: dict):
        text = payload.get("text", "")
        task_id = str(uuid.uuid4())
        await self.task_manager.create_task(task_id, text)
        asyncio.create_task(self.orchestrator.execute_task(task_id, text))

    async def handle_gesture_confirm(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_confirmation_pending and state.current_task_id:
            await self.event_bus.publish("CONFIRMATION_GRANTED", {"task_id": state.current_task_id})

    async def handle_gesture_reject(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_confirmation_pending and state.current_task_id:
            await self.event_bus.publish("CONFIRMATION_REJECTED", {"task_id": state.current_task_id})

    async def handle_gesture_search(self, event_name: str, payload: dict):
        logger.info("Triggering web research via gesture")

    async def handle_gesture_stop(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_task_id:
            await self.task_manager.cancel(state.current_task_id)

    async def handle_gesture_close(self, event_name: str, payload: dict):
        logger.info("Ending active interaction via gesture")

    async def handle_gesture_open(self, event_name: str, payload: dict):
        logger.info("Activating HELIX via gesture")
