from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

class TaskStatus(Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    WAITING_CONFIRMATION = "WAITING_CONFIRMATION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    RETRYING = "RETRYING"

@dataclass
class TaskLog:
    timestamp: datetime
    level: str
    message: str
    action: Optional[str] = None

@dataclass
class Task:
    id: str
    description: str
    status: TaskStatus
    priority: int
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    current_action: Optional[str] = None
    logs: List[TaskLog] = field(default_factory=list)
    cancelled: bool = False
    model: Optional[str] = None
    provider: Optional[str] = None
    required_permissions: List[str] = field(default_factory=list)
    error: Optional[str] = None
    result: Optional[dict] = None
