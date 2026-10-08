import base64
try:
    import openai
    from openai import AsyncOpenAI
except ImportError:
    openai = None
from typing import AsyncIterator, List, Dict
import json
from .base_provider import BaseAIProvider, ChatMessage, ChatResponse, StreamChunk, ToolCallResponse, Usage, ModelDefinition, ModelCapabilities, AgentError, KeyHealth, ToolCall

class OpenAIProvider(BaseAIProvider):
    def _client(self, api_key: str, base_url: str | None = None):
        if not openai:
            raise RuntimeError("openai SDK not installed")
        options = {"api_key": api_key}
        if base_url:
            options["base_url"] = base_url.rstrip("/")
        return AsyncOpenAI(**options)

    @property
    def provider_id(self) -> str:
        return "openai"
    
    @property
    def provider_name(self) -> str:
        return "OpenAI"

    def _convert_messages(self, messages: List[ChatMessage]) -> List[Dict]:
        converted = []
        for message in messages:
            content = message.content or None
            if message.image_bytes:
                content = []
                if message.content:
                    content.append({"type": "text", "text": message.content})
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{message.image_mime_type};base64,"
                        + base64.b64encode(message.image_bytes).decode("ascii"),
                    },
                })
            item = {"role": message.role, "content": content}
            if message.tool_calls:
                item["tool_calls"] = [
                    {
                        "id": call["id"],
                        "type": "function",
                        "function": {
                            "name": call["name"],
                            "arguments": json.dumps(call["arguments"]),
                        },
                    }
                    for call in message.tool_calls
                ]
            if message.tool_call_id:
                item["tool_call_id"] = message.tool_call_id
            converted.append(item)
        return converted

    @staticmethod
    def _convert_tools(tools: List[Dict]) -> List[Dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"],
                },
            }
            for tool in tools
        ]

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        if not openai: raise RuntimeError("openai SDK not installed")
        api_key = kwargs.get("api_key")
        client = self._client(api_key, kwargs.get("base_url"))
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=self._convert_messages(messages)
            )
            usage = Usage(
                prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
                completion_tokens=response.usage.completion_tokens if response.usage else 0,
                total_tokens=response.usage.total_tokens if response.usage else 0
            )
            return ChatResponse(
                content=response.choices[0].message.content or "",
                model=model,
                provider=self.provider_id,
                usage=usage,
                finish_reason=response.choices[0].finish_reason or "stop"
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        if not openai: raise RuntimeError("openai SDK not installed")
        api_key = kwargs.get("api_key")
        client = self._client(api_key, kwargs.get("base_url"))
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=self._convert_messages(messages),
                stream=True
            )
            async for chunk in response:
                delta = chunk.choices[0].delta.content if chunk.choices and chunk.choices[0].delta.content else ""
                yield StreamChunk(delta=delta, done=False, model=model, provider=self.provider_id)
            yield StreamChunk(delta="", done=True, model=model, provider=self.provider_id)
        except Exception as e:
            raise self.normalize_error(e)

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        if not openai: raise RuntimeError("openai SDK not installed")
        api_key = kwargs.get("api_key")
        client = self._client(api_key, kwargs.get("base_url"))
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=self._convert_messages(messages),
                tools=self._convert_tools(tools)
            )
            msg = response.choices[0].message
            tool_calls = []
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_calls.append(ToolCall(id=tc.id, name=tc.function.name, arguments=json.loads(tc.function.arguments)))
            return ToolCallResponse(
                tool_calls=tool_calls,
                content=msg.content or "",
                model=model,
                provider=self.provider_id
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def structured_output(self, messages: List[ChatMessage], schema: Dict, model: str, **kwargs) -> dict:
        if not openai: raise RuntimeError("openai SDK not installed")
        api_key = kwargs.get("api_key")
        client = self._client(api_key, kwargs.get("base_url"))
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=self._convert_messages(messages),
                response_format={"type": "json_schema", "json_schema": {"name": "schema", "schema": schema}}
            )
            return json.loads(response.choices[0].message.content or "{}")
        except Exception as e:
            raise self.normalize_error(e)

    def get_available_models(self) -> List[ModelDefinition]:
        from .capability_registry import CapabilityRegistry
        return CapabilityRegistry().get_models_for_provider(self.provider_id)

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        return ModelCapabilities()

    async def validate_key(self, api_key: str) -> KeyHealth:
        if not openai: return KeyHealth.UNCONFIGURED
        try:
            client = self._client(api_key)
            await client.models.list()
            return KeyHealth.HEALTHY
        except Exception as e:
            err = self.normalize_error(e)
            if err.code == "AUTH_ERROR": return KeyHealth.AUTH_ERROR
            elif err.code == "QUOTA_EXCEEDED": return KeyHealth.QUOTA_EXCEEDED
            elif err.code == "RATE_LIMIT": return KeyHealth.RATE_LIMITED
            return KeyHealth.UNAVAILABLE

    def normalize_error(self, exception: Exception) -> AgentError:
        msg = str(exception)
        code = "UNKNOWN"
        retryable = False
        if isinstance(exception, openai.AuthenticationError):
            code, retryable = "AUTH_ERROR", False
        elif isinstance(exception, openai.RateLimitError):
            code, retryable = "RATE_LIMIT", True
            if any(term in msg.lower() for term in ("quota", "billing", "credit balance", "insufficient funds")):
                code, retryable = "QUOTA_EXCEEDED", False
        elif any(
            term in msg.lower()
            for term in ("credit balance", "insufficient credit", "billing", "payment required", "insufficient funds")
        ):
            code = "QUOTA_EXCEEDED"
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
