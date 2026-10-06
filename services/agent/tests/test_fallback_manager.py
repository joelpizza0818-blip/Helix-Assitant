import pytest
import asyncio
from services.agent.ai.model_router import TaskRequirements
from services.agent.ai.base_provider import AgentError, KeyHealth
from services.agent.ai.fallback_manager import FallbackManager

@pytest.mark.asyncio
async def test_fallback_stays_within_same_provider(all_providers_env, fallback_manager, monkeypatch):
    # Configure key 2 so key fallback or model fallback has available keys
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-2")
    # Re-read keys in key_manager
    fallback_manager.key_manager._load_keys()
    fallback_manager.key_manager.key_states = {
        p: {i: {"health": KeyHealth.HEALTHY if k else KeyHealth.UNCONFIGURED, "failures": 0, "cooldown_until": 0} for i, k in enumerate(slots)}
        for p, slots in fallback_manager.key_manager.keys.items()
    }
    # Ensure cross-provider fallback is explicitly disabled (default)
    fallback_manager.cross_provider_fallback = False

    call_history = []

    async def mock_call(candidate, context):
        call_history.append((candidate.provider_id, candidate.model_id, candidate.key_slot))
        if len(call_history) == 1:
            # First attempt fails with rate limit
            raise AgentError(
                code="RATE_LIMIT",
                message="Rate limit exceeded",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=True
            )
        return "SUCCESS_RESULT"

    req = TaskRequirements(text=True, preferred_provider="google")
    result = await fallback_manager.execute_with_fallback(mock_call, req, {})

    assert result == "SUCCESS_RESULT"
    assert len(call_history) >= 2
    # Verify BOTH attempts were within the same provider (Google)
    for prov, model, slot in call_history:
        assert prov == "google"

@pytest.mark.asyncio
async def test_all_provider_models_exhausted_raises_error(google_only_env, fallback_manager):
    async def always_fail(candidate, context):
        raise AgentError(
            code="RATE_LIMIT",
            message="Rate limit reached",
            provider=candidate.provider_id,
            model=candidate.model_id,
            retryable=True
        )

    req = TaskRequirements(text=True)
    with pytest.raises(Exception) as excinfo:
        await fallback_manager.execute_with_fallback(always_fail, req, {})

    assert "ProviderExhaustedError" in str(excinfo.value)
