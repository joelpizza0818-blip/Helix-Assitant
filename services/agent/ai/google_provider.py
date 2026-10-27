try:
    from google import genai
    from google.genai import types
    from google.genai.errors import APIError
except ImportError:
    genai = None

from typing import Any, AsyncIterator, List, Dict
import json
import re
from .base_provider import BaseAIProvider, ChatMessage, ChatResponse, StreamChunk, ToolCallResponse, Usage, ModelDefinition, ModelCapabilities, AgentError, KeyHealth, ToolCall


def _normalize_google_schema(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _normalize_google_schema(item)
            for key, item in value.items()
            # The Google SDK validates its Schema model locally and rejects
            # JSON-Schema metadata such as ``$schema`` before a request ever
            # reaches the provider.  Tool schemas originate in multiple
            # registries, so normalize the unsupported metadata recursively.
            if key not in {
                "additionalProperties",
                "additional_properties",
                "$schema",
            }
        }
    if isinstance(value, list):
        return [_normalize_google_schema(item) for item in value]
    return value


def _google_function_name(name: str) -> str:
    """Return a Google-compatible function name without losing HELIX's name."""
    normalized = re.sub(r"[^a-zA-Z0-9_]", "_", str(name))
    if not normalized:
        normalized = "helix_tool"
    if normalized[0].isdigit():
        normalized = f"helix_{normalized}"
    return normalized


