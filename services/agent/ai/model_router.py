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
            score = 100
            if reqs.preferred_model == model.id:
                score += 500
            if reqs.preferred_provider == model.provider:
                score += 100
            if reqs.cost_preference == model.capabilities.cost_tier:
                score += 50

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
