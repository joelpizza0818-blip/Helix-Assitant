from dataclasses import dataclass
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

    def mark_model_unavailable(self, provider_id: str, model_id: str) -> None:
        self.unavailable_models.add((provider_id, model_id))

    def get_best_candidate(self, requirements: TaskRequirements) -> Optional[RouteCandidate]:
        candidates = self._get_all_candidates(requirements)
        if not candidates:
            return None
        return sorted(candidates, key=lambda c: c.score, reverse=True)[0]

    def get_fallback_candidates(self, requirements: TaskRequirements, exclude: List[Tuple[str, str, int]]) -> List[RouteCandidate]:
        candidates = self._get_all_candidates(requirements)
        valid = []
        for c in candidates:
            if (c.provider_id, c.model_id, c.key_slot) not in exclude:
                valid.append(c)
        return sorted(valid, key=lambda c: c.score, reverse=True)

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

        providers_to_check = [
            provider
            for provider in self.key_manager.get_configured_providers()
            if self.provider_registry.is_provider_available(provider)
        ]
        
        models = self.capability_registry.filter_by_capabilities(required_caps, provider_filter=providers_to_check)
        
        candidates = []
        for model in models:
            if (model.provider, model.id) in self.unavailable_models:
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

            for slot, _key in self.key_manager.get_available_keys(model.provider):
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
