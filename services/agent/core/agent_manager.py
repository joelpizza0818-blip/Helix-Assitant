import asyncio
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from services.agent.core.subagent import SubAgent
except ModuleNotFoundError:
    from core.subagent import SubAgent


@dataclass
class AgentRecord:
    """Stable lifecycle information for a delegated agent."""

    agent_id: str
    task: str
    role: str
    parent_id: Optional[str] = None
    status: str = "queued"
    result: Any = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def snapshot(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "task": self.task,
            "role": self.role,
            "parent_id": self.parent_id,
            "status": self.status,
            "result": deepcopy(self.result),
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class AgentManager:
    def __init__(
        self,
        react_loop,
        context_manager,
        event_bus,
        role_config,
        tool_registry,
        task_manager=None,
    ):
        self.react_loop = react_loop
        self.context_manager = context_manager
        self.event_bus = event_bus
        self.role_config = role_config
        self.tool_registry = tool_registry
        self.task_manager = task_manager
        self.agents: Dict[str, SubAgent] = {}
        # Retain completed handles so wait_for_agent remains reliable.
        self.tasks: Dict[str, asyncio.Task] = {}
        self.records: Dict[str, AgentRecord] = {}
        self._cancel_callback_registered = False
        self._lock = asyncio.Lock()

    async def attach_task_manager(self, task_manager) -> None:
        self.task_manager = task_manager
        if not self._cancel_callback_registered:
            await task_manager.register_cancel_callback(self._handle_task_cancelled)
            self._cancel_callback_registered = True

    async def spawn_agent(self, role: str, task: str, parent_id: str = None) -> SubAgent:
        agent_id = str(uuid.uuid4())
        agent = SubAgent(
            agent_id=agent_id,
            role=role,
            react_loop=self.react_loop,
            context_manager=self.context_manager,
            event_bus=self.event_bus,
            parent_id=parent_id,
        )
        async with self._lock:
            self.agents[agent_id] = agent
            self.records[agent_id] = AgentRecord(
                agent_id=agent_id,
                task=task,
                role=role,
                parent_id=parent_id,
            )
        return agent

    async def delegate_task(
        self,
        task: str,
        role: str,
        parent_id: str = None,
        context: Optional[dict] = None,
    ) -> asyncio.Task:
        agent = await self.spawn_agent(role, task, parent_id)
        agent_id = agent.agent_id
        if self.task_manager is not None:
            await self.task_manager.create_task(
                agent_id,
                task,
                context={
                    **deepcopy(context or {}),
                    "agent_id": agent_id,
                    "parent_id": parent_id,
                    "role": role,
                    "task_type": "subagent",
                },
                parent_id=parent_id,
                role=role,
                metadata={"agent_id": agent_id, "task_type": "subagent"},
            )

        handle = asyncio.create_task(self._run_agent(agent, task, context))
        async with self._lock:
            self.tasks[agent_id] = handle
        if self.task_manager is not None:
            await self.task_manager.register_task_handle(agent_id, handle)
        await self.event_bus.publish(
            "SUBAGENT_SPAWNED",
            {
                "agent_id": agent_id,
                "parent_id": parent_id,
                "role": role,
                "task": task,
                "status": "queued",
            },
        )
        return handle

    async def _run_agent(self, agent: SubAgent, task: str, context: Optional[dict]) -> dict:
        agent_id = agent.agent_id
        record = self.records[agent_id]
        record.status = "running"
        record.started_at = datetime.now(timezone.utc)
        if self.task_manager is not None:
            await self.task_manager.update_status(agent_id, self._task_status("running"))
        await self.event_bus.publish("SUBAGENT_STATUS_CHANGED", record.snapshot())

        try:
            result = await agent.execute(task, context=context)
        except asyncio.CancelledError:
            result = {
                "status": "cancelled",
                "agent_id": agent_id,
                "error": "Agent execution was cancelled.",
            }

        status = result.get("status", "failed") if isinstance(result, dict) else "failed"
        record.status = {
            "success": "completed",
            "completed": "completed",
            "cancelled": "cancelled",
            "failed": "failed",
        }.get(status, "failed")
        record.result = result.get("result") if isinstance(result, dict) else None
        record.error = result.get("error") if isinstance(result, dict) else "Invalid agent result"
        record.completed_at = datetime.now(timezone.utc)

        if self.task_manager is not None:
            await self.task_manager.set_result(agent_id, result=record.result, error=record.error)
            await self.task_manager.update_status(agent_id, self._task_status(record.status))
            await self.task_manager.unregister_task_handle(agent_id, asyncio.current_task())

        event_name = {
            "completed": "SUBAGENT_COMPLETED",
            "cancelled": "SUBAGENT_CANCELLED",
            "failed": "SUBAGENT_FAILED",
        }[record.status]
        await self.event_bus.publish(event_name, record.snapshot())
        await self.event_bus.publish("SUBAGENT_STATUS_CHANGED", record.snapshot())
        return {
            "status": "success" if record.status == "completed" else record.status,
            "agent_id": agent_id,
            "result": record.result,
            "error": record.error,
        }

    @staticmethod
    def _task_status(status: str):
        try:
            from services.agent.core.task_manager import TaskStatus
        except ModuleNotFoundError:
            from core.task_manager import TaskStatus
        return {
            "running": TaskStatus.RUNNING,
            "completed": TaskStatus.COMPLETED,
            "cancelled": TaskStatus.CANCELLED,
            "failed": TaskStatus.FAILED,
        }[status]

    async def delegate_parallel(self, tasks: List[dict]) -> List[dict]:
        handles = [
            await self.delegate_task(
                t["task"],
                role=t.get("role", "main"),
                parent_id=t.get("parent_id"),
                context=t.get("context"),
            )
            for t in tasks
        ]
        results = await asyncio.gather(*handles, return_exceptions=True)
        normalized = []
        for handle, result in zip(handles, results):
            if isinstance(result, BaseException):
                normalized.append({
                    "status": "failed",
                    "agent_id": self._agent_id_for_handle(handle),
                    "error": str(result),
                })
            else:
                normalized.append(result)
        return normalized

    def _agent_id_for_handle(self, handle: asyncio.Task) -> Optional[str]:
        for agent_id, candidate in self.tasks.items():
            if candidate is handle:
                return agent_id
        return None

    async def get_agent(self, agent_id: str) -> Optional[SubAgent]:
        return self.agents.get(agent_id)

    async def get_status(self, agent_id: str) -> Optional[dict]:
        record = self.records.get(agent_id)
        return record.snapshot() if record is not None else None

    async def get_all_statuses(self, parent_id: Optional[str] = None) -> List[dict]:
        records = self.records.values()
        if parent_id is not None:
            records = (record for record in records if record.parent_id == parent_id)
        return [record.snapshot() for record in records]

    async def kill_agent(self, agent_id: str):
        agent = self.agents.get(agent_id)
        if agent is None:
            return False
        await agent.stop()
        if self.task_manager is not None:
            await self.task_manager.cancel(agent_id, notify=False)
        handle = self.tasks.get(agent_id)
        if handle is not None and not handle.done():
            handle.cancel()
        return True

    async def cancel_parent(self, parent_id: str) -> int:
        # Walk the ownership tree so cancelling a parent cannot leave a
        # grandchild agent running after its direct parent is stopped.
        parents = {parent_id}
        agent_ids = []
        changed = True
        while changed:
            changed = False
            for agent_id, record in self.records.items():
                if (
                    record.parent_id in parents
                    and agent_id not in agent_ids
                    and record.status not in {"completed", "failed", "cancelled"}
                ):
                    agent_ids.append(agent_id)
                    if agent_id not in parents:
                        parents.add(agent_id)
                        changed = True
        for agent_id in agent_ids:
            await self.kill_agent(agent_id)
        return len(agent_ids)

    async def _handle_task_cancelled(self, task_id: str) -> None:
        if task_id in self.agents:
            await self.kill_agent(task_id)
        else:
            await self.cancel_parent(task_id)

    async def get_all_agents(self) -> List[SubAgent]:
        return list(self.agents.values())

    async def wait_for_agent(self, agent_id: str, timeout: float = None) -> dict:
        handle = self.tasks.get(agent_id)
        if handle is None:
            return {
                "status": "error",
                "agent_id": agent_id,
                "error": "Agent task not found.",
            }
        try:
            if timeout is not None:
                return await asyncio.wait_for(asyncio.shield(handle), timeout)
            return await handle
        except asyncio.TimeoutError:
            return {
                "status": "timeout",
                "agent_id": agent_id,
                "error": "Agent timed out.",
            }
