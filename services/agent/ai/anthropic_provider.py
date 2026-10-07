import base64
try:
    import anthropic
    from anthropic import AsyncAnthropic
except ImportError:
    anthropic = None
from typing import AsyncIterator, List, Dict
import json
from .base_provider import BaseAIProvider, ChatMessage, ChatResponse, StreamChunk, ToolCallResponse, Usage, ModelDefinition, ModelCapabilities, AgentError, KeyHealth, ToolCall

class AnthropicProvider(BaseAIProvider):
    @property
    def provider_id(self) -> str:
        return "anthropic"
    
    @property
    def provider_name(self) -> str:
        return "Anthropic"

    def _convert_messages(self, messages: List[ChatMessage]) -> List[Dict]:
        converted = []
        for message in messages:
            if message.role == "system":
                continue
            if message.role == "tool":
                converted.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": message.tool_call_id,
                        "content": message.content,
                    }],
                })
                continue

            content = []
            if message.content:
                content.append({"type": "text", "text": message.content})
            if message.image_bytes:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(message.image_bytes).decode("ascii"),
                    },
                })
            if message.tool_calls:
                content.extend({
                    "type": "tool_use",
                    "id": call["id"],
                    "name": call["name"],
                    "input": call["arguments"],
                } for call in message.tool_calls)
            converted.append({
                "role": message.role,
                "content": content or message.content,
            })
        return converted
        
    def _get_system_prompt(self, messages: List[ChatMessage]) -> str:
        system_msgs = [m.content for m in messages if m.role == "system"]
        return "\n".join(system_msgs)

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        if not anthropic: raise RuntimeError("anthropic SDK not installed")
        api_key = kwargs.get("api_key")
        client = AsyncAnthropic(api_key=api_key)
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=kwargs.get("max_tokens", 4096),
                system=self._get_system_prompt(messages),
                messages=self._convert_messages(messages)
            )
            usage = Usage(
                prompt_tokens=response.usage.input_tokens,
                completion_tokens=response.usage.output_tokens,
                total_tokens=response.usage.input_tokens + response.usage.output_tokens
            )
            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text
            return ChatResponse(
                content=content,
                model=model,
                provider=self.provider_id,
                usage=usage,
                finish_reason=response.stop_reason or "stop"
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        if not anthropic: raise RuntimeError("anthropic SDK not installed")
        api_key = kwargs.get("api_key")
        client = AsyncAnthropic(api_key=api_key)
        try:
            async with client.messages.stream(
                model=model,
                max_tokens=kwargs.get("max_tokens", 4096),
                system=self._get_system_prompt(messages),
                messages=self._convert_messages(messages)
            ) as stream:
                async for event in stream:
                    if event.type == "text_delta":
                        yield StreamChunk(delta=event.delta.text, done=False, model=model, provider=self.provider_id)
            yield StreamChunk(delta="", done=True, model=model, provider=self.provider_id)
        except Exception as e:
            raise self.normalize_error(e)

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        if not anthropic: raise RuntimeError("anthropic SDK not installed")
        api_key = kwargs.get("api_key")
        client = AsyncAnthropic(api_key=api_key)
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=kwargs.get("max_tokens", 4096),
                system=self._get_system_prompt(messages),
                messages=self._convert_messages(messages),
                tools=[
                    {
                        "name": tool["name"],
                        "description": tool["description"],
                        "input_schema": tool["parameters"],
                    }
                    for tool in tools
                ]
            )
            tool_calls = []
            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text
                elif block.type == "tool_use":
                    tool_calls.append(ToolCall(id=block.id, name=block.name, arguments=block.input))
            return ToolCallResponse(
                tool_calls=tool_calls,
                content=content,
                model=model,
                provider=self.provider_id
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def structured_output(self, messages: List[ChatMessage], schema: Dict, model: str, **kwargs) -> dict:
        if not anthropic: raise RuntimeError("anthropic SDK not installed")
        api_key = kwargs.get("api_key")
        client = AsyncAnthropic(api_key=api_key)
        tools = [{
            "name": "print_structured_output",
            "description": "Prints the output in the requested structured format.",
            "input_schema": schema
        }]
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=kwargs.get("max_tokens", 4096),
                system=self._get_system_prompt(messages),
                messages=self._convert_messages(messages),
                tools=tools,
                tool_choice={"type": "tool", "name": "print_structured_output"}
            )
            for block in response.content:
                if block.type == "tool_use" and block.name == "print_structured_output":
                    return block.input
            return {}
        except Exception as e:
            raise self.normalize_error(e)

    def get_available_models(self) -> List[ModelDefinition]:
        from .capability_registry import CapabilityRegistry
        return CapabilityRegistry().get_models_for_provider(self.provider_id)

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        return ModelCapabilities()

    async def validate_key(self, api_key: str) -> KeyHealth:
        if not anthropic: return KeyHealth.UNCONFIGURED
        try:
            client = AsyncAnthropic(api_key=api_key)
            await client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=10,
                messages=[{"role": "user", "content": "test"}]
            )
            return KeyHealth.HEALTHY
        except Exception as e:
            err = self.normalize_error(e)
            if err.code == "AUTH_ERROR": return KeyHealth.AUTH_ERROR
            elif err.code in {"QUOTA_EXCEEDED", "BILLING_EXHAUSTED"}: return KeyHealth.QUOTA_EXCEEDED
            elif err.code == "RATE_LIMIT": return KeyHealth.RATE_LIMITED
            return KeyHealth.UNAVAILABLE

    def normalize_error(self, exception: Exception) -> AgentError:
        msg = str(exception)
        lowered = msg.lower()
        code = "UNKNOWN"
        retryable = False
        billing_error = any(
            phrase in lowered
            for phrase in (
                "credit balance",
                "insufficient credit",
                "billing",
                "payment required",
                "insufficient funds",
            )
        )
        if billing_error or (
            anthropic
            and isinstance(exception, anthropic.APIStatusError)
            and exception.status_code == 402
        ):
            code = "BILLING_EXHAUSTED"
        elif anthropic and isinstance(exception, anthropic.APIError):
            if isinstance(exception, anthropic.AuthenticationError):
                code, retryable = "AUTH_ERROR", False
            elif isinstance(exception, anthropic.RateLimitError):
                code, retryable = "RATE_LIMIT", True
            elif isinstance(exception, anthropic.InternalServerError):
                code, retryable = "TEMPORARY_PROVIDER_ERROR", True
            elif isinstance(exception, anthropic.APIStatusError):
                if exception.status_code == 429:
                    code, retryable = "RATE_LIMIT", True
                elif exception.status_code >= 500:
                    code, retryable = "TEMPORARY_PROVIDER_ERROR", True
        return AgentError(code=code, message=msg, provider=self.provider_id, model="unknown", retryable=retryable, original_exception=exception)
