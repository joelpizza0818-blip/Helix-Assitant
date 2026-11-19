import asyncio
import logging
import re
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Set
from enum import Enum


logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    """Return a timezone-aware UTC datetime (replaces deprecated datetime.utcnow())."""
    return datetime.now(timezone.utc)


_SENSITIVE_VALUE = re.compile(
    r"(?i)\b(?:bearer\s+|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|"
    r"gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\S*"
)
_NAMED_SECRET = re.compile(
    r"(?i)(\b(?:api[_-]?key|authorization|password|secret|token|credential)\b"
    r"\s*[:=]\s*)(?:bearer\s+)?([^\s,;]+)"
)


def _safe_text(value: object, limit: int = 180) -> str:
    """Return a short display summary, never a raw model/tool payload."""
    text = " ".join(str(value).split())
    text = _NAMED_SECRET.sub(r"\1[REDACTED]", text)
    text = _SENSITIVE_VALUE.sub("[REDACTED]", text)
    if len(text) > limit:
        return f"{text[:limit - 1]}…"
    return text


def _safe_context_summary(context: object) -> dict:
    if not isinstance(context, dict):
        return {"labels": [], "item_count": 0}
    labels = []
    if context.get("input_source"):
        labels.append(f"{context['input_source']} input")
    if isinstance(context.get("conversation_history"), list):
        labels.append(f"conversation history ({len(context['conversation_history'])} messages)")
    if context.get("active_skills"):
        labels.append(f"active skills ({len(context['active_skills'])})")
    if context.get("requested_skills"):
        labels.append(f"requested skills ({len(context['requested_skills'])})")
    if context.get("messages"):
        labels.append(f"model messages ({len(context['messages'])})")
    if context.get("image_bytes") or context.get("screenshot_bytes"):
        labels.append("screen image omitted")
    return {"labels": labels, "item_count": len(context)}


def _safe_model_input_summary(request: object) -> dict:
    """Describe model input shape without exposing prompt/context contents."""
    if not isinstance(request, dict):
        return {"message_count": 0, "roles": [], "character_count": 0, "image_count": 0, "context_labels": []}
    messages = request.get("messages")
    roles = []
    character_count = 0
    image_count = 0
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            if isinstance(role, str) and role not in roles:
                roles.append(role)
            content = message.get("content")
            if isinstance(content, str):
                character_count += len(content)
            if message.get("image_bytes") or message.get("screenshot_bytes"):
                image_count += 1
    context_labels = _safe_context_summary(request.get("context")).get("labels", [])
    if request.get("_helix_task_id"):
        context_labels.append("task context")
    return {
        "message_count": len(messages) if isinstance(messages, list) else 0,
        "roles": roles,
        "character_count": character_count,
        "image_count": image_count,
        "context_labels": context_labels,
    }

