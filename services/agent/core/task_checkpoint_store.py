import os
import pickle
import re
import tempfile
import threading
import zlib
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

try:
    from services.agent.security.secret_manager import SecretManager
except ImportError:
    from security.secret_manager import SecretManager


class TaskCheckpointStore:
    _KEY_NAME = "task_checkpoint_encryption_key"
    _SCHEMA_VERSION = 1
    _TASK_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}\Z")

    def __init__(
        self,
        directory: Path,
        secret_manager: SecretManager | None = None,
    ) -> None:
        self.directory = Path(directory)
        self.secret_manager = secret_manager or SecretManager()
        self._lock = threading.RLock()
        self._fernet: Fernet | None = None

    def save(self, task_id: str, checkpoint: dict[str, Any]) -> None:
        path = self._checkpoint_path(task_id)
        if not isinstance(checkpoint, dict):
            raise TypeError("Task checkpoint must be a dictionary.")
        envelope = {
            "schema_version": self._SCHEMA_VERSION,
            "task_id": task_id,
            "checkpoint": checkpoint,
        }
        encrypted = self._cipher().encrypt(
            zlib.compress(pickle.dumps(envelope, protocol=pickle.HIGHEST_PROTOCOL))
        )
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = None
            try:
                # Sync a finished sibling file before replacing the checkpoint, like handing over a clean draft instead of a half-written page.
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=path.parent,
                    prefix=f".{task_id}.",
                    suffix=".tmp",
                    delete=False,
                ) as temporary_file:
                    temporary_path = Path(temporary_file.name)
                    temporary_file.write(encrypted)
                    temporary_file.flush()
                    os.fsync(temporary_file.fileno())
                temporary_path.replace(path)
            finally:
                if temporary_path is not None and temporary_path.exists():
                    temporary_path.unlink()

    def load(self, task_id: str) -> dict[str, Any] | None:
        path = self._checkpoint_path(task_id)
        with self._lock:
            if not path.is_file():
                return None
            encrypted = path.read_bytes()
        try:
            envelope = pickle.loads(zlib.decompress(self._cipher().decrypt(encrypted)))
        except (
            InvalidToken,
            zlib.error,
            pickle.PickleError,
            EOFError,
            AttributeError,
            ImportError,
            ValueError,
            TypeError,
        ) as error:
            raise RuntimeError(
                f"Task checkpoint for {task_id} could not be decrypted or decoded."
            ) from error
        if (
            not isinstance(envelope, dict)
            or envelope.get("schema_version") != self._SCHEMA_VERSION
            or envelope.get("task_id") != task_id
            or not isinstance(envelope.get("checkpoint"), dict)
        ):
            raise ValueError(f"Task checkpoint for {task_id} has an invalid format.")
        return envelope["checkpoint"]

    def delete(self, task_id: str) -> bool:
        path = self._checkpoint_path(task_id)
        with self._lock:
            if not path.is_file():
                return False
            path.unlink()
            return True

    def list_task_ids(self) -> list[str]:
        with self._lock:
            if not self.directory.is_dir():
                return []
            return sorted(
                path.stem
                for path in self.directory.glob("*.checkpoint")
                if self._TASK_ID_PATTERN.fullmatch(path.stem)
            )

    def _checkpoint_path(self, task_id: str) -> Path:
        if (
            not isinstance(task_id, str)
            or task_id in {".", ".."}
            or self._TASK_ID_PATTERN.fullmatch(task_id) is None
        ):
            raise ValueError("Task id contains unsupported characters.")
        return self.directory / f"{task_id}.checkpoint"

    def _cipher(self) -> Fernet:
        with self._lock:
            if self._fernet is not None:
                return self._fernet
            # Keep the key in the OS credential store so checkpoints remain readable across process restarts.
            try:
                key = self.secret_manager.get_secret(self._KEY_NAME)
                if key is None:
                    key = Fernet.generate_key().decode("ascii")
                    self.secret_manager.store_secret(self._KEY_NAME, key)
            except Exception as error:
                raise RuntimeError(
                    "Encrypted task checkpoint storage requires an available "
                    "OS credential store."
                ) from error
            try:
                self._fernet = Fernet(key.encode("ascii"))
            except (AttributeError, UnicodeEncodeError, ValueError) as error:
                raise RuntimeError(
                    "The task checkpoint encryption key is invalid."
                ) from error
            return self._fernet
