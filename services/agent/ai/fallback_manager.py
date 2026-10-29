import json
import logging
import re
import time
import uuid
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Any
from .model_router import RouteCandidate, TaskRequirements, ModelRouter
from .key_manager import KeyManager
try:
    from core.event_bus import EventBus
except ImportError:
    from ..core.event_bus import EventBus
from .base_provider import AgentError

logger = logging.getLogger(__name__)
_SENSITIVE_FIELD = re.compile(
    r"(?:api[_-]?key|authorization|secret|password|credential|access[_-]?token)",
    re.IGNORECASE,
)
_CONTEXT_LIMIT_PATTERNS = (
    re.compile(r"context.{0,30}(?:length|window|limit|exceed|maximum)", re.IGNORECASE),
    re.compile(r"(?:length|window|limit|maximum).{0,30}context", re.IGNORECASE),
    re.compile(r"(?:prompt|input|request).{0,30}(?:too long|too large|exceed.{0,12}limit)", re.IGNORECASE),
    re.compile(r"too many tokens.{0,30}(?:prompt|input|request|context)", re.IGNORECASE),
    re.compile(r"reduce the (?:length|size) of (?:the )?(?:messages|prompt|input)", re.IGNORECASE),
    re.compile(r"413.{0,30}(?:payload|request).{0,20}(?:large|size)", re.IGNORECASE),
)


def _is_request_context_limit_error(error: Exception) -> bool:
    code = str(getattr(error, "code", "")).upper()
    if code in {
        "CONTEXT_LENGTH_EXCEEDED",
        "CONTEXT_WINDOW_EXCEEDED",
        "PROMPT_TOO_LONG",
        "REQUEST_TOO_LARGE",
    }:
        return True
    message = str(error)
    return any(pattern.search(message) for pattern in _CONTEXT_LIMIT_PATTERNS)


def _safe_request_value(value: Any, field_name: str = "") -> Any:
    if _SENSITIVE_FIELD.search(field_name):
        return "[REDACTED]"
    if field_name.casefold() in {"image_bytes", "screenshot_bytes"} and isinstance(
        value, bytes
    ):
        return f"[binary image omitted: {len(value)} bytes]"
    if isinstance(value, bytes):
        return f"[binary payload omitted: {len(value)} bytes]"
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return _safe_request_value(asdict(value))
    if isinstance(value, dict):
        return {
            str(key): _safe_request_value(item, str(key))
            for key, item in value.items()
            if not str(key).startswith("_")
        }
    if isinstance(value, (list, tuple, set)):
        return [_safe_request_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "__dict__"):
        return _safe_request_value(vars(value))
    return str(value)


def _request_snapshot(context: dict, configured_keys: dict | None = None) -> Any:
    safe_context = _safe_request_value(context)
    encoded = json.dumps(safe_context, ensure_ascii=False, default=str)
    for provider_keys in (configured_keys or {}).values():
        for key in provider_keys:
            if key:
                encoded = encoded.replace(key, "[REDACTED]")
    if len(encoded) <= 50000:
        return json.loads(encoded)
    return {"truncated": True, "preview": encoded[:50000]}

