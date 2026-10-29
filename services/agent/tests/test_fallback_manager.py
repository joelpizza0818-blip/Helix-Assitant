import pytest
import asyncio
from services.agent.ai.model_router import TaskRequirements
from services.agent.ai.base_provider import AgentError, ChatMessage, KeyHealth
from services.agent.ai.fallback_manager import FallbackManager, _request_snapshot


def test_model_request_snapshot_redacts_secrets_and_omits_image_bytes():
    snapshot = _request_snapshot({
        "messages": [{
            "role": "user",
            "content": "Check the document",
            "image_bytes": b"pixels",
            "api_key": "must-not-be-shown",
        }],
        "_execution_failed_keys": {("google", 0)},
    })

    message = snapshot["messages"][0]
    assert message["api_key"] == "[REDACTED]"
    assert message["image_bytes"] == "[binary image omitted: 6 bytes]"
    assert "must-not-be-shown" not in str(snapshot)
    assert "_execution_failed_keys" not in snapshot


@pytest.mark.asyncio
async def test_context_limit_compacts_and_retries_same_model_without_marking_key_failed(
    google_only_env, fallback_manager
):
    context = {
        "messages": [
            ChatMessage(role="system", content="Follow the current task."),
            ChatMessage(role="user", content="An old conversation."),
            ChatMessage(role="user", content="Finish the current task."),
        ],
    }

    def compact_context():
        context["messages"] = [
            context["messages"][0],
            ChatMessage(role="user", content="Finish the current task."),
        ]
        return True

    context["_helix_context_recovery"] = compact_context
    attempted_routes = []

    async def provider_call(candidate, request_context):
        attempted_routes.append((candidate.provider_id, candidate.model_id))
        if len(attempted_routes) == 1:
            raise AgentError(
                code="INVALID_REQUEST",
                message="The prompt exceeds the maximum context length.",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=False,
            )
        assert len(request_context["messages"]) == 2
        return "completed after compaction"

    result = await fallback_manager.execute_with_fallback(
        provider_call,
        TaskRequirements(text=True),
        context,
    )

    assert result == "completed after compaction"
    assert len(attempted_routes) == 2
    assert attempted_routes[0] == attempted_routes[1]
    assert fallback_manager.key_manager.key_states["google"][0]["failures"] == 0

@pytest.mark.asyncio
async def test_missing_provider_key_reports_ai_settings_guidance(
    clean_env, fallback_manager
):
    with pytest.raises(RuntimeError, match="No AI provider API keys are configured"):
        await fallback_manager.execute_with_fallback(
            lambda *_args: None,
            TaskRequirements(text=True),
            {},
        )


@pytest.mark.asyncio
async def test_fallback_manager_excludes_parent_agent_credential(
    all_providers_env, fallback_manager
):
    attempted_keys = []

    async def record_attempt(candidate, _context):
        attempted_keys.append(
            fallback_manager.key_manager.get_key(candidate.provider_id, candidate.key_slot)
        )
        return "child response"

    result = await fallback_manager.execute_with_fallback(
        record_attempt,
        TaskRequirements(text=True, preferred_provider="google"),
        {"_excluded_api_keys": {"test-google-key-1"}},
    )

    assert result == "child response"
    assert attempted_keys
    assert "test-google-key-1" not in attempted_keys
    assert "test-google-key-1" not in str(
        fallback_manager.event_bus.publish.await_args_list
    )


@pytest.mark.asyncio
async def test_fallback_manager_round_robins_unique_credentials(
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
    attempted_slots = []

    async def record_attempt(candidate, _context):
        attempted_slots.append(candidate.key_slot)
        return "response"

    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="google",
        preferred_model="gemini-3.8-flash",
    )
    await asyncio.gather(
        *(
            fallback_manager.execute_with_fallback(
                record_attempt,
                requirements,
                {},
            )
            for _ in range(6)
        )
    )

    assert attempted_slots == [0, 1, 2, 0, 1, 2]


@pytest.mark.asyncio
async def test_fallback_manager_skips_duplicate_credentials_when_balancing(
    google_only_env, fallback_manager, monkeypatch
):
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-1")
    monkeypatch.setenv("GOOGLE_API_KEY_3", "test-google-key-2")
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
    attempted_slots = []

    async def record_attempt(candidate, _context):
        attempted_slots.append(candidate.key_slot)
        return "response"

    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="google",
        preferred_model="gemini-3.8-flash",
    )
    for _ in range(4):
        await fallback_manager.execute_with_fallback(
            record_attempt,
            requirements,
            {},
        )

    assert attempted_slots == [0, 2, 0, 2]


@pytest.mark.asyncio
async def test_fallback_manager_keeps_single_key_usable_when_balancing(
    google_only_env, fallback_manager
):
    attempted_slots = []

    async def record_attempt(candidate, _context):
        attempted_slots.append(candidate.key_slot)
        return "response"

    for _ in range(3):
        await fallback_manager.execute_with_fallback(
            record_attempt,
            TaskRequirements(text=True, preferred_provider="google"),
            {},
        )

    assert attempted_slots == [0, 0, 0]


