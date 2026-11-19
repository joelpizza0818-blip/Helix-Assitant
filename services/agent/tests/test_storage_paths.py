import os
import tempfile
from pathlib import Path

from services.agent.storage_paths import (
    configure_cache_directories,
    configure_temp_directory,
    get_agent_data_dir,
    get_storage_root,
    migrate_legacy_agent_data,
)


def test_configured_storage_root_contains_agent_and_temp_data(
    monkeypatch, tmp_path
):
    root = tmp_path / "helix-storage"
    monkeypatch.setenv("HELIX_STORAGE_DIR", str(root))
    monkeypatch.setattr(tempfile, "tempdir", None)

    assert get_storage_root() == root.resolve()
    assert get_agent_data_dir() == root / "agent"
    assert configure_temp_directory() == root / "temp"
    assert configure_cache_directories() == root / "cache"
    assert tempfile.tempdir == str(root / "temp")
    assert os.environ["HF_HOME"] == str(root / "cache" / "huggingface")
    assert os.environ["HUGGINGFACE_HUB_CACHE"] == str(root / "cache" / "huggingface" / "hub")
    assert os.environ["TORCH_HOME"] == str(root / "cache" / "torch")


def test_windows_default_storage_root_is_on_desktop(monkeypatch, tmp_path):
    monkeypatch.delenv("HELIX_STORAGE_DIR", raising=False)
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    if os.name == "nt":
        assert get_storage_root() == tmp_path / "Desktop" / "helix-storage"
        assert get_agent_data_dir() == tmp_path / "Desktop" / "helix-storage" / "agent"


def test_legacy_agent_data_is_copied_once_without_deleting_source(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("HELIX_STORAGE_DIR", str(tmp_path / "helix-storage"))
    legacy_dir = tmp_path / "legacy-agent-data"
    legacy_dir.mkdir()
    (legacy_dir / "memory.json").write_text("preserved", encoding="utf-8")
    destination = tmp_path / "helix-storage" / "agent"

    assert migrate_legacy_agent_data(legacy_dir) is True
    assert (destination / "memory.json").read_text(encoding="utf-8") == "preserved"
    assert (legacy_dir / "memory.json").is_file()
    assert migrate_legacy_agent_data(legacy_dir) is False
