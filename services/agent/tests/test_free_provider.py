from unittest.mock import AsyncMock, patch

import pytest

from services.agent.ai.free_provider import FreeModelProvider
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
