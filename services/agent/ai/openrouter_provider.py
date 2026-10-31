"""OpenRouter AI Provider for Helix Assistant.

All-in-one cloud access to open-weights and proprietary models via OpenRouter's unified endpoint.
Supports free-tier (:free) and standard BYOK paid models with automatic rate limit normalization.
"""

from __future__ import annotations

import logging
import os
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

logger = logging.getLogger(__name__)

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterProvider(OpenAIProvider):
    """Provides access to models via OpenRouter."""

    def __init__(self, base_url: str = DEFAULT_OPENROUTER_BASE_URL):
        self._base_url = os.environ.get("OPENROUTER_BASE_URL", base_url).rstrip("/")

    @property
    def provider_id(self) -> str:
        return "openrouter"

    @property
    def provider_name(self) -> str:
        return "OpenRouter"

    def _client(self, api_key: str, base_url: str | None = None):
        client = super()._client(api_key=api_key, base_url=base_url or self._base_url)
        # OpenRouter standard headers for ranking and client identification
        client.default_headers = {
            **getattr(client, "default_headers", {}),
            "HTTP-Referer": "https://helix.assistant",
            "X-Title": "Helix Assistant",
        }
        return client

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
        """Validate key by querying OpenRouter model list."""
        if not api_key or not api_key.strip():
            return KeyHealth.UNCONFIGURED
        try:
            client = self._client(api_key.strip())
            await client.models.list()
            return KeyHealth.HEALTHY
        except Exception as exc:
            err = self.normalize_error(exc)
            if err.code == "AUTH_ERROR":
                return KeyHealth.AUTH_ERROR
            elif err.code == "RATE_LIMIT":
                return KeyHealth.RATE_LIMITED
            elif err.code == "QUOTA_EXCEEDED":
                return KeyHealth.QUOTA_EXCEEDED
            return KeyHealth.UNAVAILABLE
