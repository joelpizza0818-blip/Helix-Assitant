"""Free cloud and local AI model providers for 0-cost execution.

Supports:
1. FreeModelProvider: Auto-routed public/free OpenAI-compatible tiers
   (e.g., OpenRouter free models, Llama 3.2 3B, Qwen 2.5, DeepSeek R1).
   Features automatic transparent fallback to the next free model if rate-limited.
2. OllamaProvider: Local models running on the user's computer (0 cost, 100% private).
"""

import logging
import os
from typing import AsyncIterator, List, Dict, Optional
from .base_provider import (
    BaseAIProvider,
    ChatMessage,
    ChatResponse,
    StreamChunk,
    ToolCallResponse,
    ModelDefinition,
    ModelCapabilities,
    KeyHealth,
    AgentError,
)
from .openai_provider import OpenAIProvider

logger = logging.getLogger(__name__)

# Fallback sequence of free tier models
DEFAULT_FREE_MODELS = [
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen-2.5-coder-7b-instruct:free",
    "deepseek/deepseek-r1:free",
    "google/gemini-2.0-flash-exp:free",
]

DEFAULT_OLLAMA_MODELS = [
    "llama3.2:3b",
    "qwen2.5-coder:1.5b",
    "deepseek-r1:1.5b",
]


class FreeModelProvider(OpenAIProvider):
    """Provides access to 0-cost cloud models with automatic fallback upon rate-limits."""

    no_key_required = True

    def __init__(self, base_url: str = "https://openrouter.ai/api/v1", api_key: Optional[str] = None):
        self._base_url = os.environ.get("HELIX_FREE_MODELS_URL", base_url).rstrip("/")
        # User or default public free routing key
        self._api_key = api_key or os.environ.get("OPENROUTER_API_KEY") or os.environ.get("HELIX_FREE_API_KEY") or "free-tier"

    @property
    def provider_id(self) -> str:
        return "free"

    @property
    def provider_name(self) -> str:
        return "Helix Free Tier (0-Cost)"

    def _client(self, api_key: str, base_url: str | None = None):
        key_to_use = self._api_key if (not api_key or api_key == "free-tier") else api_key
        url_to_use = base_url or self._base_url
        client = super()._client(api_key=key_to_use, base_url=url_to_use)
        # OpenRouter expects HTTP-Referer and X-Title for free model routing
        client.default_headers = {
            **getattr(client, "default_headers", {}),
            "HTTP-Referer": "https://helix.assistant",
            "X-Title": "Helix Assistant",
        }
        return client

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        models_to_try = [model] + [m for m in DEFAULT_FREE_MODELS if m != model]
        last_error = None

        for target_model in models_to_try:
            try:
                return await super().chat(
                    messages=messages,
                    model=target_model,
                    api_key=kwargs.get("api_key", self._api_key),
                    base_url=self._base_url,
                    **kwargs,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Free model %s failed (%s); attempting automatic free fallback...",
                    target_model,
                    exc,
                )
        raise self.normalize_error(last_error or RuntimeError("All free models exhausted"))

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        async for chunk in super().stream(
            messages=messages,
            model=model,
            api_key=kwargs.get("api_key", self._api_key),
            base_url=self._base_url,
            **kwargs,
        ):
            yield chunk

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        models_to_try = [model] + [m for m in DEFAULT_FREE_MODELS if m != model]
        last_error = None

        for target_model in models_to_try:
            try:
                return await super().tool_call(
                    messages=messages,
                    tools=tools,
                    model=target_model,
                    api_key=kwargs.get("api_key", self._api_key),
                    base_url=self._base_url,
                    **kwargs,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Free tool call on %s failed (%s); trying fallback free model...",
                    target_model,
                    exc,
                )
        raise self.normalize_error(last_error or RuntimeError("Free models tool calling unavailable"))

    def get_available_models(self) -> List[ModelDefinition]:
        return [
            ModelDefinition(
                id="meta-llama/llama-3.2-3b-instruct:free",
                provider="free",
                display_name="Llama 3.2 3B Free",
                capabilities=ModelCapabilities(text=True, tool_calling=True, streaming=True, low_latency=True, cost_tier="low"),
                priority=90,
            ),
            ModelDefinition(
                id="qwen/qwen-2.5-coder-7b-instruct:free",
                provider="free",
                display_name="Qwen 2.5 Coder Free",
                capabilities=ModelCapabilities(text=True, tool_calling=True, streaming=True, coding=True, cost_tier="low"),
                priority=85,
            ),
            ModelDefinition(
                id="deepseek/deepseek-r1:free",
                provider="free",
                display_name="DeepSeek R1 Free",
                capabilities=ModelCapabilities(text=True, tool_calling=False, streaming=True, reasoning=True, cost_tier="low"),
                priority=80,
            ),
            ModelDefinition(
                id="google/gemini-2.0-flash-exp:free",
                provider="free",
                display_name="Gemini 2.0 Flash Free",
                capabilities=ModelCapabilities(text=True, vision=True, tool_calling=True, streaming=True, low_latency=True, cost_tier="low"),
                priority=88,
            ),
        ]

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        for m in self.get_available_models():
            if m.id == model_id:
                return m.capabilities
        return ModelCapabilities(text=True, tool_calling=True, streaming=True, cost_tier="low")

    async def validate_key(self, api_key: str) -> KeyHealth:
        return KeyHealth.HEALTHY


class OllamaProvider(OpenAIProvider):
    """Provides access to local models running in the user's Ollama instance (http://127.0.0.1:11434)."""

    no_key_required = True

    def __init__(self, base_url: str = "http://127.0.0.1:11434/v1"):
        self.base_url = base_url.rstrip("/")

    @property
    def provider_id(self) -> str:
        return "ollama"

    @property
    def provider_name(self) -> str:
        return "Ollama Local (PC)"

    def _client(self, api_key: str, base_url: str | None = None):
        return super()._client(api_key="ollama", base_url=base_url or self.base_url)

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        return await super().chat(messages=messages, model=model, api_key="ollama", base_url=self.base_url, **kwargs)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        async for chunk in super().stream(messages=messages, model=model, api_key="ollama", base_url=self.base_url, **kwargs):
            yield chunk

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        return await super().tool_call(messages=messages, tools=tools, model=model, api_key="ollama", base_url=self.base_url, **kwargs)

    def get_available_models(self) -> List[ModelDefinition]:
        return [
            ModelDefinition(
                id="llama3.2:3b",
                provider="ollama",
                display_name="Llama 3.2 3B Local",
                capabilities=ModelCapabilities(text=True, tool_calling=True, streaming=True, low_latency=True, cost_tier="low"),
                priority=70,
            ),
            ModelDefinition(
                id="qwen2.5-coder:1.5b",
                provider="ollama",
                display_name="Qwen 2.5 Coder 1.5B Local",
                capabilities=ModelCapabilities(text=True, tool_calling=True, streaming=True, coding=True, cost_tier="low"),
                priority=65,
            ),
            ModelDefinition(
                id="deepseek-r1:1.5b",
                provider="ollama",
                display_name="DeepSeek R1 1.5B Local",
                capabilities=ModelCapabilities(text=True, tool_calling=False, streaming=True, reasoning=True, cost_tier="low"),
                priority=60,
            ),
        ]

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        return ModelCapabilities(text=True, tool_calling=True, streaming=True, cost_tier="low")

    async def validate_key(self, api_key: str) -> KeyHealth:
        return KeyHealth.HEALTHY
