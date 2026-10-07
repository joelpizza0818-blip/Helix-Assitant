import asyncio
import logging
import json
import re
from datetime import datetime, timezone
from typing import Dict

try:
    from services.agent.core.task_manager import TaskStatus
    from services.agent.core.planner import PlanStep
    from services.agent.ai.base_provider import ChatMessage
except ImportError:
    pass

logger = logging.getLogger(__name__)
_SCREEN_ACTION_INTENT = re.compile(
    r"\b(screen|screenshot|pantalla|ventana|window|desktop|escritorio|"
    r"click|clic|cursor|mouse|teclado|keyboard|word|excel|notepad|"
    r"abre|abrir|open\s+(?:the\s+)?(?:app|application|word|excel)|"
    r"escribe\s+en|type\s+(?:into|in)|paste|pega|drag|arrastra)\b",
    re.IGNORECASE,
)

class Orchestrator:
    def __init__(self, planner, task_manager, event_bus, react_loop, 
                 agent_manager, tool_registry, role_config):
        self.planner = planner
        self.task_manager = task_manager
        self.event_bus = event_bus
        self.react_loop = react_loop
        self.agent_manager = agent_manager
        self.tool_registry = tool_registry
        self.role_config = role_config

    async def execute_task(self, task_id: str, description: str, context: dict = None):
        await self.task_manager.update_status(task_id, TaskStatus.RUNNING)
        await self.event_bus.publish("ORCHESTRATION_STARTED", {"task_id": task_id})
        
        context = context or {}

        if context.get("input_source") in {"voice", "text"}:
            input_source = context["input_source"]
            conversation_type = (
                "spoken conversation" if input_source == "voice" else "conversation"
            )
            history = context.get("conversation_history") or [
                {"role": "user", "content": description}
            ]
            messages = [
                ChatMessage(
                    role="system",
                    content=(
                        "You are HELIX, a conversational desktop assistant. Reply "
                        "naturally and clearly in the user's language, keep the "
                        f"context of this {conversation_type}, and use available "
                        "tools when needed. For desktop actions, inspect the provided "
                        "screen observation before acting; after using a computer or "
                        "keyboard tool, inspect its captured result. "
                        "Never claim to have performed an action unless a tool "
                        "reported that it succeeded."
                    ),
                )
            ]
            messages.extend(
                ChatMessage(role=message["role"], content=message["content"])
                for message in history
                if message.get("role") in {"user", "assistant"}
                and isinstance(message.get("content"), str)
            )
            if _SCREEN_ACTION_INTENT.search(description):
                observe_tool = self.tool_registry.get_tool("computer.observe_screen")
                observation = await observe_tool.execute({}) if observe_tool else None
                if observation is not None and observation.success:
                    observed = observation.output
                    screenshot = observed.pop("screenshot_bytes", None)
                    screen_summary = json.dumps(
                        observed,
                        ensure_ascii=False,
                        default=str,
                    )
                    messages.append(ChatMessage(
                        role="user",
                        content=(
                            "Screen observation before acting (structured window, "
                            f"accessibility, and OCR context):\n{screen_summary}"
                        ),
                        image_bytes=screenshot,
                    ))
                else:
                    error = (
                        observation.error
                        if observation is not None
                        else "Screen observation tool is unavailable."
                    )
                    messages.append(ChatMessage(
                        role="user",
                        content=(
                            "Screen observation before acting failed. Do not claim "
                            f"to know what is visible. Error: {error}"
                        ),
                    ))
            try:
                response = await self.react_loop.execute(
                    messages,
                    role="main",
                    task_id=task_id,
                )
            except Exception as error:
                logger.exception("Conversation task %s failed", task_id)
                await self.task_manager.update_status(task_id, TaskStatus.FAILED)
                await self.event_bus.publish(
                    "AGENT_MESSAGE",
                    {
                        "task_id": task_id,
                        "role": "assistant",
                        "content": "No pude completar la solicitud. Revisa la configuración del proveedor de IA y vuelve a intentarlo.",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self.event_bus.publish(
                    "ORCHESTRATION_FAILED",
                    {
                        "task_id": task_id,
                        "input_source": input_source,
                        "conversation_id": context.get("conversation_id"),
                        "error": type(error).__name__,
                    },
                )
                return

            if not isinstance(response.content, str) or not response.content.strip():
                logger.error("Conversation task %s completed with an empty model response.", task_id)
                await self.task_manager.update_status(task_id, TaskStatus.FAILED)
                await self.event_bus.publish(
                    "AGENT_MESSAGE",
                    {
                        "task_id": task_id,
                        "role": "assistant",
                        "content": "El modelo no devolvió una respuesta. Inténtalo de nuevo o revisa el proveedor configurado.",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self.event_bus.publish(
                    "ORCHESTRATION_FAILED",
                    {
                        "task_id": task_id,
                        "input_source": input_source,
                        "conversation_id": context.get("conversation_id"),
                        "error": "EMPTY_MODEL_RESPONSE",
                    },
                )
                return

            await self.task_manager.update_status(task_id, TaskStatus.COMPLETED)
            await self.event_bus.publish(
                "AGENT_MESSAGE",
                {
                    "task_id": task_id,
                    "role": "assistant",
                    "content": response.content,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": getattr(response, "model", None),
                    "provider": getattr(response, "provider", None),
                },
            )
            await self.event_bus.publish(
                "ORCHESTRATION_COMPLETED",
                {
                    "task_id": task_id,
                    "response": response.content,
                    "input_source": input_source,
                    "conversation_id": context.get("conversation_id"),
                },
            )
            return
        
        plan = await self.planner.create_plan(description, context)
        
        completed_steps = set()
        in_progress: Dict[str, asyncio.Task] = {}
        results = {}
        
        async def execute_step(step):
            try:
                if step.action == 'delegate':
                    role = step.params.get('role', 'main')
                    task_desc = step.params.get('task', str(step.params))
                    agent_task = await self.agent_manager.delegate_task(task_desc, role=role, parent_id=task_id)
                    res = await agent_task
                    results[step.id] = res
                else:
                    tool = self.tool_registry.get_tool(step.action)
                    if tool:
                        res = await tool.execute(step.params)
                        results[step.id] = res.output if res.success else f"Error: {res.error}"
                    else:
                        msgs = [ChatMessage(role="user", content=json.dumps(step.params))]
                        res = await self.react_loop.execute(msgs, role="main", task_id=task_id)
                        results[step.id] = res.content
                completed_steps.add(step.id)
            except Exception as e:
                logger.error(f"Step {step.id} failed: {e}")
                results[step.id] = f"Failed: {e}"
                completed_steps.add(step.id)

        while len(completed_steps) < len(plan.steps):
            for step in plan.steps:
                if step.id not in completed_steps and step.id not in in_progress:
                    if all(dep in completed_steps for dep in step.dependencies):
                        in_progress[step.id] = asyncio.create_task(execute_step(step))
            
            if in_progress:
                done, _ = await asyncio.wait(in_progress.values(), return_when=asyncio.FIRST_COMPLETED)
                for d in done:
                    for k, v in list(in_progress.items()):
                        if v == d:
                            del in_progress[k]
                            break
            else:
                if len(completed_steps) < len(plan.steps):
                    break
                    
        await self.task_manager.update_status(task_id, TaskStatus.COMPLETED)
        await self.event_bus.publish("ORCHESTRATION_COMPLETED", {"task_id": task_id, "results": results})
