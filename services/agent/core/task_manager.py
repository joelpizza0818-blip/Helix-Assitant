import asyncio
import re
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set
from enum import Enum


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
    progress_label: str = "Queued"
    result: Optional[dict] = None

@dataclass
class Task:
    id: str
    description: str
    status: TaskStatus = TaskStatus.QUEUED
    priority: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
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

class TaskManager:
    def __init__(self, event_bus):
        self.tasks: Dict[str, Task] = {}
        self._task_contexts: Dict[str, dict] = {}
        self._task_handles: Dict[str, asyncio.Task] = {}
        self._cancel_callbacks: Set[Callable[[str], Awaitable[None]]] = set()
        self.lock = asyncio.Lock()
        self.event_bus = event_bus

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
                now = datetime.utcnow()
                if status == TaskStatus.RUNNING and task.started_at is None:
                    task.started_at = now
                if status in {
                    TaskStatus.COMPLETED,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                }:
                    task.completed_at = task.completed_at or now
                if status == TaskStatus.RUNNING:
                    task.progress = max(task.progress, 5)
                    task.execution_summary.progress_label = "Running"
                elif status == TaskStatus.COMPLETED:
                    task.progress = 100
                    task.execution_summary.progress_label = "Completed"
                elif status in {TaskStatus.FAILED, TaskStatus.CANCELLED}:
                    task.execution_summary.progress_label = status.value.title()
                changed = True
        if not changed:
            return False
        await self.event_bus.publish("TASK_STATUS_CHANGED", {"task_id": task_id, "status": status.value})
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
            task.completed_at = task.completed_at or datetime.utcnow()
            handle = self._task_handles.get(task_id)
            if notify:
                callbacks = list(self._cancel_callbacks)
        if handle is not None and not handle.done():
            handle.cancel()
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
        return True

    async def pause(self, task_id: str):
        await self.update_status(task_id, TaskStatus.PAUSED)

    async def resume(self, task_id: str):
        await self.update_status(task_id, TaskStatus.RUNNING)

    async def get_tasks(self) -> List[Task]:
        async with self.lock:
            return deepcopy(list(self.tasks.values()))

    async def get_task(self, task_id: str) -> Optional[Task]:
        async with self.lock:
            task = self.tasks.get(task_id)
            return deepcopy(task) if task is not None else None

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
                "Model request in progress"
                if safe_request.get("status") == "attempting"
                else "Model request recorded"
            )
        await self.event_bus.publish(
            "TASK_DETAILS_CHANGED",
            {"task_id": task_id},
        )

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
            task.current_action = step["label"]
            task.progress = min(90, max(task.progress, 10 + iteration * 5))
            task.execution_summary.progress_label = step["label"]
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})

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
                "tool": _safe_text(tool, 100),
                "status": "succeeded" if success else "failed",
                "result_summary": _safe_text(result, 180) if result is not None else "No result summary provided",
            }
            task.execution_summary.tool_calls = (task.execution_summary.tool_calls + [call])[-50:]
            task.current_action = f"Tool: {call['tool']}"
            task.progress = min(95, max(task.progress, 15 + len(task.execution_summary.tool_calls) * 5))
            task.execution_summary.progress_label = f"Tool {call['status']}"
        await self.event_bus.publish("TASK_DETAILS_CHANGED", {"task_id": task_id})

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

    async def get_running_tasks(self) -> List[Task]:
        async with self.lock:
            return [t for t in self.tasks.values() if t.status == TaskStatus.RUNNING]
