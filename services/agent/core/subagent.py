import logging
from typing import Optional

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

    async def execute(self, task: str, context: dict = None) -> dict:
        self._status = "running"
        await self.event_bus.publish("AGENT_STARTED", {"agent_id": self.agent_id, "task": task})
        
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
            self._status = "completed"
            await self.event_bus.publish("AGENT_COMPLETED", {"agent_id": self.agent_id})
            return {"status": "success", "result": response.content}
            
        except Exception as e:
            self._status = "failed"
            logger.error(f"Agent {self.agent_id} failed: {e}")
            await self.event_bus.publish("AGENT_FAILED", {"agent_id": self.agent_id, "error": str(e)})
            return {"status": "failed", "error": str(e)}

    async def stop(self):
        self._status = "stopped"
        await self.event_bus.publish("AGENT_STOPPED", {"agent_id": self.agent_id})

    @property
    def status(self) -> str:
        return self._status
