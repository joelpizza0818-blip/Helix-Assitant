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
import hashlib
import logging
import os
import platform
import re
import shutil
import subprocess
import tempfile
import zipfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from services.agent.storage_paths import get_storage_root

logger = logging.getLogger(__name__)

DEFAULT_LLAMA_SERVER_PORT = 8080
DEFAULT_LLAMA_SERVER_HOST = "127.0.0.1"

LLAMA_CPP_RELEASES_URL = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20"

# Official Qwen3 GGUFs. File sizes and filenames are from each Hugging Face
# repository's current tree; RAM figures include working memory beyond weights.
CURATED_GGUF_MODELS: Dict[str, Dict[str, Any]] = {
    "qwen3-0.6b": {
        "id": "qwen3-0.6b",
        "repo": "Qwen/Qwen3-0.6B-GGUF",
        "filename": "Qwen3-0.6B-Q8_0.gguf",
        "display_name": "Qwen3 0.6B · Ligero",
        "parameters": "0.6B",
        "quantization": "Q8_0",
        "size_gb": 0.64,
        "size_bytes": 639446688,
        "sha256": "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
        "recommended_ram_gb": 4,
        "category": "Ligero",
        "url": "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf",
        "description": "Para equipos modestos y tareas sencillas; admite llamadas a herramientas.",
    },
    "qwen3-1.7b": {
        "id": "qwen3-1.7b",
        "repo": "Qwen/Qwen3-1.7B-GGUF",
        "filename": "Qwen3-1.7B-Q8_0.gguf",
        "display_name": "Qwen3 1.7B · Ligero",
        "parameters": "1.7B",
        "quantization": "Q8_0",
        "size_gb": 1.83,
        "size_bytes": 1834426016,
        "sha256": "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
        "recommended_ram_gb": 6,
        "category": "Ligero",
        "url": "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf",
        "description": "Más capacidad manteniendo un consumo moderado; admite llamadas a herramientas.",
    },
    "qwen3-4b": {
        "id": "qwen3-4b",
        "repo": "Qwen/Qwen3-4B-GGUF",
        "filename": "Qwen3-4B-Q4_K_M.gguf",
        "display_name": "Qwen3 4B · Estándar",
        "parameters": "4B",
        "quantization": "Q4_K_M",
        "size_gb": 2.50,
        "size_bytes": 2497280256,
        "sha256": "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        "recommended_ram_gb": 8,
        "category": "Estándar",
        "url": "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        "description": "Equilibrio entre calidad y recursos; plantilla de chat compatible con herramientas.",
    },
    "qwen3-8b": {
        "id": "qwen3-8b",
        "repo": "Qwen/Qwen3-8B-GGUF",
        "filename": "Qwen3-8B-Q4_K_M.gguf",
        "display_name": "Qwen3 8B · Medio-alto",
        "parameters": "8B",
        "quantization": "Q4_K_M",
        "size_gb": 5.03,
        "size_bytes": 5027783488,
        "sha256": "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
        "recommended_ram_gb": 12,
        "category": "Medio-alto",
        "url": "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        "description": "Mayor calidad para tareas generales y de agente; plantilla compatible con herramientas.",
    },
    "qwen3-14b": {
        "id": "qwen3-14b",
        "repo": "Qwen/Qwen3-14B-GGUF",
        "filename": "Qwen3-14B-Q4_K_M.gguf",
        "display_name": "Qwen3 14B · Alto",
        "parameters": "14B",
        "quantization": "Q4_K_M",
        "size_gb": 9.01,
        "size_bytes": 9001752960,
        "sha256": "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
        "recommended_ram_gb": 20,
        "category": "Alto",
        "url": "https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf",
        "description": "Para equipos con memoria amplia; la RAM recomendada contempla memoria de trabajo.",
    },
    "qwen3-32b": {
        "id": "qwen3-32b",
        "repo": "Qwen/Qwen3-32B-GGUF",
        "filename": "Qwen3-32B-Q4_K_M.gguf",
        "display_name": "Qwen3 32B · Alto",
        "parameters": "32B",
        "quantization": "Q4_K_M",
        "size_gb": 19.76,
        "size_bytes": 19762149024,
        "sha256": "efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689",
        "recommended_ram_gb": 40,
        "category": "Alto",
        "url": "https://huggingface.co/Qwen/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q4_K_M.gguf",
        "description": "Opción de mayor capacidad; requiere mucha memoria y almacenamiento disponible.",
    },
}


