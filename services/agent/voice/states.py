"""Voice session states and guarded transitions.

The voice subsystem is an interface layer over the existing HELIX agent.  It
must never invent a second assistant, so the state machine is deliberately
small and explicit: every visual state the desktop/mobile clients render is
produced by exactly one transition here.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Awaitable, Callable, Dict, Iterable, Optional, Set

logger = logging.getLogger(__name__)


class VoiceState(str, Enum):
    # States exposed to clients.
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    THINKING = "THINKING"
    SPEAKING = "SPEAKING"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"
    INTERRUPTED = "INTERRUPTED"
    MUTED = "MUTED"
    ERROR = "ERROR"

    # Internal lifecycle states.  They are still emitted so every client can
    # show an honest status instead of freezing.
    INITIALIZING = "INITIALIZING"
    PROCESSING = "PROCESSING"
    STOPPING = "STOPPING"
    CLOSED = "CLOSED"


class VoiceMode(str, Enum):
    LIVE = "live"
    NORMAL = "normal"


# Explicit transition table.  A state may always transition to ERROR or
# CLOSED so failures and cleanup can never be swallowed by the guard.
_ALLOWED: Dict[VoiceState, Set[VoiceState]] = {
    VoiceState.INITIALIZING: {
        VoiceState.IDLE,
        VoiceState.LISTENING,
        VoiceState.MUTED,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.IDLE: {
        VoiceState.LISTENING,
        VoiceState.THINKING,
        VoiceState.MUTED,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.LISTENING: {
        VoiceState.PROCESSING,
        VoiceState.THINKING,
        VoiceState.MUTED,
        VoiceState.INTERRUPTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.PROCESSING: {
        VoiceState.THINKING,
        VoiceState.LISTENING,
        VoiceState.AWAITING_CONFIRMATION,
        VoiceState.INTERRUPTED,
        VoiceState.MUTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.THINKING: {
        VoiceState.SPEAKING,
        VoiceState.LISTENING,
        VoiceState.AWAITING_CONFIRMATION,
        VoiceState.INTERRUPTED,
        VoiceState.MUTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.SPEAKING: {
        VoiceState.LISTENING,
        VoiceState.AWAITING_CONFIRMATION,
        VoiceState.INTERRUPTED,
        VoiceState.MUTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.AWAITING_CONFIRMATION: {
        VoiceState.LISTENING,
        VoiceState.THINKING,
        VoiceState.SPEAKING,
        VoiceState.INTERRUPTED,
        VoiceState.MUTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.INTERRUPTED: {
        VoiceState.LISTENING,
        VoiceState.PROCESSING,
        VoiceState.THINKING,
        VoiceState.MUTED,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.MUTED: {
        VoiceState.LISTENING,
        VoiceState.IDLE,
        VoiceState.ERROR,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.ERROR: {
        VoiceState.IDLE,
        VoiceState.LISTENING,
        VoiceState.MUTED,
        VoiceState.STOPPING,
        VoiceState.CLOSED,
    },
    VoiceState.STOPPING: {VoiceState.CLOSED, VoiceState.ERROR},
    VoiceState.CLOSED: set(),
}

# States in which the microphone may produce a new utterance.  SPEAKING is
# intentionally excluded: live barge-in is initiated by an explicit interrupt
# from the client after its echo canceller detects user speech.
MICROPHONE_STATES: Set[VoiceState] = {
    VoiceState.LISTENING,
    VoiceState.INTERRUPTED,
    VoiceState.AWAITING_CONFIRMATION,
}

# States that are visible as "the assistant is doing something" in the UI.
BUSY_STATES: Set[VoiceState] = {
    VoiceState.PROCESSING,
    VoiceState.THINKING,
    VoiceState.SPEAKING,
}

SPEECH_STATES: Set[VoiceState] = {
    VoiceState.SPEAKING,
    VoiceState.AWAITING_CONFIRMATION,
}

StateCallback = Callable[[VoiceState, VoiceState, str], Awaitable[None]]


class InvalidVoiceTransition(RuntimeError):
    """Raised when code attempts an illegal voice state transition."""


class VoiceStateMachine:
    """Small, observable state machine shared by every voice client."""

    def __init__(
        self,
        initial: VoiceState = VoiceState.INITIALIZING,
        on_change: Optional[StateCallback] = None,
    ) -> None:
        self._state = initial
        self._on_change = on_change
        self._history: list[tuple[VoiceState, VoiceState, str]] = []

    @property
    def state(self) -> VoiceState:
        return self._state

    @property
    def history(self) -> Iterable[tuple[VoiceState, VoiceState, str]]:
        return tuple(self._history)

    def can_transition(self, target: VoiceState) -> bool:
        if target == self._state:
            return True
        return target in _ALLOWED.get(self._state, set())

    async def transition(self, target: VoiceState, reason: str = "") -> VoiceState:
        if target == self._state:
            return self._state
        if not self.can_transition(target):
            raise InvalidVoiceTransition(
                f"Cannot transition voice state {self._state.value} -> "
                f"{target.value} ({reason or 'no reason'})"
            )
        previous = self._state
        self._state = target
        self._history.append((previous, target, reason))
        logger.debug(
            "VOICE_STATE %s -> %s reason=%s",
            previous.value,
            target.value,
            reason or "-",
        )
        if self._on_change is not None:
            await self._on_change(previous, target, reason)
        return self._state

    async def force(self, target: VoiceState, reason: str = "forced") -> VoiceState:
        """Set a state during error/cleanup paths that must never get stuck."""
        if target == self._state:
            return self._state
        previous = self._state
        self._state = target
        self._history.append((previous, target, reason))
        logger.warning(
            "VOICE_STATE_FORCED %s -> %s reason=%s",
            previous.value,
            target.value,
            reason,
        )
        if self._on_change is not None:
            await self._on_change(previous, target, reason)
        return self._state


def is_microphone_open(state: VoiceState) -> bool:
    return state in MICROPHONE_STATES


def is_busy(state: VoiceState) -> bool:
    return state in BUSY_STATES
