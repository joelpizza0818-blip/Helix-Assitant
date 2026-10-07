import pytest
import time
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.base_provider import KeyHealth

def test_no_keys_configured(clean_env):
    km = KeyManager()
    assert km.get_configured_providers() == []
    assert not km.is_provider_configured("google")
    assert not km.is_provider_configured("openai")
    assert not km.is_provider_configured("anthropic")
    assert km.get_available_key("google") is None

def test_empty_environment_keys_are_not_configured(clean_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY_1", "")
    km = KeyManager()
    assert not km.is_provider_configured("openai")
    assert "openai" not in km.get_configured_providers()

def test_single_provider_configured(google_only_env):
    km = KeyManager()
    assert km.get_configured_providers() == ["google"]
    assert km.is_provider_configured("google")
    assert not km.is_provider_configured("openai")
    assert not km.is_provider_configured("anthropic")
    
    key_info = km.get_available_key("google")
    assert key_info is not None
    slot, key = key_info
    assert slot == 0
    assert key == "test-google-key-1"

def test_three_keys_fallback(monkeypatch, clean_env):
    monkeypatch.setenv("GOOGLE_API_KEY_1", "key-1")
    monkeypatch.setenv("GOOGLE_API_KEY_2", "key-2")
    monkeypatch.setenv("GOOGLE_API_KEY_3", "key-3")

    km = KeyManager()
    # Initially slot 0 (key-1) is returned
    slot, key = km.get_available_key("google")
    assert slot == 0
    assert key == "key-1"

    # Simulate Key 1 hit rate limit
    km.mark_key_failure("google", slot=0, error_code="RATE_LIMIT")
    assert km.key_states["google"][0]["health"] == KeyHealth.RATE_LIMITED

    # Should automatically fall over to slot 1 (key-2)
    slot, key = km.get_available_key("google")
    assert slot == 1
    assert key == "key-2"

    # Simulate Key 2 hit quota exceeded
    km.mark_key_failure("google", slot=1, error_code="QUOTA_EXCEEDED")
    assert km.key_states["google"][1]["health"] == KeyHealth.QUOTA_EXCEEDED
    assert km.key_states["google"][1]["cooldown_until"] == 0

    # Quota can be model-specific, so keep this key usable for other models.
    slot, key = km.get_available_key("google")
    assert slot == 1
    assert key == "key-2"

    # Rate-limited keys still observe their cooldown.
    km.mark_key_failure("google", slot=1, error_code="RATE_LIMIT")
    slot, key = km.get_available_key("google")
    assert slot == 2
    assert key == "key-3"

def test_auth_error_permanent(monkeypatch, clean_env):
    monkeypatch.setenv("OPENAI_API_KEY_1", "bad-key")
    monkeypatch.setenv("OPENAI_API_KEY_2", "good-key")

    km = KeyManager()
    km.mark_key_failure("openai", slot=0, error_code="AUTH_ERROR")
    assert km.key_states["openai"][0]["health"] == KeyHealth.AUTH_ERROR

    # Must skip bad-key and provide good-key
    slot, key = km.get_available_key("openai")
    assert slot == 1
    assert key == "good-key"

def test_mark_success_restores_health(monkeypatch, clean_env):
    monkeypatch.setenv("ANTHROPIC_API_KEY_1", "valid-key")
    km = KeyManager()

    km.mark_key_failure("anthropic", slot=0, error_code="RATE_LIMIT")
    assert km.key_states["anthropic"][0]["health"] == KeyHealth.RATE_LIMITED

    km.mark_key_success("anthropic", slot=0)
    assert km.key_states["anthropic"][0]["health"] == KeyHealth.HEALTHY
    assert km.key_states["anthropic"][0]["failures"] == 0
    assert km.key_states["anthropic"][0]["cooldown_until"] == 0