class TaskStatus(Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    WAITING_CONFIRMATION = "waiting_confirmation"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"


@dataclass
class TaskExecutionSummary:
    model_input: dict = field(default_factory=lambda: {
        "message_count": 0,
        "roles": [],
        "character_count": 0,
        "image_count": 0,
        "context_labels": [],
    })
    context: dict = field(default_factory=lambda: {"labels": [], "item_count": 0})
    steps: List[dict] = field(default_factory=list)
    tool_calls: List[dict] = field(default_factory=list)
    progress_label: str = "Waiting in queue…"
    result: Optional[dict] = None

@dataclass
class Task:
    id: str
    description: str
    status: TaskStatus = TaskStatus.QUEUED
    priority: int = 0
    created_at: datetime = field(default_factory=_utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    current_action: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    cancelled: bool = False
    model: Optional[str] = None
    provider: Optional[str] = None
    required_permissions: List[str] = field(default_factory=list)
    model_requests: List[dict] = field(default_factory=list)
    parent_id: Optional[str] = None
    role: Optional[str] = None
    result: Any = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    progress: int = 0
    execution_summary: TaskExecutionSummary = field(default_factory=TaskExecutionSummary)

_STORED_METADATA_KEYS = {
    "task_type",
    "profile_id",
    "workflow_id",
    "resume_mode",
    "interrupted",
    "agent_id",
    "source",
    "is_subagent",
}
_STORED_CONTEXT_KEYS = {
    "input_source",
    "conversation_id",
    "project_id",
    "active_project_id",
    "workflow_id",
    "requested_skills",
}
_INTERRUPTED_STATUSES = {
    TaskStatus.QUEUED,
    TaskStatus.RUNNING,
    TaskStatus.RETRYING,
    TaskStatus.WAITING_CONFIRMATION,
}


def _parse_datetime(value: object) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


class TaskManager:
    def __init__(self, event_bus, store=None):
        self.tasks: Dict[str, Task] = {}
        self._task_contexts: Dict[str, dict] = {}
        self._task_handles: Dict[str, asyncio.Task] = {}
        self._cancel_callbacks: Set[Callable[[str], Awaitable[None]]] = set()
        self._resume_events: Dict[str, asyncio.Event] = {}
        self._store = store
        self._persist_handle: Optional[asyncio.Task] = None
        self._persist_debounce_seconds = 0.25
        self.lock = asyncio.Lock()
        self.event_bus = event_bus

    @staticmethod
    def _snapshot_metadata(metadata: object) -> dict:
        if not isinstance(metadata, dict):
            return {}
        snapshot = {}
        for key in _STORED_METADATA_KEYS:
            value = metadata.get(key)
            if isinstance(value, bool):
                snapshot[key] = value
            elif isinstance(value, (int, float)):
                snapshot[key] = value
            elif isinstance(value, str):
                snapshot[key] = _safe_text(value, 160)
        return snapshot

    @staticmethod
    def _snapshot_context(context: object) -> dict:
        if not isinstance(context, dict):
            return {}
        snapshot = {}
        for key in _STORED_CONTEXT_KEYS:
            value = context.get(key)
            if isinstance(value, str):
                snapshot[key] = _safe_text(value, 200)
            elif isinstance(value, list) and all(
                isinstance(item, str) for item in value
            ):
                snapshot[key] = [_safe_text(item, 120) for item in value[:20]]
        return snapshot

    @classmethod
    def _task_snapshot(cls, task: Task, context: object = None) -> dict:
        summary = task.execution_summary
        result = summary.result if isinstance(summary.result, dict) else None
        return {
            "id": task.id,
            "description": _safe_text(task.description, 500),
            "status": task.status.value,
            "priority": task.priority,
            "created_at": task.created_at.isoformat(),
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "current_action": _safe_text(task.current_action, 200) if task.current_action else None,
            "logs": [_safe_text(item, 300) for item in task.logs[-50:]],
            "cancelled": task.cancelled,
            "model": task.model,
            "provider": task.provider,
            "required_permissions": list(task.required_permissions),
            "parent_id": task.parent_id,
            "role": task.role,
            "error": _safe_text(task.error, 500) if task.error else None,
            "progress": task.progress,
            "metadata": cls._snapshot_metadata(task.metadata),
            "context": cls._snapshot_context(context),
            "execution_summary": {
                "model_input": deepcopy(summary.model_input),
                "context": deepcopy(summary.context),
                "steps": deepcopy(summary.steps[-50:]),
                "tool_calls": deepcopy(summary.tool_calls[-50:]),
                "progress_label": _safe_text(summary.progress_label, 200),
                "result": deepcopy(result),
            },
        }

    @classmethod
    def _task_from_snapshot(cls, record: dict) -> Optional[Task]:
        task_id = record.get("id")
        description = record.get("description")
        if (
            not isinstance(task_id, str)
            or not task_id
            or len(task_id) > 100
            or not isinstance(description, str)
        ):
            return None
        try:
            status = TaskStatus(record.get("status", "paused"))
        except (TypeError, ValueError):
            status = TaskStatus.PAUSED
        metadata = cls._snapshot_metadata(record.get("metadata"))
        if status in _INTERRUPTED_STATUSES:
            status = TaskStatus.PAUSED
            metadata["interrupted"] = True
        if status == TaskStatus.PAUSED:
            metadata.setdefault("resume_mode", "checkpoint")
        created_at = _parse_datetime(record.get("created_at")) or _utcnow()
        task = Task(
            id=task_id,
            description=description,
            status=status,
            priority=(
                record.get("priority")
                if isinstance(record.get("priority"), int)
                and not isinstance(record.get("priority"), bool)
                else 0
            ),
            created_at=created_at,
            started_at=_parse_datetime(record.get("started_at")),
            completed_at=_parse_datetime(record.get("completed_at")),
            current_action=(
                record.get("current_action")
                if isinstance(record.get("current_action"), str)
                else None
            ),
            logs=list(record.get("logs", []))[:50]
            if isinstance(record.get("logs"), list)
            else [],
            cancelled=bool(record.get("cancelled", False)),
            model=record.get("model") if isinstance(record.get("model"), str) else None,
            provider=(
                record.get("provider")
                if isinstance(record.get("provider"), str)
                else None
            ),
            required_permissions=list(record.get("required_permissions", []))
            if isinstance(record.get("required_permissions"), list)
            else [],
            parent_id=record.get("parent_id")
            if isinstance(record.get("parent_id"), str)
            else None,
            role=record.get("role") if isinstance(record.get("role"), str) else None,
            error=record.get("error") if isinstance(record.get("error"), str) else None,
            metadata=metadata,
            progress=(
                record.get("progress")
                if isinstance(record.get("progress"), int)
                and not isinstance(record.get("progress"), bool)
                else 0
            ),
        )
        summary = record.get("execution_summary")
        if isinstance(summary, dict):
            stored_summary = TaskExecutionSummary()
            model_input = summary.get("model_input")
            if isinstance(model_input, dict):
                stored_summary.model_input = deepcopy(model_input)
            context = summary.get("context")
            if isinstance(context, dict):
                stored_summary.context = deepcopy(context)
            steps = summary.get("steps")
            if isinstance(steps, list):
                stored_summary.steps = [step for step in steps if isinstance(step, dict)][-50:]
            tool_calls = summary.get("tool_calls")
            if isinstance(tool_calls, list):
                stored_summary.tool_calls = [
                    call for call in tool_calls if isinstance(call, dict)
                ][-50:]
            label = summary.get("progress_label")
            if isinstance(label, str):
                stored_summary.progress_label = label
            result = summary.get("result")
            if isinstance(result, dict):
                stored_summary.result = deepcopy(result)
            task.execution_summary = stored_summary
        if task.status == TaskStatus.PAUSED:
            task.execution_summary.progress_label = (
                "Pausada — reanuda manualmente para continuar…"
                if metadata.get("interrupted")
                else "Pausada — esperando reanudación…"
            )
        return task

    async def restore(self) -> int:
        if self._store is None:
            return 0
        try:
            records = await asyncio.to_thread(self._store.load)
        except Exception:
            logger.exception("Could not load persisted task history.")
            return 0
        restored = 0
        async with self.lock:
            for record in records:
                task = self._task_from_snapshot(record)
                if task is None or task.id in self.tasks:
                    continue
                self.tasks[task.id] = task
                context = record.get("context")
                if isinstance(context, dict) and context:
                    self._task_contexts[task.id] = self._snapshot_context(context)
                restored += 1
        return restored

    def _schedule_persist(self) -> None:
        if self._store is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._persist_handle is None or self._persist_handle.done():
            self._persist_handle = loop.create_task(self._persist_after_delay())

    async def _persist_after_delay(self) -> None:
        try:
            await asyncio.sleep(self._persist_debounce_seconds)
        except asyncio.CancelledError:
            return
        await self._persist_now()

    async def _persist_now(self) -> None:
        if self._store is None:
            return
        async with self.lock:
            snapshots = [
                self._task_snapshot(
                    task,
                    self._task_contexts.get(task.id, {}),
                )
                for task in self.tasks.values()
            ]
        try:
            await asyncio.to_thread(self._store.save, snapshots)
        except Exception:
            logger.exception("Could not persist task history.")

    async def flush_persist(self) -> None:
        handle = self._persist_handle
        self._persist_handle = None
        if handle is not None and not handle.done():
            handle.cancel()
            try:
                await handle
            except asyncio.CancelledError:
                pass
        await self._persist_now()

    def _wake_task(self, task_id: str) -> None:
        event = self._resume_events.get(task_id)
        if event is not None:
            event.set()

    async def wait_if_paused(self, task_id: str) -> bool:
        """Block a running task while it is paused; return False if it was cancelled."""
        while True:
            async with self.lock:
                task = self.tasks.get(task_id)
                if task is None or task.cancelled or task.status == TaskStatus.CANCELLED:
                    return False
                if task.status != TaskStatus.PAUSED:
                    return True
                event = self._resume_events.get(task_id)
                if event is None:
                    event = asyncio.Event()
                    self._resume_events[task_id] = event
            await event.wait()
            # Clear the wake-up so an unexpectedly still-paused task waits
            # again instead of spinning on an already-set event.
            event.clear()


    async def create_task(
        self,
        task_id: str,
        description: str,
        priority: int = 0,
        context: Optional[dict] = None,
        parent_id: Optional[str] = None,
        role: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Task:
        async with self.lock:
            if task_id in self.tasks:
                raise ValueError(f"Task id {task_id} already exists.")
            task = Task(
                id=task_id,
                description=description,
                priority=priority,
                parent_id=parent_id,
                role=role,
                metadata=deepcopy(metadata or {}),
            )
            task.execution_summary.context = _safe_context_summary(context or {})
            task.execution_summary.model_input["character_count"] = len(description)
            self.tasks[task_id] = task
            self._task_contexts[task_id] = deepcopy(context or {})
        await self.event_bus.publish("TASK_CREATED", {"task_id": task_id})
        self._schedule_persist()
        return task

    async def get_task_context(self, task_id: str) -> Optional[dict]:
        async with self.lock:
            context = self._task_contexts.get(task_id)
            return deepcopy(context) if context is not None else None

    async def update_status(self, task_id: str, status: TaskStatus):
        changed = False
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is not None:
                # Cancellation is terminal.  This prevents a late completion
                # callback from resurrecting a cancelled task.
                if task.status == TaskStatus.CANCELLED and status != TaskStatus.CANCELLED:
                    return False
                task.status = status
                now = _utcnow()
                if status == TaskStatus.RUNNING and task.started_at is None:
                    task.started_at = now
                if status in {
                    TaskStatus.COMPLETED,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                }:
                    task.completed_at = task.completed_at or now
                if status == TaskStatus.QUEUED:
                    task.execution_summary.progress_label = "Waiting in queue…"
                elif status == TaskStatus.RUNNING:
                    task.progress = max(task.progress, 5)
                    task.execution_summary.progress_label = "Thinking…"
                elif status == TaskStatus.RETRYING:
                    task.execution_summary.progress_label = "Retrying safely…"
                elif status == TaskStatus.WAITING_CONFIRMATION:
                    task.execution_summary.progress_label = "Waiting for your approval…"
                elif status == TaskStatus.PAUSED:
                    task.execution_summary.progress_label = "Paused — waiting for you to resume…"
                elif status == TaskStatus.COMPLETED:
                    task.progress = 100
                    task.execution_summary.progress_label = "Completed"
                elif status in {TaskStatus.FAILED, TaskStatus.CANCELLED}:
                    task.execution_summary.progress_label = (
                        "Could not finish this task."
                        if status == TaskStatus.FAILED
                        else "Cancelled"
                    )
                if status == TaskStatus.PAUSED:
                    event = self._resume_events.get(task_id)
                    if event is not None:
                        event.clear()
                else:
                    self._wake_task(task_id)
                    if status in {
                        TaskStatus.COMPLETED,
                        TaskStatus.FAILED,
                        TaskStatus.CANCELLED,
                    }:
                        self._resume_events.pop(task_id, None)
                changed = True
        if not changed:
            return False
        await self.event_bus.publish("TASK_STATUS_CHANGED", {"task_id": task_id, "status": status.value})
        self._schedule_persist()
        return True

    async def cancel(self, task_id: str, *, notify: bool = True):
        handle = None
        callbacks = []
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return False
            task.cancelled = True
            task.status = TaskStatus.CANCELLED
            task.execution_summary.progress_label = "Cancelled"
            task.completed_at = task.completed_at or _utcnow()
            handle = self._task_handles.get(task_id)
            if notify:
                callbacks = list(self._cancel_callbacks)
        if handle is not None and not handle.done():
            handle.cancel()
        waiter = self._resume_events.pop(task_id, None)
        if waiter is not None:
            waiter.set()
        for callback in callbacks:
            try:
                await callback(task_id)
            except Exception:
                # Cancellation must remain best-effort even if one owner has
                # already gone away.
                continue
        await self.event_bus.publish("TASK_CANCELLED", {"task_id": task_id})
        await self.event_bus.publish(
            "TASK_STATUS_CHANGED",
            {"task_id": task_id, "status": TaskStatus.CANCELLED.value},
        )
        self._schedule_persist()
        return True

    async def register_task_handle(self, task_id: str, handle: asyncio.Task) -> None:
        """Associate an asyncio task with a persisted task record.

        Registration is race-safe with cancellation: if the task was cancelled
        before the handle was registered, the handle is cancelled immediately.
        """
        cancel_now = False
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            if task.cancelled or task.status == TaskStatus.CANCELLED:
                cancel_now = True
            else:
                self._task_handles[task_id] = handle
        if cancel_now and not handle.done():
            handle.cancel()

    async def unregister_task_handle(self, task_id: str, handle: Optional[asyncio.Task] = None) -> None:
        async with self.lock:
            current = self._task_handles.get(task_id)
            if handle is None or current is handle:
                self._task_handles.pop(task_id, None)

    async def register_cancel_callback(self, callback: Callable[[str], Awaitable[None]]) -> None:
        async with self.lock:
            self._cancel_callbacks.add(callback)

    async def unregister_cancel_callback(self, callback: Callable[[str], Awaitable[None]]) -> None:
        async with self.lock:
            self._cancel_callbacks.discard(callback)

    async def is_cancelled(self, task_id: str) -> bool:
        async with self.lock:
            task = self.tasks.get(task_id)
            return bool(task and (task.cancelled or task.status == TaskStatus.CANCELLED))

    async def set_result(
        self,
        task_id: str,
        result: Any = None,
        error: Optional[str] = None,
    ) -> bool:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return False
            task.result = deepcopy(result)
            task.error = error
            task.execution_summary.result = {
                "status": "failed" if error else "completed",
                "summary": _safe_text(error or result or "No result summary provided", 240),
            }
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})
        self._schedule_persist()
        return True

    async def pause(self, task_id: str) -> bool:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None or task.status not in {
                TaskStatus.QUEUED,
                TaskStatus.RUNNING,
                TaskStatus.RETRYING,
                TaskStatus.WAITING_CONFIRMATION,
            }:
                return False
        return await self.update_status(task_id, TaskStatus.PAUSED)

    async def resume(self, task_id: str) -> bool:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None or task.status != TaskStatus.PAUSED:
                return False
            event = self._resume_events.get(task_id)
            if event is not None:
                event.set()
        return await self.update_status(task_id, TaskStatus.RUNNING)

    async def get_tasks(self) -> List[Task]:
        async with self.lock:
            return deepcopy(list(self.tasks.values()))

    async def get_task(self, task_id: str) -> Optional[Task]:
        async with self.lock:
            task = self.tasks.get(task_id)
            return deepcopy(task) if task is not None else None

    async def get_task_progress(self, task_ids: Iterable[str]) -> Dict[str, dict]:
        async with self.lock:
            progress = {}
            for task_id in task_ids:
                task = self.tasks.get(task_id)
                if task is None:
                    continue
                task_progress = {"progress": task.progress}
                if isinstance(task.current_action, str):
                    task_progress["current_action"] = task.current_action[:120]
                task_progress["progress_label"] = task.execution_summary.progress_label
                progress[task_id] = task_progress
            return progress

    async def record_model_request(self, task_id: str, request_detail: dict) -> None:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            safe_request = {
                key: request_detail.get(key)
                for key in (
                    "request_id", "timestamp", "attempt", "provider",
                    "model", "key_slot", "status",
                )
                if key in request_detail
            }
            safe_request["input_summary"] = _safe_model_input_summary(request_detail.get("request"))
            error = request_detail.get("error")
            if isinstance(error, dict):
                safe_request["error"] = {
                    "code": _safe_text(error.get("code", "UNKNOWN"), 80),
                    "message": _safe_text(error.get("message", ""), 240),
                }
            request_id = request_detail.get("request_id")
            existing_index = next(
                (
                    index
                    for index, entry in enumerate(task.model_requests)
                    if entry.get("request_id") == request_id
                ),
                None,
            )
            if existing_index is None:
                task.model_requests.append(safe_request)
                task.model_requests = task.model_requests[-50:]
            else:
                task.model_requests[existing_index] = safe_request
            input_summary = safe_request["input_summary"]
            input_summary["context_labels"] = list(dict.fromkeys(
                task.execution_summary.context.get("labels", [])
                + input_summary.get("context_labels", [])
            ))
            task.execution_summary.model_input = input_summary
            task.execution_summary.progress_label = (
                "Thinking…"
                if safe_request.get("status") == "attempting"
                else task.execution_summary.progress_label
            )
        await self.event_bus.publish(
            "TASK_DETAILS_CHANGED",
            {"task_id": task_id},
        )
        self._schedule_persist()

    async def record_react_step(self, task_id: str, iteration: int, role: str) -> None:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            step = {
                "id": f"model-step-{iteration}",
                "label": f"Model execution step {iteration}",
                "detail": f"{role.title()} model step completed",
                "status": "running",
            }
            task.execution_summary.steps = [
                {**existing, "status": "completed"}
                for existing in task.execution_summary.steps
                if existing.get("id") != step["id"]
            ] + [step]
            task.current_action = "Thinking…"
            task.progress = min(90, max(task.progress, 10 + iteration * 5))
            task.execution_summary.progress_label = "Thinking…"
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})
        self._schedule_persist()

    async def set_progress_label(
        self,
        task_id: str,
        label: str,
        current_action: Optional[str] = None,
    ) -> None:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            task.execution_summary.progress_label = label
            task.current_action = current_action or label
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})
        self._schedule_persist()

    async def record_tool_call(
        self,
        task_id: str,
        tool: str,
        success: bool,
        result: object = None,
    ) -> None:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            call = {
                "id": uuid.uuid4().hex,
                "tool": _safe_text(tool, 100),
                "status": "succeeded" if success else "failed",
                "result_summary": _safe_text(result, 180) if result is not None else "No result summary provided",
            }
            task.execution_summary.tool_calls = (task.execution_summary.tool_calls + [call])[-50:]
            task.current_action = f"Tool: {call['tool']}"
            task.progress = min(95, max(task.progress, 15 + len(task.execution_summary.tool_calls) * 5))
            task.execution_summary.progress_label = "Thinking…"
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})
        self._schedule_persist()

    async def record_result(self, task_id: str, status: str, result: object = None) -> None:
        async with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            task.execution_summary.result = {
                "status": _safe_text(status, 40),
                "summary": _safe_text(result, 240) if result is not None else "No result summary provided",
            }
            task.execution_summary.progress_label = status.title()
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})
        self._schedule_persist()

    async def get_running_tasks(self) -> List[Task]:
        async with self.lock:
            return [t for t in self.tasks.values() if t.status == TaskStatus.RUNNING]
