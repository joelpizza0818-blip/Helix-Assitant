"""Shared paths for HELIX-generated persistent and temporary data."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path


def get_storage_root() -> Path:
    configured_root = os.environ.get("HELIX_STORAGE_DIR", "").strip()
    if configured_root:
        return Path(configured_root).expanduser().resolve()
    if os.name == "nt":
        desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
        return desktop / "helix-storage"
    return Path.home() / ".helix"


def get_agent_data_dir() -> Path:
    root = get_storage_root()
    if os.name == "nt" or os.environ.get("HELIX_STORAGE_DIR"):
        return root / "agent"
    return root


def get_desktop_data_dir() -> Path:
    root = get_storage_root()
    if os.name == "nt" or os.environ.get("HELIX_STORAGE_DIR"):
        return root / "desktop"
    return root


def configure_temp_directory() -> Path:
    temp_dir = get_storage_root() / "temp"
    if os.name == "nt" or os.environ.get("HELIX_STORAGE_DIR"):
        temp_dir.mkdir(parents=True, exist_ok=True)
        for variable in ("TEMP", "TMP", "TMPDIR"):
            os.environ[variable] = str(temp_dir)
        tempfile.tempdir = str(temp_dir)
    return temp_dir


def configure_cache_directories() -> Path:
    cache_dir = get_storage_root() / "cache"
    if os.name == "nt" or os.environ.get("HELIX_STORAGE_DIR"):
        os.environ["HF_HOME"] = str(cache_dir / "huggingface")
        os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache_dir / "huggingface" / "hub")
        os.environ["TORCH_HOME"] = str(cache_dir / "torch")
        os.environ["XDG_CACHE_HOME"] = str(cache_dir)
    return cache_dir


def migrate_legacy_agent_data(legacy_path: Path | None = None) -> bool:
    if os.name != "nt" and not os.environ.get("HELIX_STORAGE_DIR"):
        return False
    legacy_dir = Path(legacy_path) if legacy_path else Path.home() / ".helix"
    destination = get_agent_data_dir()
    if (
        not legacy_dir.is_dir()
        or legacy_dir.resolve() == destination.resolve()
        or destination.exists()
    ):
        return False
    shutil.copytree(legacy_dir, destination)
    return True
