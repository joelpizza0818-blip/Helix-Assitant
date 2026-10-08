import logging
import re
from .event_bus import EventBus
from .state_manager import StateManager
from .orchestrator import Orchestrator
from .task_manager import TaskManager, TaskStatus
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
        asyncio.create_task(self.event_bus.subscribe("GESTURE_ACTION", self.handle_gesture_action))
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

        requested_skill_names = re.findall(r"(?<!\w)@([A-Za-z0-9_.-]+)", text)
        automatic_skill_names = []
        intent_matcher = getattr(self, "intent_matcher", None)
        skill_registry = getattr(self, "skill_registry", None)
        if not requested_skill_names and intent_matcher and skill_registry:
            matches = intent_matcher.match(text)
            if matches:
                best_match = matches[0]
                has_unambiguous_lead = (
                    len(matches) == 1
                    or best_match.confidence > matches[1].confidence
                )
                if best_match.confidence >= 0.3 and has_unambiguous_lead:
                    automatic_skill_names = [best_match.skill.name]
                    logger.info(
                        "Automatically selected skill @%s from triggers: %s",
                        best_match.skill.name,
                        ", ".join(best_match.matched_triggers),
                    )

        skill_names = requested_skill_names or automatic_skill_names
        if skill_names and skill_registry:
            skill_instructions = []
            requested_skills = []
            for requested_name in dict.fromkeys(skill_names):
                skill = skill_registry.get_skill(requested_name)
                if skill is None:
                    skill = next(
                        (
                            candidate
                            for candidate in skill_registry.get_all_skills()
                            if candidate.name.casefold() == requested_name.casefold()
                        ),
                        None,
                    )
                if skill is None:
                    logger.info(
                        "Explicit skill mention @%s did not match an installed skill.",
                        requested_name,
                    )
                    continue
                requested_skills.append(skill.name)
                skill_instructions.append(
                    f"Skill @{skill.name} ({skill.description}):\n{skill.instructions}"
                )
            if requested_skills:
                context["requested_skills"] = requested_skills
                context["requested_skill_instructions"] = "\n\n".join(
                    skill_instructions
                )
                context["requested_skill_tools"] = list(
                    dict.fromkeys(
                        tool_name
                        for skill_name in requested_skills
                        for tool_name in skill_registry.get_skill(
                            skill_name
                        ).tools
                    )
                )

        tool_registry = getattr(self.orchestrator, "tool_registry", None)
        get_tools_by_source = getattr(tool_registry, "get_tools_by_source", None)
        if callable(get_tools_by_source):
            mcp_tools = get_tools_by_source("mcp")
            server_tools = {}
            for tool in mcp_tools:
                server_name = getattr(tool, "server_name", None)
                if isinstance(server_name, str) and server_name:
                    server_tools.setdefault(
                        server_name.casefold(),
                        {"name": server_name, "tools": []},
                    )["tools"].append(tool)
            requested_mcp_names = re.findall(
                r"(?<![\w/:])/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![\w.-])",
                text,
            )
            requested_server_keys = list(dict.fromkeys(
                name.casefold()
                for name in requested_mcp_names
                if name.casefold() in server_tools
            ))
            if requested_server_keys:
                requested_mcp_servers = [
                    server_tools[key]["name"] for key in requested_server_keys
                ]
                requested_mcp_tools = [
                    tool
                    for server_key in requested_server_keys
                    for tool in server_tools[server_key]["tools"]
                ]
                context["requested_mcp_servers"] = requested_mcp_servers
                context["requested_skill_tools"] = list(dict.fromkeys([
                    *context.get("requested_skill_tools", []),
                    *(tool.name for tool in requested_mcp_tools),
                ]))
                context["requested_mcp_instructions"] = (
                    "The user explicitly mentioned these connected MCP servers: "
                    + ", ".join(f"/{name}" for name in requested_mcp_servers)
                    + ". Prefer their tools when they are relevant to the request: "
                    + ", ".join(tool.name for tool in requested_mcp_tools)
                    + ". Do not call unrelated tools."
                )
        await self.task_manager.create_task(task_id, text, context=context)
        await self.state_manager.update_state(
            current_task_id=task_id,
            agent_status="busy",
        )
        execution = asyncio.create_task(self._execute_task(task_id, text, context))
        register = getattr(self.task_manager, "register_task_handle", None)
        if register is not None:
            await register(task_id, execution)

    async def _execute_task(self, task_id: str, text: str, context: dict):
        execution = asyncio.current_task()
        try:
            await self.orchestrator.execute_task(task_id, text, context=context)
        finally:
            unregister = getattr(self.task_manager, "unregister_task_handle", None)
            if unregister is not None:
                await unregister(task_id, execution)
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

    async def handle_gesture_action(self, _event_name: str, payload: dict):
        action = str(payload.get("action", "")).upper()
        if action == "SCREENSHOT_ANALYZE":
            await self.event_bus.publish(
                "USER_TEXT",
                {"text": "Analyze the current screen and summarize what is visible.", "input_source": "gesture"},
            )
            return
        if action == "TOGGLE_VOICE":
            await self.event_bus.publish("VOICE_TOGGLE", {"source": "gesture"})
            return
        if action != "CUSTOM_COMMAND":
            return
        command = payload.get("custom_command")
        if not isinstance(command, str) or not command.strip():
            return
        shell = self.orchestrator.tool_registry.get_tool("shell_tool")
        if shell is None:
            logger.error("Custom gesture command ignored: shell tool is unavailable")
            return
        task_id = str(uuid.uuid4())
        await self.task_manager.create_task(task_id, "Run custom hand command", context={"input_source": "gesture"})
        try:
            approved = await self.orchestrator.react_loop._request_tool_confirmation(
                shell,
                {"command": command},
                task_id,
            )
            if not approved:
                await self.task_manager.update_status(task_id, TaskStatus.CANCELLED)
                return
            result = await shell.execute({"command": command})
            if result.success:
                await self.task_manager.set_result(task_id, result=result.output)
                await self.task_manager.update_status(task_id, TaskStatus.COMPLETED)
            else:
                await self.task_manager.set_result(task_id, result=None, error=str(result.error))
                await self.task_manager.update_status(task_id, TaskStatus.FAILED)
        except Exception as error:
            logger.exception("Custom gesture command failed")
            await self.task_manager.set_result(task_id, result=None, error=type(error).__name__)
            await self.task_manager.update_status(task_id, TaskStatus.FAILED)
