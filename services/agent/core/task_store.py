import json
import os
import tempfile
from pathlib import Path
from typing import Any


class TaskStore:
    """Durable, atomic snapshot storage for desktop task history."""

    _MAX_RECORDS = 200

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self.path = self.directory / "task-history.json"

    def load(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return []
        records = data.get("tasks") if isinstance(data, dict) else data
        if not isinstance(records, list):
            return []
        return [record for record in records if isinstance(record, dict)]

    def save(self, tasks: list[dict[str, Any]]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "tasks": [task for task in tasks if isinstance(task, dict)][
                -self._MAX_RECORDS:
            ],
        }
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
        ).encode("utf-8")
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=self.directory,
                prefix=".task-history.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(serialized)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            temporary_path.replace(self.path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
