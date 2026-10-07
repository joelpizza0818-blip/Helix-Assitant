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


@pytest.mark.asyncio
async def test_anthropic_billing_failure_falls_back_to_configured_google(
    all_providers_env, fallback_manager, monkeypatch
):
    monkeypatch.setenv("ANTHROPIC_API_KEY_2", "test-anthropic-key-2")
    monkeypatch.setenv("ANTHROPIC_API_KEY_3", "test-anthropic-key-3")
    fallback_manager.key_manager._load_keys()
    fallback_manager.key_manager.key_states = {
        provider: {
            slot: {
                "health": KeyHealth.HEALTHY if key else KeyHealth.UNCONFIGURED,
                "failures": 0,
                "cooldown_until": 0,
            }
            for slot, key in enumerate(keys)
        }
        for provider, keys in fallback_manager.key_manager.keys.items()
    }

    attempts = []
    context = {"messages": [{"role": "user", "content": "Continue this task."}]}
    context_ids = []

    async def fail_anthropic_then_succeed_google(candidate, _context):
        attempts.append((candidate.provider_id, candidate.model_id, candidate.key_slot))
        context_ids.append(id(_context["messages"]))
        if candidate.provider_id == "anthropic":
            raise AgentError(
                code="BILLING_EXHAUSTED",
                message="credit balance is insufficient",
                provider="anthropic",
                model=candidate.model_id,
                retryable=False,
            )
        return "GOOGLE_RESPONSE"

    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="anthropic",
    )
    result = await fallback_manager.execute_with_fallback(
        fail_anthropic_then_succeed_google,
        requirements,
        context,
    )

    assert result == "GOOGLE_RESPONSE"
    assert [attempt[0] for attempt in attempts[:3]] == ["anthropic"] * 3
    assert len({attempt[2] for attempt in attempts[:3]}) == 3
    assert len({attempt[1] for attempt in attempts[:3]}) == 1
    assert attempts[-1][0] == "google"
    assert all(attempt[0] in {"anthropic", "google"} for attempt in attempts)
    assert len(set(context_ids)) == 1
    assert context["messages"] == [
        {"role": "user", "content": "Continue this task."}
    ]


@pytest.mark.asyncio
async def test_fallback_never_uses_unconfigured_provider(
    google_only_env, fallback_manager
):
    attempts = []

    async def fail_once(candidate, _context):
        attempts.append((candidate.provider_id, candidate.model_id))
        if len(attempts) == 1:
            raise AgentError(
                code="QUOTA_EXCEEDED",
                message="quota exhausted",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=False,
            )
        return "GOOGLE_RESPONSE"

    result = await fallback_manager.execute_with_fallback(
        fail_once,
        TaskRequirements(text=True, tool_calling=True),
        {},
    )

    assert result == "GOOGLE_RESPONSE"
    assert [attempt[0] for attempt in attempts] == ["google", "google"]
    assert attempts[0][1] != attempts[1][1]


@pytest.mark.asyncio
async def test_internal_client_error_does_not_penalize_key_or_try_another_key(
    google_only_env, fallback_manager
):
    attempts = []

    async def fail_locally(candidate, _context):
        attempts.append(candidate.key_slot)
        raise AgentError(
            code="INTERNAL_CLIENT_ERROR",
            message="Failed to construct Google request locally.",
            provider=candidate.provider_id,
            model=candidate.model_id,
            retryable=False,
        )

    with pytest.raises(AgentError) as exc_info:
        await fallback_manager.execute_with_fallback(
            fail_locally,
            TaskRequirements(text=True),
            {},
        )

    assert exc_info.value.message == "Failed to construct Google request locally."
    assert attempts == [0]
    assert fallback_manager.key_manager.key_states["google"][0]["failures"] == 0
    assert fallback_manager.key_manager.key_states["google"][0]["health"] == KeyHealth.HEALTHY


@pytest.mark.asyncio
async def test_quota_failure_skips_model_for_remaining_execution_but_keeps_it_registered(
    google_only_env, fallback_manager, monkeypatch
):
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-2")
    monkeypatch.setenv("GOOGLE_API_KEY_3", "test-google-key-3")
    fallback_manager.key_manager._load_keys()
    fallback_manager.key_manager.key_states = {
        provider: {
            slot: {
                "health": KeyHealth.HEALTHY if key else KeyHealth.UNCONFIGURED,
                "failures": 0,
                "cooldown_until": 0,
            }
            for slot, key in enumerate(keys)
        }
        for provider, keys in fallback_manager.key_manager.keys.items()
    }

    attempts = []
    execution_context = {}

    async def quota_then_succeed(candidate, _context):
        attempts.append((candidate.provider_id, candidate.model_id, candidate.key_slot))
        if len(attempts) == 1:
            raise AgentError(
                code="QUOTA_EXCEEDED",
                message="free-tier quota exhausted",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=False,
            )
        return "SUCCESS"

    result = await fallback_manager.execute_with_fallback(
        quota_then_succeed,
        TaskRequirements(text=True, tool_calling=True, preferred_provider="google"),
        execution_context,
    )

    assert result == "SUCCESS"
    assert len(attempts) == 2
    assert attempts[0][1] == "gemini-3-flash-preview"
    assert attempts[1][1] != attempts[0][1]
    assert fallback_manager.model_router.capability_registry.get_model(
        "gemini-3-flash-preview"
    ) is not None

    next_attempts = []

    async def succeed(candidate, _context):
        next_attempts.append(candidate.model_id)
        return "NEXT_SUCCESS"

    assert await fallback_manager.execute_with_fallback(
        succeed,
        TaskRequirements(text=True, tool_calling=True, preferred_provider="google"),
        execution_context,
    ) == "NEXT_SUCCESS"
    assert "gemini-3-flash-preview" not in next_attempts


@pytest.mark.asyncio
async def test_model_unavailable_is_disabled_for_future_routing(
    google_only_env, fallback_manager
):
    attempts = []

    async def model_missing_then_succeed(candidate, _context):
        attempts.append(candidate.model_id)
        if len(attempts) == 1:
            raise AgentError(
                code="MODEL_UNAVAILABLE",
                message="model not found",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=False,
            )
        return "SUCCESS"

    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="google",
    )
    assert await fallback_manager.execute_with_fallback(
        model_missing_then_succeed,
        requirements,
        {},
    ) == "SUCCESS"
    assert attempts[0] == "gemini-3-flash-preview"
    assert attempts[1] != attempts[0]
    assert fallback_manager.model_router.capability_registry.get_model(
        "gemini-3-flash-preview"
    ) is not None
    assert all(
        candidate.model_id != "gemini-3-flash-preview"
        for candidate in fallback_manager.model_router.get_fallback_candidates(
            requirements,
            exclude=[],
        )
    )
