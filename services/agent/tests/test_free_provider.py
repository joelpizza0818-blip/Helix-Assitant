from unittest.mock import AsyncMock, patch

import pytest

from services.agent.ai.free_provider import FreeModelProvider
from services.agent.ai.openai_provider import OpenAIProvider
from services.agent.ai.openrouter_provider import OpenRouterProvider


@pytest.mark.asyncio
async def test_chat_passes_single_openrouter_api_key_argument():
    provider = FreeModelProvider()
    response = object()

    with patch(
        "services.agent.ai.openai_provider.OpenAIProvider.chat",
        new=AsyncMock(return_value=response),
    ) as base_chat:
        result = await provider.chat(
            messages=[],
            model="meta-llama/llama-3.2-3b-instruct:free",
            api_key="test-openrouter-key",
            base_url="https://example.invalid/v1",
        )

    assert result is response
    base_chat.assert_awaited_once()
    assert base_chat.await_args.kwargs["api_key"] == "test-openrouter-key"
    assert base_chat.await_args.kwargs["base_url"] == provider._base_url


@pytest.mark.asyncio
async def test_tool_call_passes_single_openrouter_api_key_argument():
    provider = FreeModelProvider()
    response = object()

    with patch(
        "services.agent.ai.openai_provider.OpenAIProvider.tool_call",
        new=AsyncMock(return_value=response),
    ) as base_tool_call:
        result = await provider.tool_call(
            messages=[],
            tools=[],
            model="meta-llama/llama-3.2-3b-instruct:free",
            api_key="test-openrouter-key",
            base_url="https://example.invalid/v1",
        )

    assert result is response
    base_tool_call.assert_awaited_once()
    assert base_tool_call.await_args.kwargs["api_key"] == "test-openrouter-key"
    assert base_tool_call.await_args.kwargs["base_url"] == provider._base_url


@pytest.mark.asyncio
async def test_stream_tool_call_preserves_openrouter_fallback_route():
    provider = FreeModelProvider()
    response = object()

    with patch(
        "services.agent.ai.openai_provider.OpenAIProvider.stream_tool_call",
        new=AsyncMock(return_value=response),
    ) as base_stream_tool_call:
        result = await provider.stream_tool_call(
            messages=[],
            tools=[],
            model="meta-llama/llama-3.2-3b-instruct:free",
            api_key="test-openrouter-key",
            base_url="https://example.invalid/v1",
            on_text_delta=AsyncMock(),
        )

    assert result is response
    base_stream_tool_call.assert_awaited_once()
    assert base_stream_tool_call.await_args.kwargs["api_key"] == "test-openrouter-key"
    assert base_stream_tool_call.await_args.kwargs["base_url"] == provider._base_url


@pytest.mark.parametrize(
    ("method", "extra_kwargs"),
    [
        ("chat", {}),
        ("tool_call", {"tools": []}),
        ("stream_tool_call", {"tools": []}),
    ],
)
@pytest.mark.asyncio
async def test_failed_free_model_does_not_silently_switch_to_another_model(
    method, extra_kwargs
):
    provider = FreeModelProvider()
    selected_model = "qwen/qwen-2.5-coder-32b-instruct:free"
    base_call = AsyncMock(side_effect=RuntimeError("selected model unavailable"))

    with patch.object(OpenAIProvider, method, new=base_call):
        with pytest.raises(RuntimeError, match="selected model unavailable"):
            await getattr(provider, method)(
                messages=[],
                model=selected_model,
                api_key="test-openrouter-key",
                **extra_kwargs,
            )

    base_call.assert_awaited_once()
    assert base_call.await_args.kwargs["model"] == selected_model


@pytest.mark.parametrize(
    "provider",
    [
        FreeModelProvider(api_key="test-openrouter-key"),
        OpenRouterProvider(),
    ],
)
@pytest.mark.asyncio
async def test_openrouter_clients_accept_headers_during_construction(provider):
    client = provider._client(
        api_key="test-openrouter-key",
        base_url="https://example.invalid/v1",
    )
    try:
        assert client.default_headers["HTTP-Referer"] == "https://helix.assistant"
        assert client.default_headers["X-Title"] == "Helix Assistant"
    finally:
        await client.close()
