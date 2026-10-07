import uuid
import asyncio
from typing import List, Optional, Dict
try:
    from services.agent.core.subagent import SubAgent
except ModuleNotFoundError:
    from core.subagent import SubAgent

class AgentManager:
    def __init__(self, react_loop, context_manager, event_bus, role_config, tool_registry):
        self.react_loop = react_loop
        self.context_manager = context_manager
        self.event_bus = event_bus
        self.role_config = role_config
        self.tool_registry = tool_registry
        self.agents: Dict[str, SubAgent] = {}
        self.tasks: Dict[str, asyncio.Task] = {}

    async def spawn_agent(self, role: str, task: str, parent_id: str = None) -> SubAgent:
        agent_id = str(uuid.uuid4())
        agent = SubAgent(
            agent_id=agent_id,
            role=role,
            react_loop=self.react_loop,
            context_manager=self.context_manager,
            event_bus=self.event_bus,
            parent_id=parent_id
        )
        self.agents[agent_id] = agent
        return agent

    async def delegate_task(self, task: str, role: str, parent_id: str = None) -> asyncio.Task:
        agent = await self.spawn_agent(role, task, parent_id)
        coro = agent.execute(task)
        task_handle = asyncio.create_task(coro)
        self.tasks[agent.agent_id] = task_handle
        return task_handle

    async def delegate_parallel(self, tasks: List[dict]) -> List[dict]:
        handles = []
        for t in tasks:
            h = await self.delegate_task(t["task"], t["role"], t.get("parent_id"))
            handles.append(h)
        results = await asyncio.gather(*handles, return_exceptions=True)
        return list(results)

    async def get_agent(self, agent_id: str) -> Optional[SubAgent]:
        return self.agents.get(agent_id)

    async def kill_agent(self, agent_id: str):
        if agent_id in self.agents:
            await self.agents[agent_id].stop()
        if agent_id in self.tasks:
            self.tasks[agent_id].cancel()

    async def get_all_agents(self) -> List[SubAgent]:
        return list(self.agents.values())

    async def wait_for_agent(self, agent_id: str, timeout: float = None) -> dict:
        if agent_id in self.tasks:
            if timeout:
                return await asyncio.wait_for(self.tasks[agent_id], timeout)
            return await self.tasks[agent_id]
        return {"status": "error", "error": "Agent task not found."}