class FallbackManager:
    def __init__(self, model_router: ModelRouter, key_manager: KeyManager, event_bus: EventBus):
        self.model_router = model_router
        self.key_manager = key_manager
        self.event_bus = event_bus
        self.fallback_enabled = True
        self.cross_provider_fallback = True

    async def execute_with_fallback(
        self,
        provider_call_fn: Callable,
        requirements: TaskRequirements,
        context: dict,
        *,
        prefer_last_key: bool = False,
        allow_cross_provider: bool | None = None,
    ) -> Any:
        cross_provider_enabled = (
            self.cross_provider_fallback
            if allow_cross_provider is None
            else allow_cross_provider
        )
        execution_failed_models = context.setdefault(
            "_execution_failed_models",
            set(),
        )
        execution_failed_keys = context.setdefault(
            "_execution_failed_keys",
            set(),
        )
        execution_failed_candidates = context.setdefault(
            "_execution_failed_candidates",
            set(),
        )
        excluded_api_keys = set(context.get("_excluded_api_keys", ()))

        def is_blocked(option):
            return (
                self.key_manager.get_key(option.provider_id, option.key_slot)
                in excluded_api_keys
                or
                (option.provider_id, option.model_id) in execution_failed_models
                or (option.provider_id, option.key_slot) in execution_failed_keys
                or (
                    option.provider_id,
                    option.model_id,
                    option.key_slot,
                ) in execution_failed_candidates
            )

        candidates = self.model_router.get_fallback_candidates(
            requirements,
            exclude=[],
            prefer_last_key=prefer_last_key,
        )
        available_candidates = [
            option for option in candidates if not is_blocked(option)
        ]
        candidate = (
            available_candidates[0]
            if prefer_last_key and available_candidates
            else self.model_router.get_balanced_candidate(available_candidates)
        )
        if candidate is None and excluded_api_keys:
            excluded_api_keys.clear()
            available_candidates = [
                option
                for option in self.model_router.get_fallback_candidates(
                    requirements,
                    exclude=[],
                    prefer_last_key=prefer_last_key,
                )
                if not is_blocked(option)
            ]
            candidate = (
                available_candidates[0]
                if prefer_last_key and available_candidates
                else self.model_router.get_balanced_candidate(
                    available_candidates
                )
            )
            if candidate is not None:
                logger.info(
                    "Using the parent agent's credential as a last resort; "
                    "no compatible alternative route is available"
                )
        if not candidate:
            configured_providers = self.key_manager.get_configured_providers()
            if not configured_providers:
                raise RuntimeError(
                    "No AI provider API keys are configured. Use Save & Validate "
                    "in AI settings before sending requests."
                )
            raise RuntimeError(
                "ProviderExhaustedError: No configured model supports the required "
                "task capabilities. Choose a compatible model or provider in AI settings."
            )

        tried_candidates = set()
        attempts = 0
        last_error = None
        context_retry_count = 0
        retry_same_candidate = False
        
        while candidate:
            tried_tuple = (candidate.provider_id, candidate.model_id, candidate.key_slot)
            if tried_tuple in tried_candidates and not retry_same_candidate:
                break
            if not retry_same_candidate:
                tried_candidates.add(tried_tuple)
            retry_same_candidate = False
            attempts += 1
            task_id = context.get("_helix_task_id")
            request_payload = {
                "task_id": task_id,
                "request_id": str(uuid.uuid4()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "attempt": attempts,
                "provider": candidate.provider_id,
                "model": candidate.model_id,
                "key_slot": candidate.key_slot + 1,
                "status": "attempting",
                "timeout_seconds": context.get("_model_request_timeout_seconds"),
                "request": _request_snapshot(context, self.key_manager.keys),
            }
            if task_id:
                await self.event_bus.publish("MODEL_REQUEST", request_payload)
            logger.info(
                "Trying model provider=%s model=%s key_slot=%d attempt=%d",
                candidate.provider_id,
                candidate.model_id,
                candidate.key_slot + 1,
                attempts,
            )
            try:
                started_at = time.perf_counter()
                result = await provider_call_fn(candidate, context)
                latency_ms = round((time.perf_counter() - started_at) * 1000)
                self.key_manager.mark_key_success(candidate.provider_id, candidate.key_slot)
                logger.info(
                    "Model attempt succeeded provider=%s model=%s key_slot=%d duration_ms=%d",
                    candidate.provider_id,
                    candidate.model_id,
                    candidate.key_slot + 1,
                    latency_ms,
                )
                if task_id:
                    await self.event_bus.publish(
                        "MODEL_REQUEST",
                        {**request_payload, "status": "succeeded", "latency_ms": latency_ms},
                    )
                return result
            except Exception as error:
                latency_ms = round((time.perf_counter() - started_at) * 1000)
                e = error if isinstance(error, AgentError) else AgentError(
                    code="UNKNOWN",
                    message=str(error),
                    provider=candidate.provider_id,
                    model=candidate.model_id,
                    retryable=False,
                    original_exception=error,
                )
                if _is_request_context_limit_error(e):
                    e = AgentError(
                        code="CONTEXT_LENGTH_EXCEEDED",
                        message="The request exceeded the model's input context limit.",
                        provider=candidate.provider_id,
                        model=candidate.model_id,
                        retryable=False,
                        original_exception=error,
                    )
                    context["_helix_context_limit_encountered"] = True
                    compact_context = context.get("_helix_context_recovery")
                    if context_retry_count < 2 and callable(compact_context):
                        if compact_context():
                            context_retry_count += 1
                            retry_same_candidate = True
                            logger.info(
                                "Request context exceeded model limit; compacted "
                                "conversation and retrying provider=%s model=%s "
                                "level=%s",
                                candidate.provider_id,
                                candidate.model_id,
                                context.get("_helix_context_recovery_level"),
                            )
                            continue
                last_error = e
                safe_message = self._redact_key_values(e.message)
                model_scoped_limit = prefer_last_key and e.code in {
                    "RATE_LIMIT",
                    "QUOTA_EXCEEDED",
                }
                if e.code not in {
                    "INTERNAL_CLIENT_ERROR",
                    "CONTEXT_LENGTH_EXCEEDED",
                } and not model_scoped_limit:
                    self.key_manager.mark_key_failure(
                        candidate.provider_id,
                        candidate.key_slot,
                        e.code,
                    )
                logger.warning(
                    "Model attempt failed provider=%s model=%s key_slot=%d "
                    "error=%s retryable=%s duration_ms=%d message=%s",
                    candidate.provider_id,
                    candidate.model_id,
                    candidate.key_slot + 1,
                    e.code,
                    e.retryable,
                    latency_ms,
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
                        "latency_ms": latency_ms,
                        "message": safe_message,
                    },
                )
                if task_id:
                    await self.event_bus.publish(
                        "MODEL_REQUEST",
                        {
                            **request_payload,
                            "status": "failed",
                            "latency_ms": latency_ms,
                            "error": {
                                "code": e.code,
                                "message": safe_message[:2000],
                            },
                        },
                    )
                if e.code == "INTERNAL_CLIENT_ERROR":
                    raise e

                if not self.fallback_enabled:
                    if e.code == "CONTEXT_LENGTH_EXCEEDED":
                        raise AgentError(
                            code=e.code,
                            message=(
                                "The request remained too large after HELIX "
                                "compacted its conversation context."
                            ),
                            provider=candidate.provider_id,
                            model=candidate.model_id,
                            retryable=False,
                            original_exception=error,
                        ) from error
                    await self.event_bus.publish(
                        "PROVIDER_FAILED",
                        {"requirements": requirements.__dict__},
                    )
                    raise RuntimeError(
                        f"Model request failed and fallback is disabled: {e.code}."
                    ) from e

                if e.code == "QUOTA_EXCEEDED":
                    execution_failed_candidates.add(
                        (
                            candidate.provider_id,
                            candidate.model_id,
                            candidate.key_slot,
                        )
                    )
                    logger.info(
                        "Skipping model/key candidate for remainder of execution "
                        "after quota provider=%s model=%s key_slot=%d",
                        candidate.provider_id,
                        candidate.model_id,
                        candidate.key_slot + 1,
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
                elif e.code in {
                    "MODEL_UNAVAILABLE",
                    "MODEL_TEMPORARILY_UNAVAILABLE",
                }:
                    execution_failed_models.add(
                        (candidate.provider_id, candidate.model_id)
                    )
                    if e.code == "MODEL_UNAVAILABLE":
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
                    else:
                        logger.info(
                            "Skipping temporarily unavailable model for this "
                            "execution provider=%s model=%s",
                            candidate.provider_id,
                            candidate.model_id,
                        )

                candidates = self.model_router.get_fallback_candidates(
                    requirements,
                    exclude=list(tried_candidates),
                    prefer_last_key=prefer_last_key,
                )
                next_candidate = next(
                    (
                        option
                        for option in candidates
                        if not is_blocked(option)
                        and (
                            cross_provider_enabled
                            or option.provider_id == candidate.provider_id
                        )
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

        if last_error and last_error.code == "CONTEXT_LENGTH_EXCEEDED":
            raise AgentError(
                code="CONTEXT_LENGTH_EXCEEDED",
                message=(
                    "The request remained too large after HELIX compacted its "
                    "conversation context and tried compatible alternatives."
                ),
                provider=last_error.provider,
                model=last_error.model,
                retryable=False,
                original_exception=last_error,
            ) from last_error

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
