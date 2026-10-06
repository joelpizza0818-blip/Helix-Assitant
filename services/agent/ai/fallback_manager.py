import logging
from typing import Callable, Any
from .model_router import RouteCandidate, TaskRequirements, ModelRouter
from .key_manager import KeyManager
try:
    from core.event_bus import EventBus
except ImportError:
    from ..core.event_bus import EventBus
from .base_provider import AgentError

logger = logging.getLogger(__name__)

class FallbackManager:
    def __init__(self, model_router: ModelRouter, key_manager: KeyManager, event_bus: EventBus):
        self.model_router = model_router
        self.key_manager = key_manager
        self.event_bus = event_bus
        self.cross_provider_fallback = False

    async def execute_with_fallback(self, provider_call_fn: Callable, requirements: TaskRequirements, context: dict) -> Any:
        candidate = self.model_router.get_best_candidate(requirements)
        if not candidate:
            raise Exception("No suitable model/provider found for requirements.")

        tried_candidates = set()
        
        while candidate:
            tried_tuple = (candidate.provider_id, candidate.model_id, candidate.key_slot)
            tried_candidates.add(tried_tuple)
            try:
                # Assuming provider_call_fn takes candidate info and context
                result = await provider_call_fn(candidate, context)
                self.key_manager.mark_key_success(candidate.provider_id, candidate.key_slot)
                return result
            except AgentError as e:
                logger.warning(f"Error calling {candidate.model_id} via {candidate.provider_id}: {e.message}")
                self.key_manager.mark_key_failure(candidate.provider_id, candidate.key_slot, e.code)
                await self.event_bus.publish("KEY_FAILED", {"provider": candidate.provider_id, "slot": candidate.key_slot, "error": e.code})

                if not e.retryable:
                    logger.error(f"Non-retryable error: {e.code}")
                
                await self.event_bus.publish("MODEL_FALLBACK", {"from_model": candidate.model_id, "error": e.code})
                
                # Try next candidate
                candidates = self.model_router.get_fallback_candidates(requirements, exclude=list(tried_candidates))
                candidate = None
                for c in candidates:
                    # Enforce provider boundary unless cross_provider_fallback is True
                    if not self.cross_provider_fallback and c.provider_id != e.provider:
                        continue
                    candidate = c
                    break

        await self.event_bus.publish("PROVIDER_FAILED", {"requirements": requirements.__dict__})
        raise Exception("ProviderExhaustedError: All available models/keys exhausted.")
