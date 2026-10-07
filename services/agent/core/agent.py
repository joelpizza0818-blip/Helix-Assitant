import logging
from .event_bus import EventBus
from .state_manager import StateManager
from .orchestrator import Orchestrator
from .task_manager import TaskManager
from typing import Optional
import uuid
import asyncio

try:
    from ..skills.skill_registry import SkillRegistry
    from ..skills.intent_matcher import IntentMatcher
    from .agent_manager import AgentManager
except ImportError:
    try:
        from services.agent.skills.skill_registry import SkillRegistry
        from services.agent.skills.intent_matcher import IntentMatcher
        from services.agent.core.agent_manager import AgentManager
    except ModuleNotFoundError:
        from skills.skill_registry import SkillRegistry
        from skills.intent_matcher import IntentMatcher
        from core.agent_manager import AgentManager

logger = logging.getLogger(__name__)

class Agent:
    def __init__(self, event_bus: EventBus, state_manager: StateManager, orchestrator: Orchestrator, 
                 task_manager: TaskManager, skill_registry: Optional[SkillRegistry] = None, 
                 intent_matcher: Optional[IntentMatcher] = None, agent_manager: Optional[AgentManager] = None):
        self.event_bus = event_bus
        self.state_manager = state_manager
        self.orchestrator = orchestrator
        self.task_manager = task_manager
        self.skill_registry = skill_registry
        self.intent_matcher = intent_matcher
        self.agent_manager = agent_manager

        asyncio.create_task(self.event_bus.subscribe("USER_TEXT", self.handle_user_input))
        asyncio.create_task(self.event_bus.subscribe("VOICE_COMMAND", self.handle_user_input))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_CONFIRM", self.handle_gesture_confirm))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_REJECT", self.handle_gesture_reject))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_SEARCH", self.handle_gesture_search))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_STOP", self.handle_gesture_stop))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_CLOSE", self.handle_gesture_close))
        asyncio.create_task(self.event_bus.subscribe("GESTURE_OPEN", self.handle_gesture_open))
        asyncio.create_task(self.event_bus.subscribe("WAIT_CONFIRMATION", self.handle_confirmation_pending))
        asyncio.create_task(self.event_bus.subscribe("CONFIRMATION_RESOLVED", self.handle_confirmation_resolved))

    async def handle_user_input(self, event_name: str, payload: dict):
        text = payload.get("text", "")
        if not text:
            return

        task_id = str(uuid.uuid4())
        is_voice_input = (
            event_name == "VOICE_COMMAND"
            or payload.get("input_source") == "voice"
        )
        logger.info(
            "USER_TEXT received source=%s characters=%d",
            "voice" if is_voice_input else "text",
            len(text),
        )
        context = {"input_source": "voice" if is_voice_input else "text"}
        if payload.get("conversation_id") is not None:
            context["conversation_id"] = payload["conversation_id"]
            context["conversation_history"] = payload.get("conversation_history", [])

        # Skill intent matching & activation
        if self.intent_matcher and self.skill_registry:
            matches = self.intent_matcher.match(text)
            matched_skills = []
            for match in matches:
                if match.confidence >= 0.3:
                    self.skill_registry.activate_skill(match.skill.name)
                    matched_skills.append(match.skill.name)
                    logger.info(f"Activated skill '{match.skill.name}' (confidence: {match.confidence:.2f}) for task {task_id}")
            context["active_skills"] = matched_skills
        await self.task_manager.create_task(task_id, text, context=context)
        await self.state_manager.update_state(
            current_task_id=task_id,
            agent_status="busy",
        )
        asyncio.create_task(self._execute_task(task_id, text, context))

    async def _execute_task(self, task_id: str, text: str, context: dict):
        try:
            await self.orchestrator.execute_task(task_id, text, context=context)
        finally:
            state = await self.state_manager.get_state()
            if state.current_task_id == task_id:
                await self.state_manager.update_state(
                    current_task_id=None,
                    agent_status="listening" if state.voice_active else "idle",
                )

    async def handle_confirmation_pending(self, _event_name: str, payload: dict):
        await self.state_manager.update_state(
            active_confirmation_id=payload.get("id"),
            current_confirmation_pending=True,
        )

    async def handle_confirmation_resolved(self, _event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.active_confirmation_id == payload.get("request_id"):
            await self.state_manager.update_state(
                active_confirmation_id=None,
                current_confirmation_pending=False,
            )

    async def handle_gesture_confirm(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_confirmation_pending and state.active_confirmation_id:
            await self.event_bus.publish(
                "CONFIRMATION_GRANTED",
                {"request_id": state.active_confirmation_id},
            )

    async def handle_gesture_reject(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_confirmation_pending and state.active_confirmation_id:
            await self.event_bus.publish(
                "CONFIRMATION_REJECTED",
                {"request_id": state.active_confirmation_id},
            )

    async def handle_gesture_search(self, event_name: str, payload: dict):
        logger.info("Triggering web research via gesture")
        task_id = str(uuid.uuid4())
        await self.task_manager.create_task(task_id, "Perform web research")
        asyncio.create_task(self.orchestrator.execute_task(task_id, "Perform web research on current screen context", context={"role": "research"}))

    async def handle_gesture_stop(self, event_name: str, payload: dict):
        state = await self.state_manager.get_state()
        if state.current_task_id:
            await self.task_manager.cancel(state.current_task_id)

    async def handle_gesture_close(self, event_name: str, payload: dict):
        logger.info("Closing HELIX floating window or Toolbox via gesture")
        await self.event_bus.publish(
            "WINDOW_ACTION",
            {"action": "HIDE_FLOATING_OR_TOOLBOX"},
        )

    async def handle_gesture_open(self, event_name: str, payload: dict):
        logger.info("Opening HELIX floating window or Toolbox via gesture")
        await self.event_bus.publish(
            "WINDOW_ACTION",
            {"action": "SHOW_FLOATING_OR_TOOLBOX"},
        )
