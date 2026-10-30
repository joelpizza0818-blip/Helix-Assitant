from dataclasses import dataclass
import threading
from typing import List, Optional, Tuple
from .capability_registry import CapabilityRegistry
from .provider_registry import ProviderRegistry
from .key_manager import KeyManager

@dataclass
class TaskRequirements:
    text: bool = True
    vision: bool = False
    audio: bool = False
    computer_use: bool = False
    tool_calling: bool = False
    streaming: bool = False
    low_latency: bool = False
    coding: bool = False
    reasoning: bool = False
    cost_preference: str = "balanced" # low, balanced, high
    speed_preference: str = "balanced"
    quality_preference: str = "balanced"
    preferred_provider: Optional[str] = None
    preferred_model: Optional[str] = None
    preferred_key_slot: Optional[int] = None
    strict_model_route: bool = False

@dataclass
class RouteCandidate:
    provider_id: str
    model_id: str
    key_slot: int
    score: int
    fallback_available: bool

class ModelRouter:
    def __init__(self, capability_registry: CapabilityRegistry, provider_registry: ProviderRegistry, key_manager: KeyManager):
        self.capability_registry = capability_registry
        self.provider_registry = provider_registry
        self.key_manager = key_manager
        self.unavailable_models: set[Tuple[str, str]] = set()
        self.default_cost_preference = "balanced"
        self.default_speed_preference = "balanced"
        self.default_quality_preference = "balanced"
        self.default_provider: Optional[str] = None
        self.default_model: Optional[str] = None
        self._selection_lock = threading.Lock()
        self._candidate_cursors = {}

    def mark_model_unavailable(self, provider_id: str, model_id: str) -> None:
        self.unavailable_models.add((provider_id, model_id))

    def get_best_candidate(self, requirements: TaskRequirements) -> Optional[RouteCandidate]:
        return self.get_balanced_candidate(
            self._get_all_candidates(requirements)
        )

    def get_balanced_candidate(
        self,
        candidates: List[RouteCandidate],
    ) -> Optional[RouteCandidate]:
        if not candidates:
            return None
        best_score = max(candidate.score for candidate in candidates)
        best_candidates = [
            candidate for candidate in candidates
            if candidate.score == best_score
        ]
        routes = []
        seen_credentials = set()
        for candidate in best_candidates:
            prov = self.provider_registry.get_registered_provider(candidate.provider_id)
            if prov and getattr(prov, "no_key_required", False):
                routes.append(candidate)
                continue
            credential = self.key_manager.get_key(
                candidate.provider_id,
                candidate.key_slot,
            )
            if not credential or credential in seen_credentials:
                continue
            seen_credentials.add(credential)
            routes.append(candidate)
        if not routes:
            return None
        route_key = tuple(
            (route.provider_id, route.model_id, route.key_slot)
            for route in routes
        )
        with self._selection_lock:
            index = self._candidate_cursors.get(route_key, 0)
            self._candidate_cursors[route_key] = index + 1
        return routes[index % len(routes)]

    def get_fallback_candidates(
        self,
        requirements: TaskRequirements,
        exclude: List[Tuple[str, str, int]],
        *,
        prefer_last_key: bool = False,
    ) -> List[RouteCandidate]:
        candidates = self._get_all_candidates(requirements)
        valid = []
        for c in candidates:
            if (c.provider_id, c.model_id, c.key_slot) not in exclude:
                valid.append(c)
        if prefer_last_key:
            return sorted(
                valid,
                key=lambda candidate: (
                    -candidate.key_slot,
                    -candidate.score,
                    candidate.provider_id,
                    candidate.model_id,
                ),
            )
        return sorted(valid, key=lambda c: c.score, reverse=True)

    def get_separate_vision_candidates(
        self,
        response_candidate: RouteCandidate,
    ) -> List[RouteCandidate]:
        response_key = self.key_manager.get_key(
            response_candidate.provider_id,
            response_candidate.key_slot,
        )
        if not response_key:
            return []

        candidates = self._get_all_candidates(
            TaskRequirements(text=True, vision=True, cost_preference="low")
        )
        separate = [
            candidate
            for candidate in candidates
            if self.key_manager.get_key(
                candidate.provider_id,
                candidate.key_slot,
            )
            and self.key_manager.get_key(
                candidate.provider_id,
                candidate.key_slot,
            ) != response_key
        ]
        return sorted(
            separate,
            key=lambda candidate: (
                -candidate.key_slot,
                -candidate.score,
                candidate.provider_id,
                candidate.model_id,
            ),
        )

    def _get_all_candidates(self, reqs: TaskRequirements) -> List[RouteCandidate]:
        cost_preference = (
            self.default_cost_preference
            if reqs.cost_preference == "balanced"
            else reqs.cost_preference
        )
        speed_preference = self.default_speed_preference if reqs.speed_preference == "balanced" else reqs.speed_preference
        quality_preference = self.default_quality_preference if reqs.quality_preference == "balanced" else reqs.quality_preference
        preferred_provider = reqs.preferred_provider or self.default_provider
        preferred_model = reqs.preferred_model or self.default_model
        required_caps = {}
        for attr in ['text', 'vision', 'audio', 'computer_use', 'tool_calling', 'streaming', 'low_latency', 'coding', 'reasoning']:
            if getattr(reqs, attr): required_caps[attr] = True

        configured_providers = set(self.key_manager.get_configured_providers())
        for pid in ["free", "ollama"]:
            if self.provider_registry.is_provider_available(pid):
                configured_providers.add(pid)
        providers_to_check = [
            provider
            for provider in configured_providers
            if self.provider_registry.is_provider_available(provider)
        ]
        
        models = self.capability_registry.filter_by_capabilities(required_caps, provider_filter=providers_to_check)
        
        candidates = []
        for model in models:
            if (model.provider, model.id) in self.unavailable_models:
                continue
            if reqs.strict_model_route and (
                model.provider != preferred_provider
                or model.id != preferred_model
            ):
                continue
            score = 100 + model.priority
            if preferred_model == model.id:
                score += 500
            if preferred_provider == model.provider:
                score += 100
            if cost_preference == model.capabilities.cost_tier:
                score += 50
            if speed_preference == "low":
                score += 35 if model.capabilities.low_latency or model.capabilities.cost_tier == "low" else 0
            elif speed_preference == "high":
                score += 15 if model.capabilities.streaming else 0
            if quality_preference == "high":
                score += 35 if model.capabilities.reasoning or model.capabilities.long_context else 0
            elif quality_preference == "low":
                score += 20 if model.capabilities.cost_tier == "low" else 0

            slots_and_keys = list(self.key_manager.get_available_keys(model.provider))
            prov_obj = self.provider_registry.get_registered_provider(model.provider)
            if not slots_and_keys and prov_obj and getattr(prov_obj, "no_key_required", False):
                slots_and_keys = [(0, "free-or-local")]
            for slot, _key in slots_and_keys:
                if (
                    reqs.preferred_key_slot is not None
                    and slot != reqs.preferred_key_slot
                ):
                    continue
                candidates.append(RouteCandidate(
                    provider_id=model.provider,
                    model_id=model.id,
                    key_slot=slot,
                    score=score,
                    fallback_available=True
                ))
        return sorted(
            candidates,
            key=lambda candidate: (-candidate.score, candidate.provider_id, candidate.model_id, candidate.key_slot),
        )
