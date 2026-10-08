import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from services.agent.ai.base_provider import ChatMessage
except ImportError:
    pass

logger = logging.getLogger(__name__)

class SubAgent:
    def __init__(self, agent_id: str, role: str, react_loop,
                 context_manager, event_bus,
                 parent_id: Optional[str] = None):
        self.agent_id = agent_id
        self.role = role
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

    async def execute(self, task: str, context: dict = None) -> dict:
        self._status = "running"
        self.started_at = datetime.now(timezone.utc)
        await self.event_bus.publish("AGENT_STARTED", {
            "agent_id": self.agent_id,
            "parent_id": self.parent_id,
            "role": self.role,
            "task": task,
        })
        
        try:
            conversation_id = f"conv_{self.agent_id}"
            system_prompt = self.context_manager.get_system_prompt(self.role)
            self.context_manager.add_message(conversation_id, ChatMessage(role="system", content=system_prompt))
            
            if context and 'messages' in context:
                for msg in context['messages']:
                    self.context_manager.add_message(conversation_id, msg)
            
            self.context_manager.add_message(conversation_id, ChatMessage(role="user", content=task))
            
            messages = self.context_manager.get_messages(conversation_id)
            
            response = await self.react_loop.execute(
                messages=messages,
                role=self.role,
                task_id=self.agent_id
            )
            
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
            self._error = str(e)
            self.completed_at = datetime.now(timezone.utc)
            logger.error(f"Agent {self.agent_id} failed: {e}")
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
