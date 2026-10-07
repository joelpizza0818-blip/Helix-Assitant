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
        self.cross_provider_fallback = True

    async def execute_with_fallback(self, provider_call_fn: Callable, requirements: TaskRequirements, context: dict) -> Any:
        execution_failed_models = context.setdefault(
            "_execution_failed_models",
            set(),
        )
        execution_failed_keys = context.setdefault(
            "_execution_failed_keys",
            set(),
        )

        def is_blocked(option):
            return (
                (option.provider_id, option.model_id) in execution_failed_models
                or (option.provider_id, option.key_slot) in execution_failed_keys
            )

        candidate = next(
            (
                option
                for option in self.model_router.get_fallback_candidates(
                    requirements,
                    exclude=[],
                )
                if not is_blocked(option)
            ),
            None,
        )
        if not candidate:
            raise RuntimeError(
                "ProviderExhaustedError: No configured provider has a model "
                "matching the task capabilities."
            )

        tried_candidates = set()
        attempts = 0
        last_error = None
        
        while candidate:
            tried_tuple = (candidate.provider_id, candidate.model_id, candidate.key_slot)
            if tried_tuple in tried_candidates:
                break
            tried_candidates.add(tried_tuple)
            attempts += 1
            logger.info(
                "Trying model provider=%s model=%s key_slot=%d attempt=%d",
                candidate.provider_id,
                candidate.model_id,
                candidate.key_slot + 1,
                attempts,
            )
            try:
                result = await provider_call_fn(candidate, context)
                self.key_manager.mark_key_success(candidate.provider_id, candidate.key_slot)
                return result
            except Exception as error:
                e = error if isinstance(error, AgentError) else AgentError(
                    code="UNKNOWN",
                    message=str(error),
                    provider=candidate.provider_id,
                    model=candidate.model_id,
                    retryable=False,
                    original_exception=error,
                )
                last_error = e
                safe_message = self._redact_key_values(e.message)
                if e.code != "INTERNAL_CLIENT_ERROR":
                    self.key_manager.mark_key_failure(
                        candidate.provider_id,
                        candidate.key_slot,
                        e.code,
                    )
                logger.warning(
                    "Model attempt failed provider=%s model=%s key_slot=%d "
                    "error=%s retryable=%s message=%s",
                    candidate.provider_id,
                    candidate.model_id,
                    candidate.key_slot + 1,
                    e.code,
                    e.retryable,
                    safe_message,
                )
                await self.event_bus.publish(
                    "MODEL_ATTEMPT_FAILED",
                    {
                        "provider": candidate.provider_id,
                        "model": candidate.model_id,
                        "key_slot": candidate.key_slot + 1,
                        "error": e.code,
                        "retryable": e.retryable,
                        "message": safe_message,
                    },
                )
                if e.code == "INTERNAL_CLIENT_ERROR":
                    raise e

                if e.code == "QUOTA_EXCEEDED":
                    execution_failed_models.add(
                        (candidate.provider_id, candidate.model_id)
                    )
                    logger.info(
                        "Skipping model for remainder of execution after quota "
                        "provider=%s model=%s",
                        candidate.provider_id,
                        candidate.model_id,
                    )
                elif e.code == "BILLING_EXHAUSTED":
                    execution_failed_keys.add(
                        (candidate.provider_id, candidate.key_slot)
                    )
                    logger.info(
                        "Skipping key for remainder of execution after billing "
                        "failure provider=%s key_slot=%d",
                        candidate.provider_id,
                        candidate.key_slot + 1,
                    )
                elif e.code == "MODEL_UNAVAILABLE":
                    execution_failed_models.add(
                        (candidate.provider_id, candidate.model_id)
                    )
                    self.model_router.mark_model_unavailable(
                        candidate.provider_id,
                        candidate.model_id,
                    )
                    logger.warning(
                        "Model disabled for this process after confirmed "
                        "unavailability provider=%s model=%s",
                        candidate.provider_id,
                        candidate.model_id,
                    )

                candidates = self.model_router.get_fallback_candidates(
                    requirements,
                    exclude=list(tried_candidates),
                )
                next_candidate = next(
                    (
                        option
                        for option in candidates
                        if not is_blocked(option)
                    ),
                    None,
                )
                fallback_reason = e.code
                if next_candidate and next_candidate.provider_id != candidate.provider_id:
                    fallback_reason = f"{e.code}; provider {candidate.provider_id} exhausted or unavailable"
                await self.event_bus.publish(
                    "MODEL_FALLBACK",
                    {
                        "from_model": candidate.model_id,
                        "from_provider": candidate.provider_id,
                        "to_model": next_candidate.model_id if next_candidate else None,
                        "to_provider": next_candidate.provider_id if next_candidate else None,
                        "key_slot": candidate.key_slot + 1,
                        "error": e.code,
                        "reason": fallback_reason,
                    },
                )
                candidate = next_candidate

        await self.event_bus.publish("PROVIDER_FAILED", {"requirements": requirements.__dict__})
        detail = f" Last error: {last_error.code}." if last_error else ""
        raise RuntimeError(
            f"ProviderExhaustedError: All {attempts} compatible model/key attempts "
            f"were exhausted.{detail}"
        ) from last_error

    def _redact_key_values(self, message: str) -> str:
        for provider_keys in self.key_manager.keys.values():
            for key in provider_keys:
                if key:
                    message = message.replace(key, "[REDACTED]")
        return message