def get_default_helix_dir() -> Path:
    """Return the shared HELIX storage directory for binaries and models."""
    if os.environ.get("HELIX_STORAGE_DIR") or platform.system() == "Windows":
        return get_storage_root()
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
    model_id: Optional[str] = None
    source: str = "local"


def _model_scan_roots() -> List[Path]:
    """Return bounded, conventional locations where users keep GGUF files."""
    home = Path.home()
    roots = [
        get_helix_models_dir(),
        home / "Downloads",
        home / "Documents",
        home / "Desktop",
        home / ".cache" / "llama.cpp",
        home / ".cache" / "huggingface" / "hub",
        get_storage_root() / "cache" / "huggingface" / "hub",
        home / ".lmstudio" / "models",
    ]
    roaming = os.environ.get("APPDATA")
    if roaming:
        roots.append(Path(roaming) / "Helix" / "models")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        roots.append(Path(local_app_data) / "LM Studio" / "models")
    configured = os.environ.get("HELIX_GGUF_DIRS", "")
    roots.extend(Path(item.strip()) for item in configured.split(os.pathsep) if item.strip())

    unique: List[Path] = []
    seen = set()
    for root in roots:
        key = os.path.normcase(os.path.abspath(root))
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def _select_windows_cpu_asset(
    releases: List[Dict[str, Any]], machine: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    architecture = (machine or platform.machine()).lower()
    if architecture in {"arm64", "aarch64"}:
        asset_suffix = "arm64"
    elif architecture in {"amd64", "x86_64", "x64"}:
        asset_suffix = "x64"
    else:
        return None

    for release in releases:
        for asset in release.get("assets", []):
            name = asset.get("name", "")
            asset_pattern = rf"llama-b\d+-bin-win-cpu-{asset_suffix}\.zip"
            checksum = asset.get("digest")
            if (
                re.fullmatch(asset_pattern, name)
                and isinstance(checksum, str)
                and checksum.startswith("sha256:")
            ):
                return asset
    return None


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
        self._last_scan_errors: List[str] = []

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def active_model_path(self) -> Optional[str]:
        return self._active_model_path

    def find_binary(self) -> Optional[str]:
        """Locate llama-server in Helix, common llama.cpp folders, or PATH."""
        exe_name = "llama-server.exe" if platform.system() == "Windows" else "llama-server"
        candidates = []
        configured_server = os.environ.get("LLAMA_SERVER_PATH")
        if configured_server:
            candidates.append(Path(configured_server))
        cpp_root = os.environ.get("LLAMA_CPP_PATH")
        if cpp_root:
            root = Path(cpp_root)
            candidates.extend((root / exe_name, root / "build" / "bin" / exe_name, root / "bin" / exe_name))
        candidates.extend((
            get_helix_bin_dir() / exe_name,
            Path(__file__).resolve().parents[3] / "bin" / exe_name,
        ))
        if platform.system() == "Windows":
            user = Path.home()
            local = Path(os.environ.get("LOCALAPPDATA", str(user / "AppData" / "Local")))
            roaming = os.environ.get("APPDATA")
            candidates.extend((
                user / "llama.cpp" / "build" / "bin" / exe_name,
                local / "Programs" / "llama.cpp" / exe_name,
                Path("C:/llama.cpp/build/bin") / exe_name,
            ))
            if roaming:
                candidates.append(Path(roaming) / "Helix" / "bin" / exe_name)
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
        return shutil.which("llama-server")

    def find_cpp_binary(self) -> Optional[str]:
        """Detect llama.cpp even when only its CLI, not llama-server, is present."""
        server = self.find_binary()
        if server:
            return server
        exe_name = "llama-cli.exe" if platform.system() == "Windows" else "llama-cli"
        candidates = []
        cpp_root = os.environ.get("LLAMA_CPP_PATH")
        if cpp_root:
            root = Path(cpp_root)
            candidates.extend((root / exe_name, root / "build" / "bin" / exe_name, root / "bin" / exe_name))
        if platform.system() == "Windows":
            candidates.extend((
                Path.home() / "llama.cpp" / "build" / "bin" / exe_name,
                Path("C:/llama.cpp/build/bin") / exe_name,
            ))
            roaming = os.environ.get("APPDATA")
            if roaming:
                candidates.append(Path(roaming) / "Helix" / "bin" / exe_name)
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
        return shutil.which("llama-cli")

    def is_installed(self) -> bool:
        return self.find_binary() is not None

    def has_local_agent_model(self) -> bool:
        return self.is_installed() and bool(self.list_local_models())

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
        """Find GGUF files in Helix and common user model/download folders."""
        found: Dict[str, GgufModelInfo] = {}
        errors: List[str] = []
        model_ids_by_filename = {
            meta["filename"].casefold(): model_id
            for model_id, meta in CURATED_GGUF_MODELS.items()
        }
        directories_seen = 0
        entries_seen = 0
        for root in _model_scan_roots():
            if not root.is_dir():
                continue
            queue = deque([(root, 0)])
            while queue and directories_seen < 3000 and entries_seen < 20000:
                directory, depth = queue.popleft()
                try:
                    with os.scandir(directory) as entries:
                        for entry in entries:
                            entries_seen += 1
                            if (
                                entry.is_file(follow_symlinks=True)
                                and entry.name.casefold().endswith(".gguf")
                            ):
                                path = Path(entry.path)
                                try:
                                    size_gb = round(
                                        entry.stat(follow_symlinks=True).st_size
                                        / (1024 ** 3),
                                        2,
                                    )
                                except OSError as exc:
                                    errors.append(str(path))
                                    logger.debug(
                                        "Could not read GGUF metadata at %s: %s",
                                        path,
                                        exc,
                                    )
                                    continue
                                key = os.path.normcase(os.path.abspath(path))
                                found.setdefault(
                                    key,
                                    GgufModelInfo(
                                        name=path.stem,
                                        path=str(path),
                                        size_gb=size_gb,
                                        model_id=model_ids_by_filename.get(
                                            path.name.casefold()
                                        ),
                                        source=str(root),
                                    ),
                                )
                            elif (
                                depth < 3
                                and entry.is_dir(follow_symlinks=False)
                                and entry.name.casefold() not in {
                                    ".git",
                                    "node_modules",
                                    "__pycache__",
                                    "venv",
                                    ".venv",
                                }
                            ):
                                queue.append((Path(entry.path), depth + 1))
                    directories_seen += 1
                except OSError as exc:
                    errors.append(str(directory))
                    logger.debug("Could not scan local model directory %s: %s", directory, exc)
        if entries_seen >= 20000 or directories_seen >= 3000:
            logger.warning(
                "Stopped GGUF scan at its safety limit (%d entries, %d directories)",
                entries_seen,
                directories_seen,
            )
        self._last_scan_errors = errors
        return sorted(
            found.values(),
            key=lambda model: (model.name.casefold(), model.path.casefold()),
        )

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
        """Download the official portable llama-server into HELIX storage."""
        bin_dir = get_helix_bin_dir()
        target_exe = bin_dir / ("llama-server.exe" if platform.system() == "Windows" else "llama-server")

        if target_exe.is_file():
            return DownloadProgress(status="already_installed", percent=100.0, done=True)
        if self.find_cpp_binary():
            return DownloadProgress(
                status="server_missing",
                done=True,
                error=(
                    "Se detectó llama.cpp, pero no llama-server. Agrega llama-server "
                    "al PATH o a la carpeta de llama.cpp."
                ),
            )
        if platform.system() != "Windows":
            return DownloadProgress(
                status="unsupported_platform",
                done=True,
                error="La descarga automática del binario solo está disponible para Windows.",
            )

        progress = DownloadProgress(status="downloading_binary", percent=0.0)
        temp_zip: Optional[Path] = None
        staging_dir: Optional[Path] = None

        try:
            async with aiohttp.ClientSession(
                headers={"User-Agent": "HelixAssistant"}
            ) as session:
                async with session.get(
                    LLAMA_CPP_RELEASES_URL,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status != 200:
                        return DownloadProgress(
                            status="error",
                            done=True,
                            error=f"HTTP {resp.status} al consultar las versiones de llama.cpp",
                        )
                    releases = await resp.json()

                asset = _select_windows_cpu_asset(releases)
                if not asset:
                    return DownloadProgress(
                        status="error",
                        done=True,
                        error="No se encontró una versión oficial verificable de llama.cpp para esta arquitectura.",
                    )
                url = asset.get("browser_download_url", "")
                if not url.startswith(
                    "https://github.com/ggml-org/llama.cpp/releases/download/"
                ):
                    return DownloadProgress(
                        status="error",
                        done=True,
                        error="La URL de descarga de llama.cpp no es válida.",
                    )

                temp_fd, temp_path = tempfile.mkstemp(
                    prefix="llama-cpp-", suffix=".zip.part", dir=bin_dir
                )
                os.close(temp_fd)
                temp_zip = Path(temp_path)
                digest = hashlib.sha256()
                downloaded = 0
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=600)
                ) as resp:
                    if resp.status != 200:
                        return DownloadProgress(
                            status="error",
                            done=True,
                            error=f"HTTP {resp.status} al descargar llama.cpp",
                        )
                    total_bytes = int(resp.headers.get("content-length", asset["size"]))
                    with temp_zip.open("wb") as f_out:
                        async for chunk in resp.content.iter_chunked(65536):
                            f_out.write(chunk)
                            digest.update(chunk)
                            downloaded += len(chunk)
                            if total_bytes > 0:
                                pct = round(downloaded / total_bytes * 100, 1)
                                progress = DownloadProgress(
                                    status="downloading",
                                    percent=pct,
                                    completed_bytes=downloaded,
                                    total_bytes=total_bytes,
                                )
                                if on_progress:
                                    try:
                                        if asyncio.iscoroutinefunction(on_progress):
                                            await on_progress(progress)
                                        else:
                                            on_progress(progress)
                                    except Exception:
                                        logger.debug("llama.cpp progress callback failed")

                if digest.hexdigest() != asset["digest"].removeprefix("sha256:"):
                    return DownloadProgress(
                        status="error",
                        done=True,
                        error="La verificación SHA-256 del binario de llama.cpp falló.",
                    )

                staging_dir = Path(
                    tempfile.mkdtemp(prefix=".llama-install-", dir=bin_dir)
                )
                progress = DownloadProgress(status="extracting")
                if on_progress:
                    try:
                        if asyncio.iscoroutinefunction(on_progress):
                            await on_progress(progress)
                        else:
                            on_progress(progress)
                    except Exception:
                        logger.debug("llama.cpp progress callback failed")

                with zipfile.ZipFile(temp_zip) as archive:
                    extracted_server = False
                    for member in archive.infolist():
                        basename = Path(member.filename).name
                        lowered = basename.lower()
                        if not (
                            lowered == "llama-server.exe"
                            or lowered.endswith(".dll")
                        ):
                            continue
                        staged_file = staging_dir / basename
                        with archive.open(member) as source, staged_file.open("wb") as target:
                            shutil.copyfileobj(source, target)
                        if lowered == "llama-server.exe":
                            extracted_server = True

                if not extracted_server:
                    return DownloadProgress(
                        status="error",
                        done=True,
                        error="El archivo oficial no contiene llama-server.exe.",
                    )

                for staged_file in staging_dir.iterdir():
                    os.replace(staged_file, bin_dir / staged_file.name)

            return DownloadProgress(status="completed", percent=100.0, done=True)
        except Exception as exc:
            logger.exception("Failed to download llama-server binary: %s", exc)
            return DownloadProgress(status="error", done=True, error=str(exc))
        finally:
            if temp_zip:
                temp_zip.unlink(missing_ok=True)
            if staging_dir:
                shutil.rmtree(staging_dir, ignore_errors=True)

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
                    digest = hashlib.sha256()

                    with open(temp_file, "wb") as f_out:
                        async for chunk in resp.content.iter_chunked(262144):  # 256KB chunks
                            f_out.write(chunk)
                            digest.update(chunk)
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

            if downloaded != meta["size_bytes"] or digest.hexdigest() != meta["sha256"]:
                raise ValueError(
                    f"El archivo descargado no coincide con el tamaño o SHA-256 esperado para {meta['filename']}."
                )
            temp_file.replace(target_file)
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
        binary_path = self.find_binary()
        cpp_binary_path = self.find_cpp_binary()
        running = await self.is_running()
        models = self.list_local_models()
        return {
            "installed": binary_path is not None,
            "binary_path": binary_path,
            "llama_cpp_installed": cpp_binary_path is not None,
            "llama_cpp_path": cpp_binary_path,
            "running": running,
            "port": self.port,
            "base_url": self.base_url,
            "active_model": self._active_model_path if running else None,
            "models_dir": str(get_helix_models_dir()),
            "models": [
                {
                    "name": m.name,
                    "path": m.path,
                    "size_gb": m.size_gb,
                    "model_id": m.model_id,
                    "source": m.source,
                }
                for m in models
            ],
            "scan_errors": self._last_scan_errors,
            "curated_catalog": list(CURATED_GGUF_MODELS.values()),
        }


# Global singleton
_manager: Optional[LlamaServerManager] = None


def get_llama_server_manager() -> LlamaServerManager:
    global _manager
    if _manager is None:
        _manager = LlamaServerManager()
    return _manager
