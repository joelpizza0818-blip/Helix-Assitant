import pytest
from services.agent.ai.model_router import ModelRouter, TaskRequirements
from services.agent.ai.base_provider import KeyHealth

def test_router_selects_configured_provider_only(google_only_env, model_router):
    req = TaskRequirements(text=True, vision=True)
    candidate = model_router.get_best_candidate(req)

    assert candidate is not None
    assert candidate.provider_id == "google"
    assert "gemini" in candidate.model_id

def test_router_prefers_verified_flash_model_when_google_is_the_only_provider(
    google_only_env, model_router
):
    candidate = model_router.get_best_candidate(
        TaskRequirements(text=True, tool_calling=True)
    )

    assert candidate is not None
    assert candidate.provider_id == "google"
    assert candidate.model_id == "gemini-3-flash-preview"

def test_router_satisfies_computer_use_requirement(all_providers_env, model_router):
    req = TaskRequirements(
        text=True,
        computer_use=True,
        preferred_model="claude-sonnet-5-5",
    )
    candidate = model_router.get_best_candidate(req)

    assert candidate is not None
    # Claude Sonnet 5.5 is registered with computer_use=True.
    assert candidate.provider_id == "anthropic"
    assert candidate.model_id == "claude-sonnet-5-5"

def test_router_returns_none_when_no_provider_configured(clean_env, model_router):
    req = TaskRequirements(text=True)
    candidate = model_router.get_best_candidate(req)
    assert candidate is None

def test_fallback_candidates_exclude_already_tried(all_providers_env, model_router):
    req = TaskRequirements(text=True, vision=True)
    best = model_router.get_best_candidate(req)
    assert best is not None

    fallbacks = model_router.get_fallback_candidates(
        req,
        exclude=[(best.provider_id, best.model_id, best.key_slot)]
    )

    assert len(fallbacks) > 0
    for fb in fallbacks:
        assert (fb.provider_id, fb.model_id, fb.key_slot) != (best.provider_id, best.model_id, best.key_slot)


def test_computer_use_does_not_fallback_to_incompatible_provider(
    all_providers_env, model_router, key_manager
):
    key_manager.key_states["anthropic"][0]["health"] = KeyHealth.AUTH_ERROR
    candidate = model_router.get_best_candidate(
        TaskRequirements(text=True, computer_use=True)
    )

    assert candidate is None
