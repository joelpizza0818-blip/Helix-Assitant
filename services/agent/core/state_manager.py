import asyncio
from dataclasses import dataclass
from typing import Optional

@dataclass
class AgentState:
    agent_status: str = "idle"
    current_task_id: Optional[str] = None
    active_model: Optional[str] = None
    active_provider: Optional[str] = None
    active_key_slot: Optional[int] = None
    voice_active: bool = False
    camera_active: bool = False
    last_command: Optional[str] = None
    last_response: Optional[str] = None
    current_confirmation_pending: bool = False
    active_confirmation_id: Optional[str] = None
    uptime: float = 0.0
    error_state: Optional[str] = None

class StateManager:
    def __init__(self):
        self._state = AgentState()
        self._lock = asyncio.Lock()

    async def update_state(self, **kwargs):
        async with self._lock:
            for key, value in kwargs.items():
                if hasattr(self._state, key):
                    setattr(self._state, key, value)

    async def get_state(self) -> AgentState:
        async with self._lock:
            from copy import deepcopy
            return deepcopy(self._state)
