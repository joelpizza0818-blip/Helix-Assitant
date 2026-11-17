"""Wire protocol shared by desktop, mobile, CLI and the local agent.

Audio never leaves the machine.  Clients stream 16-bit PCM chunks over the
existing authenticated loopback WebSocket; the agent returns complete WAV
segments for playback.  Keeping the protocol explicit makes the same contract
usable from React, Flutter and the terminal.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Message types (client -> agent)
# ---------------------------------------------------------------------------

VOICE_SESSION_START = "VOICE_SESSION_START"
VOICE_SESSION_STOP = "VOICE_SESSION_STOP"
VOICE_AUDIO_CHUNK = "VOICE_AUDIO_CHUNK"
VOICE_RECORDING_START = "VOICE_RECORDING_START"
VOICE_RECORDING_STOP = "VOICE_RECORDING_STOP"
VOICE_INTERRUPT = "VOICE_INTERRUPT"
VOICE_CONFIRMATION = "VOICE_CONFIRMATION"
VOICE_CONFIRMATION_TEXT = "VOICE_CONFIRMATION_TEXT"
VOICE_MUTE = "VOICE_MUTE"
VOICE_UNMUTE = "VOICE_UNMUTE"
VOICE_PLAYBACK_PROGRESS = "VOICE_PLAYBACK_PROGRESS"
VOICE_PLAYBACK_DONE = "VOICE_PLAYBACK_DONE"
VOICE_SERVER_AUDIO_START = "VOICE_SERVER_AUDIO_START"
VOICE_SERVER_AUDIO_STOP = "VOICE_SERVER_AUDIO_STOP"
VOICE_PING = "VOICE_PING"
VOICE_CONFIG = "VOICE_CONFIG"

# ---------------------------------------------------------------------------
# Message types (agent -> client)
# ---------------------------------------------------------------------------

VOICE_SESSION_READY = "VOICE_SESSION_READY"
VOICE_STATE = "VOICE_STATE"
VOICE_TRANSCRIPT = "VOICE_TRANSCRIPT"
VOICE_ASSISTANT_TEXT = "VOICE_ASSISTANT_TEXT"
VOICE_SPEECH_TEXT = "VOICE_SPEECH_TEXT"
VOICE_AUDIO_SEGMENT = "VOICE_AUDIO_SEGMENT"
VOICE_AUDIO_STOP = "VOICE_AUDIO_STOP"
VOICE_SPEAKING_END = "VOICE_SPEAKING_END"
VOICE_CONFIRMATION_REQUEST = "VOICE_CONFIRMATION_REQUEST"
VOICE_CONFIRMATION_RESOLVED = "VOICE_CONFIRMATION_RESOLVED"
VOICE_ERROR = "VOICE_ERROR"
VOICE_LEVEL = "VOICE_LEVEL"
VOICE_SESSION_CLOSED = "VOICE_SESSION_CLOSED"
VOICE_INTERRUPTED = "VOICE_INTERRUPTED"
VOICE_PONG = "VOICE_PONG"

CLIENT_MESSAGE_TYPES = frozenset(
    {
        VOICE_SESSION_START,
        VOICE_SESSION_STOP,
        VOICE_AUDIO_CHUNK,
        VOICE_RECORDING_START,
        VOICE_RECORDING_STOP,
        VOICE_INTERRUPT,
        VOICE_CONFIRMATION,
        VOICE_CONFIRMATION_TEXT,
        VOICE_MUTE,
        VOICE_UNMUTE,
        VOICE_PLAYBACK_PROGRESS,
        VOICE_PLAYBACK_DONE,
        VOICE_SERVER_AUDIO_START,
        VOICE_SERVER_AUDIO_STOP,
        VOICE_PING,
        VOICE_CONFIG,
    }
)

# ---------------------------------------------------------------------------
# Limits and validation
# ---------------------------------------------------------------------------

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_ENCODED_AUDIO_CHARS = 1_400_000  # ~1 MiB decoded
MAX_AUDIO_CHUNK_BYTES = 1_048_576
MIN_SAMPLE_RATE = 8_000
MAX_SAMPLE_RATE = 48_000
ALLOWED_SAMPLE_RATES = {8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000}
MAX_TEXT_LENGTH = 20_000
MAX_CONFIRMATION_INSTRUCTIONS = 2_000


class VoiceProtocolError(ValueError):
    """Raised for malformed or abusive voice messages."""


@dataclass(frozen=True)
class VoiceConfig:
    mode: str = "live"
    language: Optional[str] = None
    voice_id: Optional[str] = None
    opening_greeting: bool = False
    silence_ms: int = 1_000
    max_utterance_ms: int = 30_000
    tts_enabled: bool = True
    server_audio: bool = False
    sample_rate: int = 16_000
    vad_threshold: Optional[float] = None

    def normalized(self) -> "VoiceConfig":
        mode = self.mode.strip().lower()
        if mode not in {"live", "normal"}:
            raise VoiceProtocolError("Voice mode must be 'live' or 'normal'")
        if not isinstance(self.opening_greeting, bool):
            raise VoiceProtocolError("opening_greeting must be a boolean")
        silence_ms = int(self.silence_ms)
        if not 200 <= silence_ms <= 4_000:
            raise VoiceProtocolError("silence_ms must be between 200 and 4000")
        max_utterance_ms = int(self.max_utterance_ms)
        if not 1_000 <= max_utterance_ms <= 120_000:
            raise VoiceProtocolError(
                "max_utterance_ms must be between 1000 and 120000"
            )
        language = self.language.strip() if isinstance(self.language, str) else None
        if language and not re.fullmatch(r"[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})?", language):
            raise VoiceProtocolError("language must be a BCP-47-like tag")
        voice_id = self.voice_id.strip() if isinstance(self.voice_id, str) else None
        if voice_id and len(voice_id) > 256:
            raise VoiceProtocolError("voice_id is too long")
        return VoiceConfig(
            mode=mode,
            language=language or None,
            voice_id=voice_id or None,
            opening_greeting=self.opening_greeting,
            silence_ms=silence_ms,
            max_utterance_ms=max_utterance_ms,
            tts_enabled=bool(self.tts_enabled),
            server_audio=bool(self.server_audio),
            sample_rate=self.sample_rate,
            vad_threshold=self.vad_threshold,
        )


def validate_session_id(value: Any) -> str:
    if not isinstance(value, str) or not SESSION_ID_RE.fullmatch(value):
        raise VoiceProtocolError(
            "session_id must be 8-64 characters of letters, digits, '_' or '-'"
        )
    return value


def parse_session_start(payload: Dict[str, Any]) -> VoiceConfig:
    if not isinstance(payload, dict):
        raise VoiceProtocolError("Voice payload must be an object")
    mode = payload.get("mode", "live")
    language = payload.get("language")
    voice_id = payload.get("voice_id")
    return VoiceConfig(
        mode=mode if isinstance(mode, str) else "live",
        language=language if isinstance(language, str) else None,
        voice_id=voice_id if isinstance(voice_id, str) else None,
        opening_greeting=payload.get("opening_greeting", False),
        silence_ms=payload.get("silence_ms", 1_000),
        max_utterance_ms=payload.get("max_utterance_ms", 30_000),
        tts_enabled=payload.get("tts_enabled", True),
        server_audio=payload.get("server_audio", False),
        sample_rate=payload.get("sample_rate", 16_000),
        vad_threshold=(
            float(payload["vad_threshold"])
            if isinstance(payload.get("vad_threshold"), (int, float))
            else None
        ),
    ).normalized()


def decode_audio_chunk(payload: Dict[str, Any]) -> tuple[bytes, int]:
    """Decode one base64 PCM16 mono chunk.

    Returns ``(pcm_bytes, sample_rate)``.  Only validated base64 and framing
    reach the VAD.  The sample rate is reported so the session can resample to
    its internal 16 kHz rate.
    """
    if not isinstance(payload, dict):
        raise VoiceProtocolError("VOICE_AUDIO_CHUNK payload must be an object")
    encoded = payload.get("audio_base64")
    if not isinstance(encoded, str) or not encoded:
        raise VoiceProtocolError("audio_base64 is required")
    if len(encoded) > MAX_ENCODED_AUDIO_CHARS:
        raise VoiceProtocolError("audio chunk is too large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError, TypeError):
        raise VoiceProtocolError("audio_base64 is not valid base64") from None
    if len(raw) > MAX_AUDIO_CHUNK_BYTES:
        raise VoiceProtocolError("audio chunk is too large")
    if not raw:
        raise VoiceProtocolError("audio chunk is empty")
    if len(raw) % 2:
        raise VoiceProtocolError("PCM16 audio must contain an even number of bytes")
    sample_rate = payload.get("sample_rate", 16_000)
    if not isinstance(sample_rate, int) or sample_rate not in ALLOWED_SAMPLE_RATES:
        raise VoiceProtocolError(
            f"sample_rate must be one of {sorted(ALLOWED_SAMPLE_RATES)}"
        )
    channels = payload.get("channels", 1)
    if channels != 1:
        raise VoiceProtocolError("Only mono microphone audio is accepted")
    return raw, sample_rate


def parse_confirmation_decision(payload: Dict[str, Any]) -> tuple[str, str]:
    """Validate an explicit UI confirmation decision.

    Returns ``(decision, instructions)``.  Silence is never represented here:
    a decision must be explicitly approve/reject/modify.
    """
    if not isinstance(payload, dict):
        raise VoiceProtocolError("Confirmation payload must be an object")
    decision = str(payload.get("decision", "")).strip().lower()
    if decision not in {"approve", "reject", "modify"}:
        raise VoiceProtocolError("decision must be approve, reject or modify")
    instructions = payload.get("instructions", "")
    if instructions is None:
        instructions = ""
    if not isinstance(instructions, str):
        raise VoiceProtocolError("instructions must be text")
    instructions = instructions.strip()
    if len(instructions) > MAX_CONFIRMATION_INSTRUCTIONS:
        raise VoiceProtocolError("Confirmation instructions are too long")
    if decision == "modify" and not instructions:
        raise VoiceProtocolError("A modification needs instructions")
    return decision, instructions


def text_value(payload: Dict[str, Any], key: str, *, required: bool = False) -> str:
    value = payload.get(key)
    if value is None:
        if required:
            raise VoiceProtocolError(f"{key} is required")
        return ""
    if not isinstance(value, str):
        raise VoiceProtocolError(f"{key} must be text")
    if len(value) > MAX_TEXT_LENGTH:
        raise VoiceProtocolError(f"{key} is too long")
    return value.strip()


def server_event(event_type: str, session_id: str, **payload: Any) -> Dict[str, Any]:
    """Build a server -> client voice event envelope."""
    return {
        "type": event_type,
        "payload": {
            "session_id": session_id,
            **payload,
        },
    }
