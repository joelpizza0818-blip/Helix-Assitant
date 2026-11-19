"""Central conversational confirmation manager.

Every confirmation - typed, spoken or clicked - travels through this class.
It binds a decision to one pending request, expires it, and makes it
single-use.  No UI may publish CONFIRMATION_GRANTED directly for a
conversational confirmation; the existing desktop buttons still use the
event protocol, but the voice/text path always goes through here.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from .confirmation_intents import (
    ConfirmationDecision,
    ConfirmationIntent,
    parse_confirmation_intent,
)

logger = logging.getLogger(__name__)


DEFAULT_CONFIRMATION_TTL_SECONDS = 120
MAX_PENDING_CONFIRMATIONS = 32


_ACTION_LABELS = {
    "shell_tool": (
        "run a command in the terminal",
        "ejecutar un comando en la terminal",
    ),
    "computer.desktop_control": (
        "control your desktop",
        "controlar tu escritorio",
    ),
    "desktop_control_tool": (
        "control your desktop",
        "controlar tu escritorio",
    ),
    "browser_control_tool": (
        "control the browser",
        "controlar el navegador",
    ),
    "browser_tool": (
        "use the browser",
        "usar el navegador",
    ),
    "write_file": (
        "write a file",
        "escribir un archivo",
    ),
    "file_write_tool": (
        "write a file",
        "escribir un archivo",
    ),
    "memory_tool": (
        "change your saved memory",
        "cambiar tu memoria guardada",
    ),
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _looks_spanish(text: str) -> bool:
    if re.search(r"[¿¡ñáéíóúü]", text, re.IGNORECASE):
        return True
    lowered = f" {text.lower()} "
    return sum(
        1
        for word in (
            " que ",
            " para ",
            " con ",
            " esto ",
            " archivo ",
            " carpeta ",
            " comando ",
            " pantalla ",
            " necesito ",
            " permiso ",
            " aprobar ",
        )
        if word in lowered
    ) >= 2


def describe_action(action: str, spanish: bool = False) -> str:
    key = (action or "action").strip()
    if key in _ACTION_LABELS:
        return _ACTION_LABELS[key][1 if spanish else 0]
    readable = key.replace("_tool", "").replace("_", " ").replace(".", " ")
    readable = re.sub(r"\s+", " ", readable).strip()
    if not readable:
        readable = "continuar" if spanish else "continue"
    return (
        f"realizar la acción {readable}" if spanish else f"perform {readable}"
    )


@dataclass
class PendingConfirmation:
    request_id: str
    action: str
    what_will_change: str
    why: str
    level: str
    task_id: Optional[str]
    conversation_id: Optional[str]
    created_at: float
    expires_at: float
    created_at_iso: str
    source: str = "text"
    source_device_id: Optional[str] = None
    prompt_text: str = ""
    matched_phrases: list[str] = field(default_factory=list)

    def remaining_seconds(self, now: Optional[float] = None) -> float:
        return max(0.0, self.expires_at - (now if now is not None else time.monotonic()))

    def public(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "action": self.action,
            "what_will_change": self.what_will_change,
            "why": self.why,
            "level": self.level,
            "task_id": self.task_id,
            "conversation_id": self.conversation_id,
            "created_at": self.created_at_iso,
            "expires_in_seconds": round(self.remaining_seconds(), 1),
            "source": self.source,
            "prompt_text": self.prompt_text,
            **(
                {"source_device_id": self.source_device_id}
                if self.source_device_id
                else {}
            ),
        }


@dataclass(frozen=True)
class ConfirmationOutcome:
    decision: str
    request_id: Optional[str] = None
    confidence: float = 0.0
    instructions: str = ""
    message: str = ""
    action: str = ""
    handled: bool = False
    followup_text: str = ""

    @property
    def resolved(self) -> bool:
        return self.decision in {"approve", "reject", "modify"}


class ConversationConfirmationManager:
    """Bind natural-language decisions to exactly one pending action."""

    def __init__(
        self,
        event_bus,
        *,
        ttl_seconds: int = DEFAULT_CONFIRMATION_TTL_SECONDS,
        clock=time.monotonic,
    ) -> None:
        self.event_bus = event_bus
        self.ttl_seconds = max(10, int(ttl_seconds))
        self.clock = clock
        self._pending: dict[str, PendingConfirmation] = {}
        self._lock = asyncio.Lock()
        self._started = False
        self._resolved_count = 0
        self._expired_count = 0

    async def start(self) -> None:
        if self._started:
            return
        subscribe = getattr(self.event_bus, "subscribe", None)
        if subscribe is not None:
            await subscribe("WAIT_CONFIRMATION", self._on_wait_confirmation)
            await subscribe("CONFIRMATION_RESOLVED", self._on_confirmation_resolved)
        self._started = True

    async def stop(self) -> None:
        if not self._started:
            return
        unsubscribe = getattr(self.event_bus, "unsubscribe", None)
        if unsubscribe is not None:
            try:
                await unsubscribe("WAIT_CONFIRMATION", self._on_wait_confirmation)
                await unsubscribe("CONFIRMATION_RESOLVED", self._on_confirmation_resolved)
            except Exception:
                logger.debug("Could not unsubscribe confirmation handlers", exc_info=True)
        self._started = False

    # ------------------------------------------------------------------
    # Event intake
    # ------------------------------------------------------------------

    async def _on_wait_confirmation(self, _event_name: str, payload: dict) -> None:
        request_id = payload.get("id")
        if not isinstance(request_id, str) or not request_id:
            return
        action = str(payload.get("action") or "action")
        why = str(payload.get("why") or "")
        what = str(payload.get("what_will_change") or "")
        conversation_id = payload.get("conversation_id")
        if not isinstance(conversation_id, str) or not conversation_id:
            conversation_id = None
        source_device_id = payload.get("source_device_id")
        if not isinstance(source_device_id, str) or not source_device_id:
            source_device_id = None
        source = "voice" if (conversation_id or "").startswith("voice_") else "text"
        spanish = _looks_spanish(f"{why} {what} {action}")
        prompt = (
            f"Voy a {describe_action(action, True)}. ¿Te parece bien?"
            if spanish
            else f"I'm about to {describe_action(action)}. Does that work for you?"
        )
        now = self.clock()
        pending = PendingConfirmation(
            request_id=request_id,
            action=action,
            what_will_change=what,
            why=why,
            level=str(payload.get("level") or ""),
            task_id=payload.get("task_id"),
            conversation_id=conversation_id,
            created_at=now,
            expires_at=now + self.ttl_seconds,
            created_at_iso=str(payload.get("created_at") or _utc_now_iso()),
            source=source,
            source_device_id=source_device_id,
            prompt_text=prompt,
        )
        async with self._lock:
            self._expire_locked(now)
            self._pending[request_id] = pending
            while len(self._pending) > MAX_PENDING_CONFIRMATIONS:
                oldest = min(self._pending.values(), key=lambda item: item.created_at)
                self._pending.pop(oldest.request_id, None)
        logger.info(
            "VOICE_CONFIRMATION_PENDING request_id=%s action=%s conversation=%s",
            request_id,
            action,
            conversation_id or "-",
        )
        await self._publish(
            "CONVERSATION_CONFIRMATION_PENDING",
            {
                **pending.public(),
                "speech_text": prompt,
            },
        )

    async def _on_confirmation_resolved(self, _event_name: str, payload: dict) -> None:
        request_id = payload.get("request_id")
        if not isinstance(request_id, str):
            return
        async with self._lock:
            self._pending.pop(request_id, None)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def get_pending(
        self, conversation_id: Optional[str] = None
    ) -> list[PendingConfirmation]:
        now = self.clock()
        async with self._lock:
            self._expire_locked(now)
            pending = list(self._pending.values())
        if isinstance(conversation_id, str) and conversation_id:
            pending = [
                item for item in pending if item.conversation_id == conversation_id
            ]
        return sorted(pending, key=lambda item: item.created_at)

    async def prompt_for(self, request_id: str) -> Optional[str]:
        async with self._lock:
            item = self._pending.get(request_id)
            return item.prompt_text if item else None

    async def snapshot(self) -> list[dict[str, Any]]:
        pending = await self.get_pending()
        return [item.public() for item in pending]

    @property
    def resolved_count(self) -> int:
        return self._resolved_count

    @property
    def expired_count(self) -> int:
        return self._expired_count

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def _expire_locked(self, now: float) -> None:
        expired = [
            request_id
            for request_id, item in self._pending.items()
            if item.expires_at <= now
        ]
        for request_id in expired:
            self._pending.pop(request_id, None)
            self._expired_count += 1

    def _select_locked(
        self, conversation_id: Optional[str]
    ) -> tuple[Optional[PendingConfirmation], str]:
        if conversation_id:
            matches = [
                item
                for item in self._pending.values()
                if item.conversation_id == conversation_id
            ]
            if not matches:
                return None, "no_pending_for_conversation"
            if len(matches) > 1:
                matches.sort(key=lambda item: item.created_at)
                return matches[-1], "multiple_pending"
            return matches[0], "matched"
        if not self._pending:
            return None, "no_pending"
        if len(self._pending) > 1:
            return None, "multiple_pending_without_conversation"
        return next(iter(self._pending.values())), "matched"

    async def try_resolve_text(
        self,
        text: str,
        *,
        conversation_id: Optional[str] = None,
        source: str = "text",
    ) -> ConfirmationOutcome:
        intent: ConfirmationIntent = parse_confirmation_intent(text)
        if intent.decision is ConfirmationDecision.NONE:
            return ConfirmationOutcome(decision="none", handled=False)

        now = self.clock()
        async with self._lock:
            self._expire_locked(now)
            pending, reason = self._select_locked(conversation_id)
        if pending is None:
            if reason.startswith("multiple"):
                return ConfirmationOutcome(
                    decision="ambiguous",
                    confidence=intent.confidence,
                    message=(
                        "Several actions are waiting for approval. Please decide "
                        "from the confirmation panel so the exact action is clear."
                    ),
                    handled=True,
                )
            # A plain "yes" with no pending action is ordinary conversation.
            return ConfirmationOutcome(decision="none", handled=False)

        if intent.decision is ConfirmationDecision.AMBIGUOUS:
            logger.info(
                "VOICE_CONFIRMATION_AMBIGUOUS request_id=%s reason=%s",
                pending.request_id,
                intent.matched,
            )
            return ConfirmationOutcome(
                decision="ambiguous",
                request_id=pending.request_id,
                confidence=intent.confidence,
                message=intent.message
                or "Let me know whether you’re comfortable with me going ahead.",
                action=pending.action,
                handled=True,
            )

        if intent.decision is ConfirmationDecision.MODIFY:
            await self._resolve(
                pending,
                approved=False,
                decision="modify",
                source=source,
                instructions=intent.instructions,
                reason="conversation_modification",
            )
            followup = (
                "The user wants to modify the pending action "
                f"'{pending.action}' before approving it. Their requested change: "
                f"{intent.instructions}. Re-plan the request with this change; "
                "a new confirmation is required before any tool runs."
            )
            return ConfirmationOutcome(
                decision="modify",
                request_id=pending.request_id,
                confidence=intent.confidence,
                instructions=intent.instructions,
                message="Understood. I will ask for approval again with the change.",
                action=pending.action,
                handled=True,
                followup_text=followup,
            )

        approved = intent.decision is ConfirmationDecision.APPROVE
        await self._resolve(
            pending,
            approved=approved,
            decision="approve" if approved else "reject",
            source=source,
            reason=(
                "conversation_approval" if approved else "conversation_rejection"
            ),
        )
        return ConfirmationOutcome(
            decision="approve" if approved else "reject",
            request_id=pending.request_id,
            confidence=intent.confidence,
            action=pending.action,
            handled=True,
        )

    async def resolve_explicit(
        self,
        request_id: str,
        decision: str,
        *,
        instructions: str = "",
        source: str = "ui",
    ) -> ConfirmationOutcome:
        """Resolve a confirmation from a button or structured client event."""
        decision = (decision or "").strip().lower()
        if decision not in {"approve", "reject", "modify"}:
            return ConfirmationOutcome(
                decision="none",
                handled=False,
                message="decision must be approve, reject or modify",
            )
        if decision == "modify" and not instructions.strip():
            return ConfirmationOutcome(
                decision="ambiguous",
                handled=True,
                message="A modification needs instructions.",
            )
        now = self.clock()
        async with self._lock:
            self._expire_locked(now)
            pending = self._pending.get(request_id)
        if pending is None:
            return ConfirmationOutcome(
                decision="expired",
                request_id=request_id,
                handled=True,
                message="This confirmation has expired or was already resolved.",
            )
        await self._resolve(
            pending,
            approved=decision == "approve",
            decision=decision,
            source=source,
            instructions=instructions.strip(),
            reason=f"{source}_{decision}",
        )
        return ConfirmationOutcome(
            decision=decision,
            request_id=request_id,
            confidence=1.0,
            instructions=instructions.strip(),
            action=pending.action,
            handled=True,
            followup_text=(
                "The user wants to modify the pending action "
                f"'{pending.action}' before approving it. Their requested change: "
                f"{instructions.strip()}. Re-plan the request with this change; "
                "a new confirmation is required before any tool runs."
                if decision == "modify"
                else ""
            ),
        )

    async def cancel_all(self, *, source: str = "cleanup", reason: str = "cancelled") -> int:
        async with self._lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for item in pending:
            await self._publish_confirmation_event(
                "CONFIRMATION_REJECTED",
                item,
                approved=False,
                reason=reason,
                source=source,
            )
            self._resolved_count += 1
        return len(pending)

    async def _resolve(
        self,
        pending: PendingConfirmation,
        *,
        approved: bool,
        decision: str,
        source: str,
        instructions: str = "",
        reason: str,
    ) -> None:
        async with self._lock:
            # Single use: remove before publishing so a second message can
            # never resolve the same action.
            if self._pending.pop(pending.request_id, None) is None:
                return
            self._resolved_count += 1
        logger.info(
            "VOICE_CONFIRMATION_RESOLVED request_id=%s decision=%s source=%s",
            pending.request_id,
            decision,
            source,
        )
        await self._publish_confirmation_event(
            "CONFIRMATION_GRANTED" if approved else "CONFIRMATION_REJECTED",
            pending,
            approved=approved,
            reason=reason,
            source=source,
            decided_decision=decision,
            instructions=instructions,
        )
        await self._publish(
            "CONVERSATION_CONFIRMATION_RESOLVED",
            {
                "request_id": pending.request_id,
                "action": pending.action,
                "decision": decision,
                "approved": approved,
                "source": source,
                "conversation_id": pending.conversation_id,
                "instructions": instructions,
                "message": (
                    "Approved."
                    if decision == "approve"
                    else "Cancelled."
                    if decision == "reject"
                    else "I will ask again with the requested change."
                ),
            },
        )

    async def _publish_confirmation_event(
        self,
        event_name: str,
        pending: PendingConfirmation,
        *,
        approved: bool,
        reason: str,
        source: str,
        decided_decision: str = "",
        instructions: str = "",
    ) -> None:
        await self._publish(
            event_name,
            {
                "request_id": pending.request_id,
                "task_id": pending.task_id,
                "approved": approved,
                "reason": reason,
                "source": source,
                "decision": decided_decision or ("approve" if approved else "reject"),
                "instructions": instructions,
                **(
                    {"conversation_id": pending.conversation_id}
                    if pending.conversation_id
                    else {}
                ),
                **(
                    {"source_device_id": pending.source_device_id}
                    if pending.source_device_id
                    else {}
                ),
            },
        )

    async def _publish(self, event_name: str, payload: dict) -> None:
        publish = getattr(self.event_bus, "publish", None)
        if publish is not None:
            try:
                await publish(event_name, payload)
            except Exception:
                logger.exception("Could not publish %s", event_name)