class GoogleProvider(BaseAIProvider):
    @property
    def provider_id(self) -> str:
        return "google"
    
    @property
    def provider_name(self) -> str:
        return "Google"

    def _convert_messages(self, messages: List[ChatMessage]) -> List[types.Content]:
        try:
            contents = []
            for msg in messages:
                if msg.role == "system":
                    continue
                if msg.role == "assistant" and msg.provider_data is not None:
                    contents.append(msg.provider_data)
                    continue
                if msg.role == "tool":
                    contents.append(types.Content(
                        role="user",
                        parts=[types.Part.from_function_response(
                            name=_google_function_name(msg.tool_name or "unknown_tool"),
                            response={"result": msg.content},
                        )],
                    ))
                    continue
                role = "model" if msg.role == "assistant" else msg.role
                parts = []
                if msg.content:
                    parts.append(types.Part.from_text(text=msg.content))
                if msg.image_bytes:
                    parts.append(types.Part.from_bytes(
                        data=msg.image_bytes,
                        mime_type=msg.image_mime_type,
                    ))
                if msg.tool_calls:
                    parts.extend(types.Part.from_function_call(
                        name=_google_function_name(call["name"]),
                        args=call["arguments"],
                    ) for call in msg.tool_calls)
                contents.append(types.Content(role=role, parts=parts))
            return contents
        except Exception as exc:
            raise AgentError(
                code="INTERNAL_CLIENT_ERROR",
                message=f"Failed to construct Google request locally ({type(exc).__name__}).",
                provider=self.provider_id,
                model="unknown",
                retryable=False,
                original_exception=exc,
            ) from exc

    @staticmethod
    def _get_system_instruction(messages: List[ChatMessage]) -> str:
        return "\n".join(
            message.content for message in messages
            if message.role == "system" and message.content
        )

    @staticmethod
    def _convert_tools(tools: List[Dict]) -> List[types.Tool]:
        return [types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name=_google_function_name(tool["name"]),
                description=tool["description"],
                parameters=_normalize_google_schema(tool["parameters"]),
            )
            for tool in tools
        ])]

    async def chat(self, messages: List[ChatMessage], model: str, **kwargs) -> ChatResponse:
        if not genai: raise RuntimeError("google-genai SDK not installed")
        contents = self._convert_messages(messages)
        api_key = kwargs.get("api_key")
        client = genai.Client(api_key=api_key)
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=self._get_system_instruction(messages) or None,
                ),
            )
            usage = Usage(
                prompt_tokens=response.usage_metadata.prompt_token_count if response.usage_metadata else 0,
                completion_tokens=response.usage_metadata.candidates_token_count if response.usage_metadata else 0,
                total_tokens=response.usage_metadata.total_token_count if response.usage_metadata else 0
            )
            return ChatResponse(
                content=response.text or "",
                model=model,
                provider=self.provider_id,
                usage=usage,
                finish_reason="stop"
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def stream(self, messages: List[ChatMessage], model: str, **kwargs) -> AsyncIterator[StreamChunk]:
        if not genai: raise RuntimeError("google-genai SDK not installed")
        contents = self._convert_messages(messages)
        api_key = kwargs.get("api_key")
        client = genai.Client(api_key=api_key)
        try:
            response_stream = await client.aio.models.generate_content_stream(
                model=model,
                contents=contents,
            )
            async for chunk in response_stream:
                if chunk.text:
                    yield StreamChunk(delta=chunk.text, done=False, model=model, provider=self.provider_id)
            yield StreamChunk(delta="", done=True, model=model, provider=self.provider_id)
        except Exception as e:
            raise self.normalize_error(e)

    async def tool_call(self, messages: List[ChatMessage], tools: List[Dict], model: str, **kwargs) -> ToolCallResponse:
        if not genai: raise RuntimeError("google-genai SDK not installed")
        try:
            # Build all SDK objects inside this boundary.  A malformed local
            # schema is deterministic: normalize_error classifies it as an
            # internal client error so FallbackManager stops instead of
            # retrying every configured model/key combination.
            contents = self._convert_messages(messages)
            converted_tools = self._convert_tools(tools)
            api_key = kwargs.get("api_key")
            client = genai.Client(api_key=api_key)
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=self._get_system_instruction(messages) or None,
                    tools=converted_tools,
                )
            )
            tool_calls = []
            if response.function_calls:
                for index, fc in enumerate(response.function_calls):
                    tool_calls.append(
                        ToolCall(
                            id=f"{fc.name}-{index}",
                            # Google receives a normalized name, while the
                            # rest of HELIX must continue using the canonical
                            # registry name (for example computer.click_text).
                            name=next(
                                (
                                    tool["name"]
                                    for tool in tools
                                    if _google_function_name(tool["name"]) == fc.name
                                ),
                                fc.name,
                            ),
                            arguments=fc.args,
                        )
                    )
            candidate_content = (
                response.candidates[0].content
                if response.candidates
                else None
            )
            return ToolCallResponse(
                tool_calls=tool_calls,
                content=response.text or "",
                model=model,
                provider=self.provider_id,
                provider_data=candidate_content,
            )
        except Exception as e:
            raise self.normalize_error(e)

    async def structured_output(self, messages: List[ChatMessage], schema: Dict, model: str, **kwargs) -> dict:
        if not genai: raise RuntimeError("google-genai SDK not installed")
        contents = self._convert_messages(messages)
        api_key = kwargs.get("api_key")
        client = genai.Client(api_key=api_key)
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema
                )
            )
            return json.loads(response.text) if response.text else {}
        except Exception as e:
            raise self.normalize_error(e)

    def get_available_models(self) -> List[ModelDefinition]:
        from .capability_registry import CapabilityRegistry
        return CapabilityRegistry().get_models_for_provider(self.provider_id)

    def get_capabilities(self, model_id: str) -> ModelCapabilities:
        return ModelCapabilities()

    async def validate_key(self, api_key: str) -> KeyHealth:
        if not genai: return KeyHealth.UNCONFIGURED
        try:
            client = genai.Client(api_key=api_key)
            await client.aio.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents="test",
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
        if any(term in lowered for term in (
            "credit balance", "insufficient credit",
            "payment required", "insufficient funds",
            "billing account is disabled", "billing is disabled",
        )):
            code = "BILLING_EXHAUSTED"
        elif isinstance(exception, TimeoutError) or type(exception).__name__ in {
            "TimeoutException", "ConnectTimeout", "ReadTimeout",
        }:
            code, retryable = "TIMEOUT", True
        elif isinstance(exception, ConnectionError) or type(exception).__name__ in {
            "TransportError", "ConnectError", "NetworkError",
        }:
            code, retryable = "NETWORK_ERROR", True
        elif genai and isinstance(exception, APIError):
            status = exception.code
            if status == 402:
                code = "BILLING_EXHAUSTED"
            elif status in (401, 403):
                if "quota" in lowered:
                    code = "QUOTA_EXCEEDED"
                else:
                    code = "AUTH_ERROR"
            elif status == 429:
                if any(term in lowered for term in ("quota", "resource_exhausted")):
                    code = "QUOTA_EXCEEDED"
                else:
                    code, retryable = "RATE_LIMIT", True
            elif status == 404:
                code = "MODEL_UNAVAILABLE"
            elif status == 400:
                if any(term in lowered for term in ("safety", "content policy", "blocked")):
                    code = "CONTENT_POLICY"
                else:
                    code = "INVALID_REQUEST"
            elif status in (408, 504):
                code, retryable = "TIMEOUT", True
            elif status == 503 and any(
                term in lowered
                for term in ("high demand", "currently overloaded", "model overloaded")
            ):
                code, retryable = "MODEL_TEMPORARILY_UNAVAILABLE", True
            elif isinstance(status, int) and status >= 500:
                code, retryable = "NETWORK_ERROR", True
        else:
            code = "INTERNAL_CLIENT_ERROR"
        return AgentError(code=code, message=msg, provider=self.provider_id, model="unknown", retryable=retryable, original_exception=exception)