@pytest.mark.asyncio
async def test_fallback_reuses_parent_credential_when_no_compatible_alternative(
    google_only_env, fallback_manager
):
    attempted_keys = []

    async def record_attempt(candidate, _context):
        attempted_keys.append(
            fallback_manager.key_manager.get_key(
                candidate.provider_id,
                candidate.key_slot,
            )
        )
        return "child response"

    result = await fallback_manager.execute_with_fallback(
        record_attempt,
        TaskRequirements(text=True, preferred_provider="google"),
        {"_excluded_api_keys": {"test-google-key-1"}},
    )

    assert result == "child response"
    assert attempted_keys == ["test-google-key-1"]


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
async def test_vision_fallback_tries_models_on_last_key_before_previous_keys(
    google_only_env, fallback_manager, monkeypatch
):
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-2")
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
    calls = []

    async def fail_one_vision_model(candidate, _context):
        calls.append((candidate.model_id, candidate.key_slot))
        if len(calls) == 1:
            raise AgentError(
                code="RATE_LIMIT",
                message="Quota exhausted for this model and key",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=True,
            )
        return "description"

    result = await fallback_manager.execute_with_fallback(
        fail_one_vision_model,
        TaskRequirements(text=True, vision=True, cost_preference="low"),
        {},
        prefer_last_key=True,
        allow_cross_provider=True,
    )

    assert result == "description"
    assert len(calls) >= 2
    assert calls[0][1] == 1
    assert calls[1][1] == 1
    assert calls[1][0] != calls[0][0]


@pytest.mark.asyncio
async def test_disabled_fallback_makes_only_one_provider_attempt(
    all_providers_env, fallback_manager, monkeypatch
):
    fallback_manager.fallback_enabled = False
    calls = []

    async def fail(candidate, _context):
        calls.append(candidate)
        raise AgentError(
            code="RATE_LIMIT",
            message="Rate limit exceeded",
            provider=candidate.provider_id,
            model=candidate.model_id,
            retryable=True,
        )

    with pytest.raises(RuntimeError, match="fallback is disabled"):
        await fallback_manager.execute_with_fallback(fail, TaskRequirements(text=True), {})

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_cross_provider_fallback_setting_is_respected(
    all_providers_env, fallback_manager
):
    fallback_manager.cross_provider_fallback = False
    calls = []

    async def fail_google_then_succeed(candidate, _context):
        calls.append(candidate.provider_id)
        if candidate.provider_id == "google":
            raise AgentError(
                code="RATE_LIMIT",
                message="Rate limit exceeded",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=True,
            )
        return "unexpected cross-provider success"

    with pytest.raises(RuntimeError, match="ProviderExhaustedError"):
        await fallback_manager.execute_with_fallback(
            fail_google_then_succeed,
            TaskRequirements(text=True, preferred_provider="google"),
            {},
        )

    assert calls
    assert set(calls) == {"google"}

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
    context = {"messages": [
        {"role": "user", "content": "Continue this task."},
        {"role": "assistant", "tool_calls": [{"id": "cmd-1", "name": "execute_command"}]},
        {"role": "tool", "tool_call_id": "cmd-1", "content": "Command completed: tests passed."},
    ]}
    context_ids = []

    async def fail_anthropic_then_succeed_google(candidate, _context):
        attempts.append((candidate.provider_id, candidate.model_id, candidate.key_slot))
        context_ids.append(id(_context["messages"]))
        if candidate.provider_id == "google":
            assert _context["messages"][-1]["content"] == "Command completed: tests passed."
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
    assert context["messages"][-1]["content"] == "Command completed: tests passed."


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
async def test_quota_failure_skips_only_failed_model_key_candidate(
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
    assert attempts[0][1] == "gemini-3.8-flash"
    assert attempts[1][1] == attempts[0][1]
    assert attempts[0][2] == 0
    assert attempts[1][2] == 1
    assert execution_context["_execution_failed_candidates"] == {
        ("google", attempts[0][1], attempts[0][2])
    }
    assert fallback_manager.model_router.capability_registry.get_model(
        "gemini-3.8-flash"
    ) is not None

    next_attempts = []

    async def succeed(candidate, _context):
        next_attempts.append(
            (candidate.provider_id, candidate.model_id, candidate.key_slot)
        )
        return "NEXT_SUCCESS"

    assert await fallback_manager.execute_with_fallback(
        succeed,
        TaskRequirements(text=True, tool_calling=True, preferred_provider="google"),
        execution_context,
    ) == "NEXT_SUCCESS"
    assert next_attempts[0] == ("google", attempts[0][1], 1)


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
    assert attempts[0] == "gemini-3.8-flash"
    assert attempts[1] != attempts[0]
    assert fallback_manager.model_router.capability_registry.get_model(
        "gemini-3.8-flash"
    ) is not None
    assert all(
        candidate.model_id != "gemini-3.8-flash"
        for candidate in fallback_manager.model_router.get_fallback_candidates(
            requirements,
            exclude=[],
        )
    )


@pytest.mark.asyncio
async def test_temporary_model_unavailability_tries_another_model_with_same_key(
    google_only_env, fallback_manager
):
    attempts = []
    execution_context = {}

    async def model_overloaded_then_succeed(candidate, _context):
        attempts.append((candidate.model_id, candidate.key_slot))
        if len(attempts) == 1:
            raise AgentError(
                code="MODEL_TEMPORARILY_UNAVAILABLE",
                message="Model currently experiencing high demand.",
                provider=candidate.provider_id,
                model=candidate.model_id,
                retryable=True,
            )
        return "SUCCESS"

    result = await fallback_manager.execute_with_fallback(
        model_overloaded_then_succeed,
        TaskRequirements(text=True, tool_calling=True, preferred_provider="google"),
        execution_context,
    )

    assert result == "SUCCESS"
    assert attempts[0] == ("gemini-3.8-flash", 0)
    assert attempts[1][1] == attempts[0][1]
    assert attempts[1][0] != attempts[0][0]
    assert fallback_manager.key_manager.key_states["google"][0]["health"] == KeyHealth.HEALTHY
    assert execution_context["_execution_failed_models"] == {
        ("google", "gemini-3.8-flash")
    }
    assert ("google", "gemini-3.8-flash") not in (
        fallback_manager.model_router.unavailable_models
    )
