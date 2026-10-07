from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, AsyncIterator, List, Optional, Dict
from enum import Enum

class KeyHealth(Enum):
    HEALTHY = "HEALTHY"
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    AUTH_ERROR = "AUTH_ERROR"
    UNAVAILABLE = "UNAVAILABLE"
    UNCONFIGURED = "UNCONFIGURED"

@dataclass
class ChatMessage:
    role: str
    content: str
    tool_calls: Optional[List[Dict]] = None
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    image_bytes: Optional[bytes] = None
    provider_data: Any = None

@dataclass
class Usage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int

@dataclass
class ChatResponse:
    content: str
    model: str
    provider: str
    usage: Usage
    finish_reason: str

@dataclass
class StreamChunk:
    delta: str
    done: bool
    model: str
    provider: str

@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict

@dataclass
class ToolCallResponse:
    tool_calls: List[ToolCall]
    content: str
    model: str
    provider: str
    provider_data: Any = None

@dataclass
class ModelCapabilities:
    text: bool = False
    vision: bool = False
    audio: bool = False
    realtime: bool = False
    tool_calling: bool = False
    function_calling: bool = False
    structured_output: bool = False
    computer_use: bool = False
    browser_use: bool = False
    coding: bool = False
    reasoning: bool = False
    streaming: bool = False
    speech_to_text: bool = False
    text_to_speech: bool = False
    low_latency: bool = False
    long_context: bool = False
    context_window: int = 8192
    cost_tier: str = "medium"

@dataclass
class ModelDefinition:
    id: str
    provider: str
    display_name: str
    capabilities: ModelCapabilities
    priority: int = 0
    enabled: bool = True
    fallback_group: Optional[str] = None

@dataclass
class AgentError(Exception):
    code: str
    message: str
    provider: str
    model: str
    retryable: bool
    original_exception: Optional[Exception] = None

    def __str__(self) -> str:
        return self.message

class BaseAIProvider(ABC):
    @property
    @abstractmethod
    def provider_id(self) -> str:
        pass

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @abstractmethod
    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        pass

    @abstractmethod
    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        pass

    @abstractmethod
    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        pass

    @abstractmethod
    async def structured_output(self, messages: List[ChatMessage], schema: Dict, model: str, **kwargs) -> dict:
        pass

    @abstractmethod
    def get_available_models(self) -> List[ModelDefinition]:
        pass

    @abstractmethod
    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        pass

    @abstractmethod
    async def validate_key(self, api_key: str) -> KeyHealth:
        pass

    @abstractmethod
    def normalize_error(self, exception: Exception) -> AgentError:
        pass
