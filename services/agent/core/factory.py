"""Agent Runtime Factory.

Decouples dependency injection, event wireup, and initialization from main.py.
"""

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class AgentRuntimeContext:
    event_bus: Any
    task_manager: Any
    state_manager: Any
    planner: Any
    tool_registry: Any
    provider_registry: Any
    model_router: Any
    fallback_manager: Any
    skill_registry: Any
    mcp_manager: Any
    permission_manager: Any
    orchestrator: Any
    agent_manager: Any
    desktop_bridge: Any


class AgentRuntimeFactory:
    """Factory responsible for wiring agent subsystems together."""

    @staticmethod
    def create_minimal_context(
        event_bus: Any,
        task_manager: Any,
        state_manager: Any,
        tool_registry: Any,
        orchestrator: Any,
        desktop_bridge: Any,
        **kwargs: Any,
    ) -> AgentRuntimeContext:
        """Constructs and returns an AgentRuntimeContext container."""
        return AgentRuntimeContext(
            event_bus=event_bus,
            task_manager=task_manager,
            state_manager=state_manager,
            planner=kwargs.get("planner"),
            tool_registry=tool_registry,
            provider_registry=kwargs.get("provider_registry"),
            model_router=kwargs.get("model_router"),
            fallback_manager=kwargs.get("fallback_manager"),
            skill_registry=kwargs.get("skill_registry"),
            mcp_manager=kwargs.get("mcp_manager"),
            permission_manager=kwargs.get("permission_manager"),
            orchestrator=orchestrator,
            agent_manager=kwargs.get("agent_manager"),
            desktop_bridge=desktop_bridge,
        )
