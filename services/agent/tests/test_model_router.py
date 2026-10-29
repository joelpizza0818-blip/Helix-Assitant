import pytest
from services.agent.ai.model_router import ModelRouter, TaskRequirements
from services.agent.ai.model_router import RouteCandidate
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
    assert candidate.model_id == "gemini-3.8-flash"

def test_google_catalog_uses_current_stable_models(google_only_env, model_router):
    google_models = {
        model.id
        for model in model_router.capability_registry.get_models_for_provider("google")
    }

    assert "gemini-3.8-flash" in google_models
    assert "gemini-3.6-flash" in google_models
    assert "gemini-3-flash-preview" not in google_models
    assert "gemini-3.5-flash" not in google_models
    assert "gemini-2.5-flash" not in google_models

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

def test_router_round_robins_unique_credentials_for_equal_best_routes(
    google_only_env, model_router, key_manager, monkeypatch
):
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-2")
    monkeypatch.setenv("GOOGLE_API_KEY_3", "test-google-key-3")
    key_manager._load_keys()
    key_manager.key_states = {
        provider: {
            slot: {
                "health": KeyHealth.HEALTHY if key else KeyHealth.UNCONFIGURED,
                "failures": 0,
                "cooldown_until": 0,
            }
            for slot, key in enumerate(keys)
        }
        for provider, keys in key_manager.keys.items()
    }
    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="google",
        preferred_model="gemini-3.8-flash",
    )

    slots = [
        model_router.get_best_candidate(requirements).key_slot
        for _ in range(6)
    ]

    assert slots == [0, 1, 2, 0, 1, 2]

def test_router_does_not_count_duplicate_slots_as_separate_credentials(
    google_only_env, model_router, key_manager, monkeypatch
):
    monkeypatch.setenv("GOOGLE_API_KEY_2", "test-google-key-1")
    monkeypatch.setenv("GOOGLE_API_KEY_3", "test-google-key-2")
    key_manager._load_keys()
    key_manager.key_states = {
        provider: {
            slot: {
                "health": KeyHealth.HEALTHY if key else KeyHealth.UNCONFIGURED,
                "failures": 0,
                "cooldown_until": 0,
            }
            for slot, key in enumerate(keys)
        }
        for provider, keys in key_manager.keys.items()
    }
    requirements = TaskRequirements(
        text=True,
        tool_calling=True,
        preferred_provider="google",
        preferred_model="gemini-3.8-flash",
    )

    slots = [
        model_router.get_best_candidate(requirements).key_slot
        for _ in range(4)
    ]

    assert slots == [0, 2, 0, 2]


def test_strict_subagent_route_does_not_fallback_to_another_model(
    all_providers_env, model_router
):
    candidate = model_router.get_best_candidate(TaskRequirements(
        text=True,
        preferred_provider="openai",
        preferred_model="not-a-configured-model",
        preferred_key_slot=0,
        strict_model_route=True,
    ))

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


def test_vision_fallback_prefers_highest_key_slot_before_other_models(
    all_providers_env, model_router, key_manager
):
    key_manager.keys["google"] = [
        "test-google-key-1",
        "test-google-key-2",
        "test-google-key-3",
    ]
    key_manager.key_states["google"] = {
        slot: {
            "health": KeyHealth.HEALTHY,
            "failures": 0,
            "cooldown_until": 0,
        }
        for slot in range(3)
    }

    candidates = model_router.get_fallback_candidates(
        TaskRequirements(text=True, vision=True, cost_preference="low"),
        exclude=[],
        prefer_last_key=True,
    )
    key_slots = [candidate.key_slot for candidate in candidates]

    assert key_slots == sorted(key_slots, reverse=True)
    assert key_slots[:3] == [2, 2, 2]


def test_computer_use_does_not_fallback_to_incompatible_provider(
    all_providers_env, model_router, key_manager
):
    key_manager.key_states["anthropic"][0]["health"] = KeyHealth.AUTH_ERROR
    candidate = model_router.get_best_candidate(
        TaskRequirements(text=True, computer_use=True)
    )

    assert candidate is None


def test_separate_vision_candidates_require_registry_vision_and_another_key(
    all_providers_env, model_router
):
    response_candidate = RouteCandidate(
        provider_id="openai",
        model_id="gpt-4o",
        key_slot=0,
        score=100,
        fallback_available=True,
    )

    candidates = model_router.get_separate_vision_candidates(response_candidate)

    assert candidates
    assert all(
        model_router.capability_registry.get_model(candidate.model_id).capabilities.vision
        for candidate in candidates
    )
    assert all(
        candidate.provider_id != "openai" or candidate.key_slot != 0
        for candidate in candidates
    )
    assert {candidate.provider_id for candidate in candidates} >= {
        "anthropic",
        "google",
    }


def test_separate_vision_candidates_detect_same_secret_across_provider_slots(
    all_providers_env, model_router, key_manager
):
    key_manager.keys["google"][0] = key_manager.keys["openai"][0]
    response_candidate = RouteCandidate(
        provider_id="openai",
        model_id="gpt-4o",
        key_slot=0,
        score=100,
        fallback_available=True,
    )

    candidates = model_router.get_separate_vision_candidates(response_candidate)

    assert all(
        candidate.provider_id != "google" or candidate.key_slot != 0
        for candidate in candidates
    )
