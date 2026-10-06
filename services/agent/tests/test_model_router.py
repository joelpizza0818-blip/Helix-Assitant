import pytest
from services.agent.ai.model_router import ModelRouter, TaskRequirements

def test_router_selects_configured_provider_only(google_only_env, model_router):
    req = TaskRequirements(text=True, vision=True)
    candidate = model_router.get_best_candidate(req)

    assert candidate is not None
    assert candidate.provider_id == "google"
    assert "gemini" in candidate.model_id

def test_router_satisfies_computer_use_requirement(all_providers_env, model_router):
    req = TaskRequirements(text=True, computer_use=True)
    candidate = model_router.get_best_candidate(req)

    assert candidate is not None
    # Claude 3.5 Sonnet has computer_use=True
    assert candidate.provider_id == "anthropic"
    assert "claude-3-5-sonnet" in candidate.model_id

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
