import platform
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.agent.ai.llama_server_manager import (
    CURATED_GGUF_MODELS,
    GgufModelInfo,
    LlamaServerManager,
    _select_windows_cpu_asset,
)


def test_selects_official_cpu_asset_for_windows_architecture():
    releases = [
        {
            "assets": [
                {
                    "name": "llama-b12445-bin-win-cpu-x64.zip",
                    "digest": "sha256:" + "a" * 64,
                },
                {
                    "name": "llama-b12445-bin-win-cpu-arm64.zip",
                    "digest": "sha256:" + "b" * 64,
                },
            ]
        }
    ]

    assert _select_windows_cpu_asset(releases, "AMD64")["name"].endswith("x64.zip")
    assert _select_windows_cpu_asset(releases, "ARM64")["name"].endswith("arm64.zip")
    assert _select_windows_cpu_asset(releases, "x86") is None


def test_rejects_runtime_assets_without_github_checksum():
    releases = [
        {
            "assets": [
                {
                    "name": "llama-b12445-bin-win-cpu-x64.zip",
                    "digest": "",
                }
            ]
        }
    ]

    assert _select_windows_cpu_asset(releases, "AMD64") is None


def test_recommended_catalog_covers_agent_model_size_categories():
    assert {model["category"] for model in CURATED_GGUF_MODELS.values()} == {
        "Ligero",
        "Estándar",
        "Medio-alto",
        "Alto",
    }
    assert all(
        model["repo"].startswith("Qwen/")
        and model["filename"].endswith(".gguf")
        and model["size_bytes"] > 0
        and len(model["sha256"]) == 64
        and model["recommended_ram_gb"] > model["size_gb"]
        for model in CURATED_GGUF_MODELS.values()
    )


def test_scans_gguf_models_in_nested_user_directories(monkeypatch, tmp_path):
    models_root = tmp_path / "Downloads"
    model_path = models_root / "local-agents" / "Qwen3-4B-Q4_K_M.gguf"
    model_path.parent.mkdir(parents=True)
    model_path.write_bytes(b"test gguf")
    monkeypatch.setattr(
        "services.agent.ai.llama_server_manager._model_scan_roots",
        lambda: [models_root, model_path.parent],
    )

    models = LlamaServerManager().list_local_models()

    assert len(models) == 1
    assert models[0].path == str(model_path)
    assert models[0].model_id == "qwen3-4b"
    assert models[0].source == str(models_root)


def test_finds_llama_server_inside_configured_llama_cpp_build(monkeypatch, tmp_path):
    executable = "llama-server.exe" if platform.system() == "Windows" else "llama-server"
    binary = tmp_path / "build" / "bin" / executable
    binary.parent.mkdir(parents=True)
    binary.touch()
    monkeypatch.setenv("LLAMA_CPP_PATH", str(tmp_path))
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.setattr(
        "services.agent.ai.llama_server_manager.get_helix_bin_dir",
        lambda: tmp_path / "helix-bin",
    )
    monkeypatch.setattr("shutil.which", lambda _name: None)

    assert LlamaServerManager().find_binary() == str(binary)


@pytest.mark.asyncio
async def test_existing_llama_cli_does_not_offer_a_second_runtime_download(
    monkeypatch, tmp_path
):
    manager = LlamaServerManager()
    monkeypatch.setattr(manager, "find_binary", lambda: None)
    monkeypatch.setattr(manager, "find_cpp_binary", lambda: str(tmp_path / "llama-cli"))
    monkeypatch.setattr(
        "services.agent.ai.llama_server_manager.get_helix_bin_dir",
        lambda: tmp_path,
    )

    result = await manager.download_binary()

    assert result.status == "server_missing"
    assert result.done
    assert "Se detectó llama.cpp" in result.error


@pytest.mark.asyncio
async def test_selected_local_gguf_is_started_for_agent_inference(monkeypatch, tmp_path):
    model = GgufModelInfo("agent-model", str(tmp_path / "agent.gguf"), 2.5)
    manager = MagicMock()
    manager.is_running = AsyncMock(return_value=False)
    manager.list_local_models.return_value = [model]
    manager.is_installed.return_value = True
    manager.active_model_path = None
    manager.start_server = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "services.agent.ai.llama_server_provider.get_llama_server_manager",
        lambda: manager,
    )

    from services.agent.ai.llama_server_provider import LlamaServerProvider

    await LlamaServerProvider()._ensure_server(model.path)

    manager.start_server.assert_awaited_once_with(model.path)
