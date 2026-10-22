"""Event Router and Serialization for Desktop Bridge.

Decouples payload serialization and event routing from network transport.
"""

from typing import Any
from datetime import datetime
from enum import Enum
from pathlib import Path


def serialize_entity(value: Any) -> Any:
    """Recursively formats objects into JSON-compatible serializable values."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "__dict__"):
        return {
            k: serialize_entity(v)
            for k, v in value.__dict__.items()
            if not k.startswith("_")
        }
    if isinstance(value, dict):
        return {k: serialize_entity(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [serialize_entity(item) for item in value]
    return value


def serialize_task_for_desktop(task: Any) -> dict:
    """Expose only the task fields intended for the desktop summary UI."""
    serialized = serialize_entity(task)
    metadata = getattr(task, "metadata", {})
    if (
        isinstance(metadata, dict)
        and metadata.get("task_type") == "subagent"
    ):
        serialized["task_type"] = "subagent"
    serialized.pop("result", None)
    serialized.pop("metadata", None)
    return serialized
