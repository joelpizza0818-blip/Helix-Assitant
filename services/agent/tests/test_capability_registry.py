import pytest
from services.agent.ai.capability_registry import CapabilityRegistry

def test_registry_contains_core_providers(capability_registry):
    models = capability_registry.get_all_models()
    providers = set(m.provider for m in models)
    assert "openai" in providers
    assert "anthropic" in providers
    assert "google" in providers

def test_claude_computer_use_capability(capability_registry):
    sonnet = capability_registry.get_model("claude-3-5-sonnet-20241022")
    assert sonnet is not None
    assert sonnet.capabilities.computer_use is True
    assert sonnet.capabilities.vision is True
    assert sonnet.capabilities.tool_calling is True

def test_filter_by_vision(capability_registry):
    vision_models = capability_registry.filter_by_capabilities({"vision": True})
    assert len(vision_models) > 0
    for m in vision_models:
        assert m.capabilities.vision is True

def test_filter_by_provider_and_capability(capability_registry):
    google_vision = capability_registry.filter_by_capabilities(
        {"vision": True},
        provider_filter=["google"]
    )
    assert len(google_vision) > 0
    for m in google_vision:
        assert m.provider == "google"
        assert m.capabilities.vision is True

def test_filter_impossible_capabilities(capability_registry):
    # No current model has both speech_to_text and computer_use simultaneously
    impossible = capability_registry.filter_by_capabilities({
        "speech_to_text": True,
        "computer_use": True
    })
    assert len(impossible) == 0
