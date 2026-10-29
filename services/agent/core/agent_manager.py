import asyncio
import uuid
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from services.agent.core.subagent import SubAgent
    from services.agent.core.agent_profiles import AgentProfileStore
    from services.agent.memory.user_memory_manager import UserMemoryManager
except ModuleNotFoundError:
    from core.subagent import SubAgent
    from core.agent_profiles import AgentProfileStore
    from memory.user_memory_manager import UserMemoryManager


@dataclass
class AgentRecord:
    """Stable lifecycle information for a delegated agent."""

    agent_id: str
    task: str
    role: str
    profile_id: Optional[str] = None
    name: Optional[str] = None
    color: Optional[str] = None
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
            "profile_id": self.profile_id,
            "name": self.name,
            "color": self.color,
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
        profile_store=None,
        memory_directory: Optional[Path] = None,
    ):
        self.react_loop = react_loop
        self.context_manager = context_manager
        self.event_bus = event_bus
        self.role_config = role_config
        self.tool_registry = tool_registry
        self.task_manager = task_manager
        self.profile_store = profile_store or AgentProfileStore()
        self.memory_directory = memory_directory
        self._profile_memories: Dict[str, UserMemoryManager] = {}
        self.agents: Dict[str, SubAgent] = {}
        # Retain completed handles so wait_for_agent remains reliable.
        self.tasks: Dict[str, asyncio.Task] = {}
        self.records: Dict[str, AgentRecord] = {}
        self._profile_locks: Dict[str, asyncio.Lock] = {}
        self._chat_agents: Dict[str, SubAgent] = {}
        self._execution_profiles: Dict[str, str] = {}
        self._peer_message_depth = ContextVar(
            "helix_subagent_peer_message_depth", default=0
        )
        self._cancel_callback_registered = False
        self._lock = asyncio.Lock()

    async def attach_task_manager(self, task_manager) -> None:
        self.task_manager = task_manager
        if not self._cancel_callback_registered:
            await task_manager.register_cancel_callback(self._handle_task_cancelled)
            self._cancel_callback_registered = True

    async def spawn_agent(
        self,
        role: str,
        task: str,
        parent_id: str = None,
        profile_id: Optional[str] = None,
    ) -> SubAgent:
        agent_id = str(uuid.uuid4())
        profile = self.profile_store.get(profile_id) if profile_id else None
        if profile is None and profile_id is not None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        selected_role = profile.role if profile is not None else role
        agent = SubAgent(
            agent_id=agent_id,
            role=selected_role,
            profile=profile,
            react_loop=self.react_loop,
            context_manager=self.context_manager,
            event_bus=self.event_bus,
            parent_id=parent_id,
            memory_manager=self._memory_manager(profile.profile_id) if profile else None,
        )
        async with self._lock:
            self.agents[agent_id] = agent
            self.records[agent_id] = AgentRecord(
                agent_id=agent_id,
                task=task,
                role=selected_role,
                profile_id=profile.profile_id if profile else None,
                name=profile.name if profile else None,
                color=profile.color if profile else None,
                parent_id=parent_id,
            )
        return agent

    async def delegate_task(
        self,
        task: str,
        role: str,
        parent_id: str = None,
        context: Optional[dict] = None,
        excluded_api_keys: Optional[List[str]] = None,
        profile_id: Optional[str] = None,
        new_profile: Optional[dict] = None,
    ) -> asyncio.Task:
        if new_profile is not None:
            if profile_id is not None:
                raise ValueError("Choose an existing subagent or create a new profile, not both.")
            if not isinstance(new_profile, dict):
                raise ValueError("New subagent profile must be an object.")
            profile = self.profile_store.create(
                name=new_profile.get("name", ""),
                role=new_profile.get("role", ""),
                description=new_profile.get("description", ""),
                capabilities=new_profile.get("capabilities", []),
                color=new_profile.get("color", ""),
            )
            profile_id = profile.profile_id
        agent = await self.spawn_agent(role, task, parent_id, profile_id)
        agent_id = agent.agent_id
        record = self.records[agent_id]
        if self.task_manager is not None:
            await self.task_manager.create_task(
                agent_id,
                task,
                context={
                    **deepcopy(context or {}),
                    "agent_id": agent_id,
                    "parent_id": parent_id,
                    "role": agent.role,
                    "profile_id": record.profile_id,
                    "task_type": "subagent",
                },
                parent_id=parent_id,
                role=agent.role,
                metadata={
                    "agent_id": agent_id,
                    "profile_id": record.profile_id,
                    "task_type": "subagent",
                },
            )

        handle = asyncio.create_task(
            self._run_agent(agent, task, context, excluded_api_keys)
        )
        async with self._lock:
            self.tasks[agent_id] = handle
        if self.task_manager is not None:
            await self.task_manager.register_task_handle(agent_id, handle)
        await self.event_bus.publish(
            "SUBAGENT_SPAWNED",
            {
                "agent_id": agent_id,
                "parent_id": parent_id,
                "role": agent.role,
                "profile_id": record.profile_id,
                "name": record.name,
                "color": record.color,
                "task": task,
                "status": "queued",
            },
        )
        return handle

    async def _run_agent(
        self,
        agent: SubAgent,
        task: str,
        context: Optional[dict],
        excluded_api_keys: Optional[List[str]] = None,
    ) -> dict:
        agent_id = agent.agent_id
        record = self.records[agent_id]

        async def mark_running() -> None:
            record.status = "running"
            record.started_at = datetime.now(timezone.utc)
            if self.task_manager is not None:
                await self.task_manager.update_status(
                    agent_id, self._task_status("running")
                )
            await self.event_bus.publish(
                "SUBAGENT_STATUS_CHANGED", record.snapshot()
            )

        try:
            if record.profile_id:
                lock = self._profile_locks.setdefault(
                    record.profile_id, asyncio.Lock()
                )
                if lock.locked() and self.task_manager is not None:
                    await self.task_manager.set_progress_label(
                        agent_id,
                        f"Waiting for {record.name or record.role}",
                        current_action=f"Waiting for {record.name or record.role}",
                    )
                async with lock:
                    await mark_running()
                    result = await agent.execute(
                        task,
                        context=context,
                        excluded_api_keys=excluded_api_keys,
                    )
            else:
                await mark_running()
                result = await agent.execute(
                    task,
                    context=context,
                    excluded_api_keys=excluded_api_keys,
                )
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
            "profile_id": record.profile_id,
            "name": record.name,
            "color": record.color,
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

    async def chat_with_agent(
        self,
        profile_id: str,
        message: str,
        *,
        peer: bool = False,
    ) -> dict:
        profile = self.profile_store.get(profile_id)
        if profile is None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        if not isinstance(message, str) or not message.strip() or len(message) > 4000:
            raise ValueError("Subagent message must contain 1 to 4000 characters.")
        depth = self._peer_message_depth.get()
        if peer and depth >= 2:
            raise RuntimeError("Subagent-to-subagent message depth limit reached.")
        token = self._peer_message_depth.set(depth + 1) if peer else None
        agent = self._chat_agents.get(profile_id)
        if agent is None:
            agent = SubAgent(
                agent_id=f"profile-chat-{profile_id}",
                role=profile.role,
                profile=profile,
                react_loop=self.react_loop,
                context_manager=self.context_manager,
                event_bus=self.event_bus,
                memory_manager=self._memory_manager(profile_id),
            )
            self._chat_agents[profile_id] = agent

        task_id = f"subagent-chat-{profile_id}-{uuid.uuid4()}"
        self._execution_profiles[task_id] = profile_id
        lock = self._profile_locks.setdefault(profile_id, asyncio.Lock())
        try:
            async with lock:
                response = await agent.chat(message.strip(), task_id)
            return {
                "profile_id": profile.profile_id,
                "name": profile.name,
                "color": profile.color,
                "response": response,
            }
        finally:
            self._execution_profiles.pop(task_id, None)
            if token is not None:
                self._peer_message_depth.reset(token)

    def _memory_manager(self, profile_id: str) -> Optional[UserMemoryManager]:
        if self.memory_directory is None:
            return None
        manager = self._profile_memories.get(profile_id)
        if manager is None:
            self.memory_directory.mkdir(parents=True, exist_ok=True)
            manager = UserMemoryManager(self.memory_directory / f"{profile_id}.json")
            self._profile_memories[profile_id] = manager
        return manager

    def get_profile_memories(self, profile_id: str) -> list[dict]:
        if self.profile_store.get(profile_id) is None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        manager = self._memory_manager(profile_id)
        return manager.load_all() if manager is not None else []

    def save_profile_memory(
        self, profile_id: str, text: str, category: str = "general"
    ) -> dict:
        if self.profile_store.get(profile_id) is None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        manager = self._memory_manager(profile_id)
        if manager is None:
            raise RuntimeError("Subagent memory storage is not configured.")
        return manager.add_memory(text, category)

    def update_profile_memory(
        self,
        profile_id: str,
        memory_id: str,
        text: str,
        category: str = "general",
    ) -> Optional[dict]:
        if self.profile_store.get(profile_id) is None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        manager = self._memory_manager(profile_id)
        if manager is None:
            raise RuntimeError("Subagent memory storage is not configured.")
        return manager.update_memory(memory_id, text, category)

    def delete_profile_memory(self, profile_id: str, memory_id: str) -> bool:
        if self.profile_store.get(profile_id) is None:
            raise ValueError(f"Unknown subagent profile: {profile_id}.")
        manager = self._memory_manager(profile_id)
        if manager is None:
            raise RuntimeError("Subagent memory storage is not configured.")
        return manager.delete_memory(memory_id)

    async def promote_profile(
        self,
        profile_id: str,
        work: str,
        capabilities: list[str],
    ) -> dict:
        profile = self.profile_store.promote(profile_id, work, capabilities)
        await self.event_bus.publish(
            "SUBAGENT_PROMOTED",
            {
                "profile_id": profile.profile_id,
                "name": profile.name,
                "color": profile.color,
                "promotion": work.strip(),
                "status": "promoted",
            },
        )
        return profile.public_dict()

    def create_profile(
        self,
        *,
        name: str,
        role: str,
        description: str,
        capabilities: list[str],
        color: str,
        instructions: str = "",
        created_by: str = "user",
    ) -> dict:
        return self.profile_store.create(
            name=name,
            role=role,
            description=description,
            capabilities=capabilities,
            color=color,
            instructions=instructions,
            created_by=created_by,
        ).public_dict()

    def update_profile(
        self,
        profile_id: str,
        *,
        name: str,
        role: str,
        description: str,
        capabilities: list[str],
        color: str,
        instructions: str,
    ) -> dict:
        return self.profile_store.update(
            profile_id,
            name=name,
            role=role,
            description=description,
            capabilities=capabilities,
            color=color,
            instructions=instructions,
        ).public_dict()

    def is_subagent_task(self, task_id: str) -> bool:
        return task_id in self.records or task_id in self._execution_profiles

    async def message_agent_from_task(
        self,
        parent_id: str,
        target_profile_id: str,
        message: str,
    ) -> dict:
        record = self.records.get(parent_id)
        source_profile_id = (
            record.profile_id if record is not None
            else self._execution_profiles.get(parent_id)
        )
        if source_profile_id == target_profile_id:
            raise ValueError("A subagent cannot send a message to itself.")
        source = self.profile_store.get(source_profile_id) if source_profile_id else None
        if source_profile_id and source is None:
            raise ValueError("The sender profile is no longer available.")
        sender_name = source.name if source else "HELIX"
        return await self.chat_with_agent(
            target_profile_id,
            f"{sender_name} asks: {message.strip()}",
            peer=True,
        )

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
