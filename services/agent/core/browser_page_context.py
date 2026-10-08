from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional

_current_page: Optional[dict[str, Any]] = None


def update_current_page(page: dict[str, Any]) -> None:
    global _current_page
    _current_page = deepcopy(page)


def get_current_page(max_age_seconds: int = 300) -> Optional[dict[str, Any]]:
    if _current_page is None:
        return None
    captured_at = _current_page.get("captured_at")
    if not isinstance(captured_at, str):
        return None
    try:
        timestamp = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        return None
    age = (datetime.now(timezone.utc) - timestamp).total_seconds()
    if age < -60 or age > max_age_seconds:
        return None
    return deepcopy(_current_page)


def clear_current_page() -> None:
    global _current_page
    _current_page = None
