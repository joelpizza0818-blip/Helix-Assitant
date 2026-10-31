"""Ollama local runtime manager for Helix Assistant.

Handles:
- Detecting if Ollama is installed and running
- Listing installed models
- Pulling (downloading) new models with progress
- Hardware pre-flight checks (disk space, RAM estimate)
- Cancellable pull operations
- Running a quick inference smoke-test
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

import aiohttp

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
PULL_TIMEOUT_SECONDS = 3600  # 1 hour max for large models
SMOKE_TEST_TIMEOUT = 30

# Minimum free disk space required beyond the model size (in bytes)
_MIN_BUFFER_BYTES = 512 * 1024 * 1024  # 512 MB

# RAM heuristic: model size × 1.5 should fit in available RAM
_RAM_MULTIPLIER = 1.5


@dataclass
class OllamaModel:
    name: str
    size_bytes: int = 0
    digest: str = ""
    modified_at: str = ""

    @property
    def size_gb(self) -> float:
        return round(self.size_bytes / (1024 ** 3), 2)


@dataclass
class PullProgress:
    status: str          # e.g. "pulling manifest", "downloading", "success"
    total: int = 0       # bytes total
    completed: int = 0   # bytes completed
    percent: float = 0.0
    done: bool = False
    error: Optional[str] = None


@dataclass
class HardwareCheck:
    ok: bool
    free_disk_gb: float
    free_ram_gb: float
    model_size_gb: float
    issues: List[str] = field(default_factory=list)


class OllamaManager:
    """Manages the Ollama local runtime lifecycle."""

    def __init__(self, base_url: str = OLLAMA_BASE_URL):
        self._base_url = base_url.rstrip("/")
        self._active_pulls: Dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------ #
    #  Runtime detection
    # ------------------------------------------------------------------ #

    def is_installed(self) -> bool:
        """Return True if the 'ollama' binary is on PATH."""
        return shutil.which("ollama") is not None

    async def is_running(self) -> bool:
        """Return True if the Ollama HTTP server is reachable."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=3)
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False

    def get_install_command(self) -> Optional[str]:
        """Return a user-facing install hint for the current OS."""
        system = platform.system().lower()
        if system == "windows":
            return "winget install Ollama.Ollama  # or download from https://ollama.com/download"
        if system == "darwin":
            return "brew install ollama  # or download from https://ollama.com/download"
        if system == "linux":
            return "curl -fsSL https://ollama.com/install.sh | sh"
        return "Download from https://ollama.com/download"

    async def start_server(self) -> bool:
        """Attempt to start the Ollama server in the background.
        Returns True if it became reachable within 10 seconds.
        Only works if the binary is installed."""
        if not self.is_installed():
            return False
        try:
            subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            logger.warning("Could not start ollama server: %s", exc)
            return False

        for _ in range(10):
            await asyncio.sleep(1)
            if await self.is_running():
                return True
        return False

    # ------------------------------------------------------------------ #
    #  Model listing
    # ------------------------------------------------------------------ #

    async def list_installed(self) -> List[OllamaModel]:
        """Return locally installed Ollama models."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status != 200:
                        return []
                    data = await resp.json()
                    return [
                        OllamaModel(
                            name=m.get("name", ""),
                            size_bytes=m.get("size", 0),
                            digest=m.get("digest", ""),
                            modified_at=m.get("modified_at", ""),
                        )
                        for m in data.get("models", [])
                    ]
        except Exception as exc:
            logger.debug("Failed to list Ollama models: %s", exc)
            return []

    async def is_model_installed(self, model_name: str) -> bool:
        """Return True if model_name is in the local Ollama library."""
        installed = await self.list_installed()
        # Normalize: strip tag if model_name has no tag
        base = model_name.split(":")[0]
        for m in installed:
            if m.name == model_name or m.name.split(":")[0] == base:
                return True
        return False

    # ------------------------------------------------------------------ #
    #  Hardware pre-flight
    # ------------------------------------------------------------------ #

    def check_hardware(self, model_size_gb: float) -> HardwareCheck:
        """Check whether the host has enough disk and RAM for the given model."""
        issues: List[str] = []

        # Disk space
        try:
            disk = shutil.disk_usage("/")
            free_disk_bytes = disk.free
        except Exception:
            free_disk_bytes = 0
        free_disk_gb = free_disk_bytes / (1024 ** 3)
        required_bytes = (model_size_gb * 1024 ** 3) + _MIN_BUFFER_BYTES
        if free_disk_bytes < required_bytes:
            issues.append(
                f"Espacio en disco insuficiente: se necesitan ~{model_size_gb + 0.5:.1f} GB libres, "
                f"disponibles: {free_disk_gb:.1f} GB."
            )

        # RAM estimate (best effort)
        free_ram_gb = 0.0
        try:
            import psutil  # optional dependency
            free_ram_gb = psutil.virtual_memory().available / (1024 ** 3)
            required_ram_gb = model_size_gb * _RAM_MULTIPLIER
            if free_ram_gb < required_ram_gb:
                issues.append(
                    f"RAM insuficiente: el modelo necesita ~{required_ram_gb:.1f} GB, "
                    f"disponibles: {free_ram_gb:.1f} GB. Puede ser lento."
                )
        except ImportError:
            pass  # psutil not required

        return HardwareCheck(
            ok=len(issues) == 0,
            free_disk_gb=round(free_disk_gb, 2),
            free_ram_gb=round(free_ram_gb, 2),
            model_size_gb=model_size_gb,
            issues=issues,
        )

    # ------------------------------------------------------------------ #
    #  Model pull (download) with progress streaming
    # ------------------------------------------------------------------ #

    async def pull_model(
        self,
        model_name: str,
        on_progress: Optional[Any] = None,  # async callable(PullProgress)
    ) -> PullProgress:
        """Pull (download) an Ollama model.

        Streams progress events and calls on_progress(PullProgress) for each.
        Returns the final PullProgress.
        Raises CancelledError if cancelled.
        """
        final = PullProgress(status="starting")
        try:
            async with aiohttp.ClientSession() as session:
                payload = json.dumps({"name": model_name, "stream": True})
                async with session.post(
                    f"{self._base_url}/api/pull",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=PULL_TIMEOUT_SECONDS),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        final = PullProgress(
                            status="error",
                            done=True,
                            error=f"HTTP {resp.status}: {body[:200]}",
                        )
                        return final

                    async for raw_line in resp.content:
                        line = raw_line.strip()
                        if not line:
                            continue
                        try:
                            evt = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        status = evt.get("status", "")
                        total = evt.get("total", 0) or 0
                        completed = evt.get("completed", 0) or 0
                        percent = (completed / total * 100) if total else 0.0
                        done = status == "success"
                        error = evt.get("error")

                        progress = PullProgress(
                            status=status,
                            total=total,
                            completed=completed,
                            percent=round(percent, 1),
                            done=done,
                            error=error,
                        )
                        final = progress

                        if on_progress is not None:
                            try:
                                if asyncio.iscoroutinefunction(on_progress):
                                    await on_progress(progress)
                                else:
                                    on_progress(progress)
                            except Exception:
                                pass

                        if done or error:
                            break

        except asyncio.CancelledError:
            final = PullProgress(status="cancelled", done=True, error="Cancelled by user.")
            raise
        except Exception as exc:
            logger.exception("Ollama pull failed for %s", model_name)
            final = PullProgress(status="error", done=True, error=str(exc))

        return final

    def start_pull_task(
        self,
        model_name: str,
        on_progress: Optional[Any] = None,
    ) -> asyncio.Task:
        """Start an async pull task and track it for cancellation."""
        task = asyncio.create_task(self.pull_model(model_name, on_progress))
        self._active_pulls[model_name] = task
        task.add_done_callback(lambda _: self._active_pulls.pop(model_name, None))
        return task

    def cancel_pull(self, model_name: str) -> bool:
        """Cancel an ongoing pull. Returns True if a task was found and cancelled."""
        task = self._active_pulls.get(model_name)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def is_pulling(self, model_name: str) -> bool:
        """Return True if a pull is currently in progress for model_name."""
        task = self._active_pulls.get(model_name)
        return task is not None and not task.done()

    # ------------------------------------------------------------------ #
    #  Smoke-test inference
    # ------------------------------------------------------------------ #

    async def smoke_test(self, model_name: str) -> bool:
        """Run a short inference to verify the model is working."""
        payload = {
            "model": model_name,
            "prompt": "Hi",
            "stream": False,
            "options": {"num_predict": 8},
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._base_url}/api/generate",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=SMOKE_TEST_TIMEOUT),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return bool(data.get("response", "").strip())
                    return False
        except Exception as exc:
            logger.debug("Ollama smoke test failed for %s: %s", model_name, exc)
            return False

    # ------------------------------------------------------------------ #
    #  Status summary
    # ------------------------------------------------------------------ #

    async def get_status(self) -> dict:
        """Return a JSON-serialisable status dict for IPC."""
        installed = self.is_installed()
        running = await self.is_running() if installed else False
        models: List[dict] = []
        if running:
            for m in await self.list_installed():
                models.append({
                    "name": m.name,
                    "size_gb": m.size_gb,
                    "modified_at": m.modified_at,
                })
        return {
            "installed": installed,
            "running": running,
            "models": models,
            "install_hint": self.get_install_command() if not installed else None,
            "active_pulls": list(self._active_pulls.keys()),
        }


# Singleton — shared across the app
_manager: Optional[OllamaManager] = None


def get_ollama_manager() -> OllamaManager:
    global _manager
    if _manager is None:
        _manager = OllamaManager()
    return _manager
