import pytest
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.ai.google_provider import GoogleProvider
from services.agent.ai.openai_provider import OpenAIProvider
from services.agent.ai.anthropic_provider import AnthropicProvider

def test_google_only_hides_other_providers(google_only_env, key_manager, capability_registry):
    pr = ProviderRegistry(key_manager)
    pr.register_provider(GoogleProvider())
    pr.register_provider(OpenAIProvider())
    pr.register_provider(AnthropicProvider())

    available = pr.get_available_providers()
    assert len(available) == 1
    assert available[0].provider_id == "google"

    available_models = pr.get_available_models()
    assert len(available_models) > 0
    for m in available_models:
        assert m.provider == "google"

def test_openai_only_hides_google_and_claude(openai_only_env, key_manager, capability_registry):
    pr = ProviderRegistry(key_manager)
    pr.register_provider(GoogleProvider())
    pr.register_provider(OpenAIProvider())
    pr.register_provider(AnthropicProvider())

    available = pr.get_available_providers()
    assert len(available) == 1
    assert available[0].provider_id == "openai"

    available_models = pr.get_available_models()
    assert len(available_models) > 0
    for m in available_models:
        assert m.provider == "openai"

def test_no_keys_returns_zero_models(clean_env, key_manager, capability_registry):
    pr = ProviderRegistry(key_manager)
    pr.register_provider(GoogleProvider())
    pr.register_provider(OpenAIProvider())

    assert pr.get_available_providers() == []
    assert pr.get_available_models() == []
