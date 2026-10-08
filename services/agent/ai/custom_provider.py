from typing import List

from .base_provider import ModelDefinition, ModelCapabilities
from .openai_provider import OpenAIProvider


class OpenAICompatibleProvider(OpenAIProvider):
    """OpenAI-compatible endpoint registered from desktop settings."""

    def __init__(self, endpoint_id: str, name: str, base_url: str, models: List[ModelDefinition] | None = None):
        if not endpoint_id or not base_url:
            raise ValueError("A custom endpoint requires an id and base URL")
        self._endpoint_id = endpoint_id
        self._name = name or endpoint_id
        self.base_url = base_url.rstrip("/")
        self._models = models or []

    @property
    def provider_id(self) -> str:
        return self._endpoint_id

    @property
    def provider_name(self) -> str:
        return self._name

    async def chat(self, messages, model: str, **kwargs):
        return await super().chat(messages, model, base_url=self.base_url, **kwargs)

    async def stream(self, messages, model: str, **kwargs):
        async for chunk in super().stream(messages, model, base_url=self.base_url, **kwargs):
            yield chunk

    async def tool_call(self, messages, tools, model: str, **kwargs):
        return await super().tool_call(messages, tools, model, base_url=self.base_url, **kwargs)

    async def structured_output(self, messages, schema, model: str, **kwargs):
        return await super().structured_output(messages, schema, model, base_url=self.base_url, **kwargs)

    def get_available_models(self) -> List[ModelDefinition]:
        return list(self._models)

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        for model in self._models:
            if model.id == model_id:
                return model.capabilities
        return ModelCapabilities(text=True, tool_calling=True, streaming=True)

    async def validate_key(self, api_key: str):
        # Local endpoints frequently do not implement /models.  A credential
        # is still valid for routing; the first real request remains the
        # authoritative connectivity check.
        return await super().validate_key(api_key)
