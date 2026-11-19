"""Llama Server AI Provider for Helix Assistant.

Connects to the local portable llama-server (llama.cpp) instance via its OpenAI-compatible endpoint.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

from .base_provider import (
    ChatMessage,
    ChatResponse,
    KeyHealth,
    ModelCapabilities,
    ModelDefinition,
    StreamChunk,
)
from .openai_provider import OpenAIProvider
from .llama_server_manager import get_llama_server_manager

logger = logging.getLogger(__name__)


class LlamaServerProvider(OpenAIProvider):
    """Provides local inference via llama-server (llama.cpp)."""

    no_key_required = True

    def __init__(self, base_url: str = "http://127.0.0.1:8080/v1"):
        self._base_url = base_url.rstrip("/")

    @property
    def provider_id(self) -> str:
        return "llama_server"

    @property
    def provider_name(self) -> str:
        return "Llama Server (llama.cpp Local)"

    def _client(self, api_key: str = "none", base_url: str | None = None):
        return super()._client(api_key=api_key or "none", base_url=base_url or self._base_url)

    async def _ensure_server(self, model: str) -> None:
        manager = get_llama_server_manager()
        models = manager.list_local_models()
        if not models:
            raise RuntimeError(
                "No hay modelos GGUF locales disponibles. Escanea o descarga un modelo desde los ajustes de IA."
            )
        if not manager.is_installed():
            raise RuntimeError(
                "llama-server no está instalado. Instálalo desde los ajustes de IA o configura LLAMA_SERVER_PATH."
            )
        selected_model = next(
            (
                local_model
                for local_model in models
                if model in {
                    local_model.path,
                    local_model.name,
                    local_model.model_id,
                }
            ),
            None,
        )
        model_path = (
            selected_model.path
            if selected_model
            else manager.active_model_path
            if manager.active_model_path
            and any(local_model.path == manager.active_model_path for local_model in models)
            else models[0].path
        )
        if await manager.is_running():
            if not manager.active_model_path or manager.active_model_path == model_path:
                return
        if not await manager.start_server(model_path):
            raise RuntimeError(f"No se pudo iniciar llama-server con el modelo local {Path(model_path).name}.")

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        await self._ensure_server(model)
        return await super().chat(messages=messages, model=model, base_url=self._base_url, **kwargs)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs):
        await self._ensure_server(model)
        async for chunk in super().stream(messages=messages, model=model, base_url=self._base_url, **kwargs):
            yield chunk

    async def tool_call(self, messages: List[ChatMessage], tools: List[dict], model: str, **kwargs):
        await self._ensure_server(model)
        return await super().tool_call(messages=messages, tools=tools, model=model, base_url=self._base_url, **kwargs)

    async def stream_tool_call(self, messages: List[ChatMessage], tools: List[dict], model: str, **kwargs):
        await self._ensure_server(model)
        return await super().stream_tool_call(
            messages=messages,
            tools=tools,
            model=model,
            base_url=self._base_url,
            **kwargs,
        )

    async def structured_output(self, messages: List[ChatMessage], schema: dict, model: str, **kwargs):
        await self._ensure_server(model)
        return await super().structured_output(messages=messages, schema=schema, model=model, base_url=self._base_url, **kwargs)

    async def validate_key(self, api_key: str) -> KeyHealth:
        """Llama Server is local and keyless; health is determined by server reachability."""
        mgr = get_llama_server_manager()
        if await mgr.is_running():
            return KeyHealth.HEALTHY
        return KeyHealth.UNAVAILABLE
