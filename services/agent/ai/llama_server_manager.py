"""Llama.cpp Server (llama-server) Manager for Helix Assistant.

Provides zero-install, portable local inference using llama-server (llama.cpp):
- Discovers portable binary or system binary
- Downloads official portable binary with progress
- Downloads curated GGUF models directly from Hugging Face
- Starts/stops background server process on 127.0.0.1:8080
- Auto-starts server when selecting a local GGUF model
- Checks health and active model status
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import platform
import shutil
import subprocess
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

logger = logging.getLogger(__name__)

DEFAULT_LLAMA_SERVER_PORT = 8080
DEFAULT_LLAMA_SERVER_HOST = "127.0.0.1"

# Official llama.cpp release zip for Windows x64 AVX2
LLAMA_CPP_WIN_ZIP_URL = (
    "https://github.com/ggerganov/llama.cpp/releases/latest/download/llama-b4100-bin-win-avx2-x64.zip"
)

# Curated, proven GGUF models hosted on Hugging Face (Q4_K_M quantization)
CURATED_GGUF_MODELS: Dict[str, Dict[str, Any]] = {
    "llama-3.2-3b": {
        "id": "llama-3.2-3b",
        "filename": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "display_name": "Llama 3.2 3B Instruct",
        "size_gb": 2.02,
        "url": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "description": "Meta AI · Rápido y versátil para comandos del sistema",
    },
    "qwen2.5-coder-1.5b": {
        "id": "qwen2.5-coder-1.5b",
        "filename": "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        "display_name": "Qwen 2.5 Coder 1.5B",
        "size_gb": 0.99,
        "url": "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        "description": "Alibaba · Especialista en código, terminal y scripts",
    },
    "deepseek-r1-1.5b": {
        "id": "deepseek-r1-1.5b",
        "filename": "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
        "display_name": "DeepSeek R1 1.5B Distill",
        "size_gb": 1.12,
        "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
        "description": "DeepSeek · Razonamiento paso a paso ultra-ligero",
    },
}


def get_default_helix_dir() -> Path:
    """Return standard user data directory for Helix binaries and models."""
    if platform.system() == "Windows":
        base = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(base) / "Helix"
    return Path.home() / ".config" / "helix"


def get_helix_bin_dir() -> Path:
    d = get_default_helix_dir() / "bin"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_helix_models_dir() -> Path:
    d = get_default_helix_dir() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


@dataclass
class GgufModelInfo:
    name: str
    path: str
    size_gb: float


@dataclass
class DownloadProgress:
    status: str
    percent: float = 0.0
    completed_bytes: int = 0
    total_bytes: int = 0
    done: bool = False
    error: Optional[str] = None


class LlamaServerManager:
    """Controls the local llama-server executable and model downloads."""

    def __init__(
        self,
        host: str = DEFAULT_LLAMA_SERVER_HOST,
        port: int = DEFAULT_LLAMA_SERVER_PORT,
    ):
        self.host = host
        self.port = port
        self._process: Optional[subprocess.Popen] = None
        self._active_model_path: Optional[str] = None
        self._active_downloads: Dict[str, asyncio.Task] = {}

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def find_binary(self) -> Optional[str]:
        """Locate llama-server binary in priority order."""
        exe_name = "llama-server.exe" if platform.system() == "Windows" else "llama-server"

        # 1. User Helix bin directory
        helix_bin = get_helix_bin_dir() / exe_name
        if helix_bin.is_file():
            return str(helix_bin)

        # 2. Local workspace bin directory
        workspace_bin = Path(__file__).resolve().parents[3] / "bin" / exe_name
        if workspace_bin.is_file():
            return str(workspace_bin)

        # 3. System PATH
        system_exe = shutil.which("llama-server")
        if system_exe:
            return system_exe

        return None

    def is_installed(self) -> bool:
        return self.find_binary() is not None

    async def is_running(self) -> bool:
        """Check if server is responding on http://<host>:<port>/health."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}/health",
                    timeout=aiohttp.ClientTimeout(total=2),
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False

    def list_local_models(self) -> List[GgufModelInfo]:
        """Scan models directory for *.gguf files."""
        models_dir = get_helix_models_dir()
        found: List[GgufModelInfo] = []
        if not models_dir.exists():
            return found

        for entry in models_dir.glob("*.gguf"):
            if entry.is_file():
                size_gb = round(entry.stat().st_size / (1024 ** 3), 2)
                found.append(GgufModelInfo(name=entry.stem, path=str(entry), size_gb=size_gb))
        return found

    async def start_server(
        self,
        model_path: str,
        context_size: int = 4096,
        n_gpu_layers: int = 99,
    ) -> bool:
        """Start llama-server in the background with the given model."""
        binary = self.find_binary()
        if not binary:
            raise FileNotFoundError(
                f"llama-server no encontrado. Usa la opción de descarga automática o colócalo en {get_helix_bin_dir()}."
            )

        resolved_model = Path(model_path)
        if not resolved_model.is_file():
            # Check inside Helix models folder
            candidate = get_helix_models_dir() / model_path
            if candidate.is_file():
                resolved_model = candidate
            elif (get_helix_models_dir() / f"{model_path}.gguf").is_file():
                resolved_model = get_helix_models_dir() / f"{model_path}.gguf"
            else:
                raise FileNotFoundError(f"Archivo de modelo no encontrado: {model_path}")

        # Stop existing process if running
        await self.stop_server()

        cmd = [
            binary,
            "-m", str(resolved_model),
            "--host", self.host,
            "--port", str(self.port),
            "-c", str(context_size),
            "-ngl", str(n_gpu_layers),
        ]

        logger.info("Starting llama-server: %s", " ".join(cmd))
        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self._active_model_path = str(resolved_model)
        except Exception as exc:
            logger.exception("Failed to spawn llama-server: %s", exc)
            return False

        # Wait up to 15 seconds for /health
        for _ in range(30):
            await asyncio.sleep(0.5)
            if await self.is_running():
                logger.info("llama-server is healthy on %s", self.base_url)
                return True

        logger.warning("llama-server did not become healthy within 15 seconds")
        return False

    async def stop_server(self) -> bool:
        """Terminate the server process."""
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
            finally:
                self._process = None
                self._active_model_path = None
        return True

    # ── Automated Download Helpers ──────────────────────────────────────────

    async def download_binary(
        self,
        on_progress: Optional[Any] = None,
    ) -> DownloadProgress:
        """Download official portable llama-server executable into %APPDATA%/Helix/bin/."""
        bin_dir = get_helix_bin_dir()
        target_exe = bin_dir / ("llama-server.exe" if platform.system() == "Windows" else "llama-server")

        if target_exe.is_file():
            return DownloadProgress(status="already_installed", percent=100.0, done=True)

        url = LLAMA_CPP_WIN_ZIP_URL
        progress = DownloadProgress(status="downloading_binary", percent=0.0)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=600)) as resp:
                    if resp.status != 200:
                        return DownloadProgress(
                            status="error",
                            done=True,
                            error=f"HTTP {resp.status} al descargar llama.cpp",
                        )

                    total_bytes = int(resp.headers.get("content-length", 0))
                    buffer = bytearray()

                    async for chunk in resp.content.iter_chunked(65536):
                        buffer.extend(chunk)
                        if total_bytes > 0:
                            pct = round(len(buffer) / total_bytes * 100, 1)
                            progress = DownloadProgress(
                                status="downloading",
                                percent=pct,
                                completed_bytes=len(buffer),
                                total_bytes=total_bytes,
                            )
                            if on_progress:
                                try:
                                    if asyncio.iscoroutinefunction(on_progress):
                                        await on_progress(progress)
                                    else:
                                        on_progress(progress)
                                except Exception:
                                    pass

            # Extract zip in memory
            progress.status = "extracting"
            if on_progress:
                try:
                    on_progress(progress)
                except Exception:
                    pass

            with zipfile.ZipFile(io.BytesIO(buffer)) as z:
                # Extract llama-server.exe and any required dlls
                for member in z.namelist():
                    basename = Path(member).name
                    if basename.lower().startswith("llama-server") or basename.lower().endswith(".dll"):
                        source = z.open(member)
                        target = bin_dir / basename
                        with open(target, "wb") as f_out:
                            shutil.copyfileobj(source, f_out)

            progress = DownloadProgress(status="completed", percent=100.0, done=True)
            return progress

        except Exception as exc:
            logger.exception("Failed to download llama-server binary: %s", exc)
            return DownloadProgress(status="error", done=True, error=str(exc))

    async def download_gguf_model(
        self,
        model_id: str,
        on_progress: Optional[Any] = None,
    ) -> DownloadProgress:
        """Download a curated GGUF model directly from Hugging Face."""
        meta = CURATED_GGUF_MODELS.get(model_id)
        if not meta:
            return DownloadProgress(
                status="error",
                done=True,
                error=f"Modelo '{model_id}' no está en la lista de modelos curados",
            )

        models_dir = get_helix_models_dir()
        target_file = models_dir / meta["filename"]

        if target_file.is_file():
            return DownloadProgress(status="already_installed", percent=100.0, done=True)

        url = meta["url"]
        temp_file = target_file.with_suffix(".part")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=3600)) as resp:
                    if resp.status != 200:
                        return DownloadProgress(
                            status="error",
                            done=True,
                            error=f"HTTP {resp.status} al descargar el modelo desde Hugging Face",
                        )

                    total_bytes = int(resp.headers.get("content-length", 0))
                    downloaded = 0

                    with open(temp_file, "wb") as f_out:
                        async for chunk in resp.content.iter_chunked(262144):  # 256KB chunks
                            f_out.write(chunk)
                            downloaded += len(chunk)
                            if total_bytes > 0:
                                pct = round(downloaded / total_bytes * 100, 1)
                                prog = DownloadProgress(
                                    status="downloading",
                                    percent=pct,
                                    completed_bytes=downloaded,
                                    total_bytes=total_bytes,
                                )
                                if on_progress:
                                    try:
                                        if asyncio.iscoroutinefunction(on_progress):
                                            await on_progress(prog)
                                        else:
                                            on_progress(prog)
                                    except Exception:
                                        pass

            temp_file.rename(target_file)
            return DownloadProgress(status="completed", percent=100.0, done=True)

        except Exception as exc:
            if temp_file.is_file():
                try:
                    temp_file.unlink()
                except Exception:
                    pass
            logger.exception("Failed to download GGUF model: %s", exc)
            return DownloadProgress(status="error", done=True, error=str(exc))

    async def get_status(self) -> dict:
        running = await self.is_running()
        models = self.list_local_models()
        return {
            "installed": self.is_installed(),
            "binary_path": self.find_binary(),
            "running": running,
            "port": self.port,
            "base_url": self.base_url,
            "active_model": self._active_model_path if running else None,
            "models_dir": str(get_helix_models_dir()),
            "models": [{"name": m.name, "path": m.path, "size_gb": m.size_gb} for m in models],
            "curated_catalog": list(CURATED_GGUF_MODELS.values()),
        }


# Global singleton
_manager: Optional[LlamaServerManager] = None


def get_llama_server_manager() -> LlamaServerManager:
    global _manager
    if _manager is None:
        _manager = LlamaServerManager()
    return _manager
