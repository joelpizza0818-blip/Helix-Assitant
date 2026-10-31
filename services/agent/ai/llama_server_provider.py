"""Llama Server AI Provider for Helix Assistant.

Connects to the local portable llama-server (llama.cpp) instance via its OpenAI-compatible endpoint.
"""

from __future__ import annotations

import logging
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

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        return await super().chat(messages=messages, model=model, base_url=self._base_url, **kwargs)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs):
        async for chunk in super().stream(messages=messages, model=model, base_url=self._base_url, **kwargs):
            yield chunk

    async def tool_call(self, messages: List[ChatMessage], tools: List[dict], model: str, **kwargs):
        return await super().tool_call(messages=messages, tools=tools, model=model, base_url=self._base_url, **kwargs)

    async def structured_output(self, messages: List[ChatMessage], schema: dict, model: str, **kwargs):
        return await super().structured_output(messages=messages, schema=schema, model=model, base_url=self._base_url, **kwargs)

    async def validate_key(self, api_key: str) -> KeyHealth:
        """Llama Server is local and keyless; health is determined by server reachability."""
        mgr = get_llama_server_manager()
        if await mgr.is_running():
            return KeyHealth.HEALTHY
        return KeyHealth.UNAVAILABLE
