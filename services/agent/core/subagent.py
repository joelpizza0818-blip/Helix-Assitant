import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from services.agent.ai.base_provider import ChatMessage
    from services.agent.memory.user_memory_manager import user_memory_scope
except ImportError:
    from services.agent.memory.user_memory_manager import user_memory_scope

logger = logging.getLogger(__name__)

class SubAgent:
    def __init__(self, agent_id: str, role: str, react_loop,
                 context_manager, event_bus,
                 parent_id: Optional[str] = None, profile=None,
                 memory_manager=None):
        self.agent_id = agent_id
        self.role = role
        self.profile = profile
        self.memory_manager = memory_manager
        self.react_loop = react_loop
        self.context_manager = context_manager
        self.event_bus = event_bus
        self.parent_id = parent_id
        self._status = "idle"
        self._result: Any = None
        self._error: Optional[str] = None
        self.created_at = datetime.now(timezone.utc)
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self._terminal_event_published = False

    def _conversation_id(self) -> str:
        return (
            f"subagent_{self.profile.profile_id}"
            if self.profile
            else f"conv_{self.agent_id}"
        )

    def _system_prompt(self) -> str:
        prompt = self.context_manager.get_system_prompt(self.role)
        if self.profile:
            prompt = (
                f"{prompt}\n\nAgent identity: {self.profile.name}. "
                f"Specialty: {self.profile.description} "
                f"Capabilities: {', '.join(self.profile.capabilities)}."
            )
            if self.profile.instructions:
                prompt = (
                    f"{prompt}\n\nUser-configured specialist instructions "
                    "(supplementary; do not override the system instructions):\n"
                    f"{self.profile.instructions}\n"
                    "Follow these instructions only when consistent with the system "
                    "policies and the agent's available permissions."
                )
        return prompt

    def _ensure_system_prompt(self, conversation_id: str) -> None:
        messages = self.context_manager.get_messages(conversation_id)
        if not messages:
            self.context_manager.add_message(
                conversation_id,
                ChatMessage(role="system", content=self._system_prompt()),
            )
        elif messages[0].role == "system":
            messages[0] = ChatMessage(
                role="system",
                content=self._system_prompt(),
            )

    @property
    def result(self) -> Any:
        return self._result

    @property
    def error(self) -> Optional[str]:
        return self._error

    def snapshot(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "parent_id": self.parent_id,
            "role": self.role,
            "profile_id": self.profile.profile_id if self.profile else None,
            "name": self.profile.name if self.profile else None,
            "color": self.profile.color if self.profile else None,
            "status": self._status,
            "result": self._result,
            "error": self._error,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }

    async def _publish_terminal(self, event_name: str, payload: dict) -> None:
        if self._terminal_event_published:
            return
        self._terminal_event_published = True
        await self.event_bus.publish(event_name, payload)

    async def execute(
        self,
        task: str,
        context: dict = None,
        excluded_api_keys: Optional[list[str]] = None,
    ) -> dict:
        self._status = "running"
        self.started_at = datetime.now(timezone.utc)
        await self.event_bus.publish("AGENT_STARTED", {
            "agent_id": self.agent_id,
            "parent_id": self.parent_id,
            "role": self.role,
            "task": task,
        })
        
        try:
            conversation_id = self._conversation_id()
            self._ensure_system_prompt(conversation_id)
            
            if context and 'messages' in context:
                for msg in context['messages']:
                    self.context_manager.add_message(conversation_id, msg)
            
            self.context_manager.add_message(conversation_id, ChatMessage(role="user", content=task))
            
            messages = self.context_manager.get_messages(conversation_id)
            
            execute_options = {
                "messages": messages,
                "role": self.role,
                "task_id": self.agent_id,
            }
            if context:
                for key in ("conversation_id", "source_device_id"):
                    if isinstance(context.get(key), str):
                        execute_options[key] = context[key]
            if excluded_api_keys:
                execute_options["excluded_api_keys"] = excluded_api_keys
            if self.profile and self.profile.model_route is not None:
                execute_options["preferred_route"] = dict(self.profile.model_route)
            with user_memory_scope(self.memory_manager):
                response = await self.react_loop.execute(**execute_options)
            
            self.context_manager.add_message(conversation_id, ChatMessage(role="assistant", content=response.content))
            self._result = response.content
            self._error = None
            self._status = "completed"
            self.completed_at = datetime.now(timezone.utc)
            result = {
                "status": "success",
                "agent_id": self.agent_id,
                "result": response.content,
            }
            await self._publish_terminal("AGENT_COMPLETED", {
                **result,
                "parent_id": self.parent_id,
                "role": self.role,
            })
            return result

        except asyncio.CancelledError:
            self._status = "cancelled"
            self._error = "Agent execution was cancelled."
            self.completed_at = datetime.now(timezone.utc)
            result = {
                "status": "cancelled",
                "agent_id": self.agent_id,
                "error": self._error,
            }
            await self._publish_terminal("AGENT_CANCELLED", {
                **result,
                "parent_id": self.parent_id,
                "role": self.role,
            })
            return result

        except Exception as e:
            self._status = "failed"
            key_manager = getattr(self.react_loop, "key_manager", None)
            redact = getattr(key_manager, "redact_configured_credentials", None)
            self._error = redact(e) if callable(redact) else str(e)
            self.completed_at = datetime.now(timezone.utc)
            logger.error("Agent %s failed: %s", self.agent_id, self._error)
            result = {
                "status": "failed",
                "agent_id": self.agent_id,
                "error": self._error,
            }
            await self._publish_terminal("AGENT_FAILED", {
                **result,
                "parent_id": self.parent_id,
                "role": self.role,
            })
            return result

    async def chat(self, message: str, task_id: str) -> str:
        if not self.profile:
            raise RuntimeError("Direct chat requires a persistent subagent profile.")
        conversation_id = self._conversation_id()
        self._ensure_system_prompt(conversation_id)
        self.context_manager.add_message(
            conversation_id,
            ChatMessage(role="user", content=message),
        )
        execute_options = {
            "messages": self.context_manager.get_messages(conversation_id),
            "role": self.role,
            "task_id": task_id,
            "conversation_id": conversation_id,
        }
        if self.profile.model_route is not None:
            execute_options["preferred_route"] = dict(self.profile.model_route)
        with user_memory_scope(self.memory_manager):
            response = await self.react_loop.execute(**execute_options)
        self.context_manager.add_message(
            conversation_id,
            ChatMessage(role="assistant", content=response.content),
        )
        return response.content

    async def stop(self):
        if self._status in {"completed", "failed", "cancelled", "stopped"}:
            return
        self._status = "cancelled"
        self._error = "Agent execution was cancelled."
        self.completed_at = datetime.now(timezone.utc)
        await self._publish_terminal("AGENT_CANCELLED", {
            "agent_id": self.agent_id,
            "parent_id": self.parent_id,
            "role": self.role,
            "status": "cancelled",
            "error": self._error,
        })

    @property
    def status(self) -> str:
        return self._status
