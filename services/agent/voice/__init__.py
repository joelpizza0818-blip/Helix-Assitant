"""HELIX Live Voice subsystem.

A local-only voice interface over the existing agent runtime.  The package
contains the shared state machine, wire protocol, VAD, code-free speech
filter, conversational confirmations, local STT/TTS adapters and the
per-client session manager.
"""

from .adapters import (
    EspeakTTS,
    LocalWhisperSTT,
    PiperTTS,
    Pyttsx3TTS,
    TTSRouter,
    VoiceProviderError,
    WindowsSapiTTS,
)
from .confirmations import (
    ConfirmationOutcome,
    ConversationConfirmationManager,
    PendingConfirmation,
)
from .manager import VoiceSessionManager
from .protocol import VoiceConfig, VoiceProtocolError
from .response_filter import SpeechFilterResult, filter_for_speech
from .session import VoiceSession
from .states import VoiceMode, VoiceState, VoiceStateMachine

__all__ = [
    "ConfirmationOutcome",
    "ConversationConfirmationManager",
    "EspeakTTS",
    "LocalWhisperSTT",
    "PendingConfirmation",
    "PiperTTS",
    "Pyttsx3TTS",
    "SpeechFilterResult",
    "TTSRouter",
    "VoiceConfig",
    "VoiceMode",
    "VoiceProtocolError",
    "VoiceProviderError",
    "VoiceSession",
    "VoiceSessionManager",
    "VoiceState",
    "VoiceStateMachine",
    "WindowsSapiTTS",
    "filter_for_speech",
]
