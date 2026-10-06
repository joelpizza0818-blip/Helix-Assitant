from typing import AsyncIterator, List, Dict
from .base_provider import BaseAIProvider, ChatMessage, ChatResponse, StreamChunk, ToolCallResponse, Usage, ModelDefinition, ModelCapabilities, AgentError, KeyHealth

class GoogleProvider(BaseAIProvider):
    @property
    def provider_id(self) -> str:
        return "google"
    
    @property
    def provider_name(self) -> str:
        return "Google"

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        return ChatResponse(content="mock", model=model, provider=self.provider_id, usage=Usage(0,0,0), finish_reason="stop")

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(delta="mock", done=True, model=model, provider=self.provider_id)

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        return ToolCallResponse(tool_calls=[], content="", model=model, provider=self.provider_id)

    async def structured_output(self, messages: List[ChatMessage], schema: Dict, model: str, **kwargs) -> dict:
        return {}

    def get_available_models(self) -> List[ModelDefinition]:
        from .capability_registry import CapabilityRegistry
        return CapabilityRegistry().get_models_for_provider(self.provider_id)

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        return ModelCapabilities()

    async def validate_key(self, api_key: str) -> KeyHealth:
        return KeyHealth.HEALTHY

    def normalize_error(self, exception: Exception) -> AgentError:
        return AgentError(code="UNKNOWN", message=str(exception), provider=self.provider_id, model="unknown", retryable=False, original_exception=exception)
