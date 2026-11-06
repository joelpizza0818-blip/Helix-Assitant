from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from services.agent.core.task_checkpoint_store import TaskCheckpointStore


class InMemorySecretManager:
    def __init__(self):
        self.values = {}

    def get_secret(self, key_name):
        return self.values.get(key_name)

    def store_secret(self, key_name, value):
        self.values[key_name] = value


def test_task_checkpoint_store_encrypts_and_round_trips_checkpoint(tmp_path: Path):
    secrets = InMemorySecretManager()
    store = TaskCheckpointStore(tmp_path, secrets)
    checkpoint = {
        "task_description": "Send the private report",
        "step_outputs": {"find": {"path": "C:\\private\\report.pdf"}},
    }

    store.save("task-1", checkpoint)

    path = tmp_path / "task-1.checkpoint"
    assert b"private report" not in path.read_bytes()
    assert store.load("task-1") == checkpoint
    assert store.list_task_ids() == ["task-1"]
    assert store.delete("task-1")
    assert store.list_task_ids() == []


def test_task_checkpoint_store_rejects_tampered_checkpoint(tmp_path: Path):
    secrets = InMemorySecretManager()
    store = TaskCheckpointStore(tmp_path, secrets)
    store.save("task-2", {"task_description": "Recover safely"})
    path = tmp_path / "task-2.checkpoint"
    encrypted = bytearray(path.read_bytes())
    encrypted[-1] ^= 1
    path.write_bytes(encrypted)

    with pytest.raises(RuntimeError, match="could not be decrypted"):
        store.load("task-2")


@pytest.mark.parametrize("task_id", ["..", "../outside", "folder/task", ""])
def test_task_checkpoint_store_rejects_unsafe_task_ids(tmp_path: Path, task_id: str):
    store = TaskCheckpointStore(tmp_path, InMemorySecretManager())

    with pytest.raises(ValueError, match="unsupported characters"):
        store.save(task_id, {})


def test_task_checkpoint_store_rejects_invalid_encryption_key(tmp_path: Path):
    secrets = InMemorySecretManager()
    secrets.values[TaskCheckpointStore._KEY_NAME] = Fernet.generate_key().decode()
    store = TaskCheckpointStore(tmp_path, secrets)

    store.save("task-3", {"task_description": "Valid key"})

    other_secrets = InMemorySecretManager()
    other_secrets.values[TaskCheckpointStore._KEY_NAME] = "not-a-fernet-key"
    broken_store = TaskCheckpointStore(tmp_path, other_secrets)
    with pytest.raises(RuntimeError, match="encryption key is invalid"):
        broken_store.load("task-3")
