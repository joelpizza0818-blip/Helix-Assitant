try:
    import openai
except ImportError:
    openai = None
from typing import AsyncIterator, List, Dict
from .base_provider import BaseAIProvider, ChatMessage, ChatResponse, StreamChunk, ToolCallResponse, Usage, ModelDefinition, ModelCapabilities, AgentError, KeyHealth

class OpenAIProvider(BaseAIProvider):
    @property
    def provider_id(self) -> str:
        return "openai"
    
    @property
    def provider_name(self) -> str:
        return "OpenAI"

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
        msg = str(exception)
        code = "UNKNOWN"
        retryable = False
        if isinstance(exception, openai.AuthenticationError):
            code, retryable = "AUTH_ERROR", False
        elif isinstance(exception, openai.RateLimitError):
            code, retryable = "RATE_LIMIT", True
            if "quota" in msg.lower(): code = "QUOTA_EXCEEDED"
        elif isinstance(exception, openai.InternalServerError):
            code, retryable = "TEMPORARY_PROVIDER_ERROR", True
        elif isinstance(exception, openai.APIConnectionError):
            code, retryable = "NETWORK_ERROR", True
        elif isinstance(exception, openai.APITimeoutError):
            code, retryable = "TIMEOUT", True
        elif isinstance(exception, openai.BadRequestError):
            code, retryable = "INVALID_REQUEST", False
            if "content policy" in msg.lower(): code = "CONTENT_POLICY"
        return AgentError(code=code, message=msg, provider=self.provider_id, model="unknown", retryable=retryable, original_exception=exception)
