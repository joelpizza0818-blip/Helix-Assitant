"""Voice session manager: one lightweight session per client tab/device."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional

from .adapters import (
    LocalWhisperSTT,
    SpeechToTextProvider,
    TTSRouter,
    TextToSpeechProvider,
    VoiceProviderError,
)
from .confirmations import ConversationConfirmationManager
from .protocol import (
    CLIENT_MESSAGE_TYPES,
    VOICE_ERROR,
    VOICE_SESSION_START,
    VOICE_SESSION_STOP,
    VoiceProtocolError,
    parse_session_start,
    server_event,
    validate_session_id,
)
from .session import VoiceSession
from .states import VoiceState

logger = logging.getLogger(__name__)

SendCallback = Callable[[dict], Awaitable[None]]


class VoiceSessionManager:
    """Owns sessions and routes agent events back to the right conversation."""

    def __init__(
        self,
        event_bus,
        confirmation_manager: ConversationConfirmationManager,
        *,
        stt_factory: Optional[Callable[[], SpeechToTextProvider]] = None,
        tts_factory: Optional[Callable[[Optional[str]], Optional[TextToSpeechProvider]]] = None,
        settings_provider: Optional[Callable[[], dict]] = None,
        server_audio_factory=None,
    ) -> None:
        self.event_bus = event_bus
        self.confirmation_manager = confirmation_manager
        self.stt_factory = stt_factory
        self.tts_factory = tts_factory
        self.settings_provider = settings_provider or (lambda: {})
        self.server_audio_factory = server_audio_factory
        self._sessions: dict[str, VoiceSession] = {}
        self._by_conversation: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._started = False
        self._stt: Optional[SpeechToTextProvider] = None
        self._stt_by_model: dict[str, SpeechToTextProvider] = {}
        self._tts: Optional[TextToSpeechProvider] = None
        self._provider_lock = asyncio.Lock()
        self._warmup_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._started:
            return
        subscribe = getattr(self.event_bus, "subscribe", None)
        if subscribe is not None:
            await subscribe("ORCHESTRATION_COMPLETED", self._on_orchestration_completed)
            await subscribe("ORCHESTRATION_FAILED", self._on_orchestration_failed)
            await subscribe("ORCHESTRATION_CANCELLED", self._on_orchestration_cancelled)
            await subscribe(
                "ORCHESTRATION_TEXT_DELTA",
                self._on_orchestration_text_delta,
            )
            await subscribe(
                "CONVERSATION_CONFIRMATION_PENDING",
                self._on_confirmation_pending,
            )
            await subscribe(
                "CONVERSATION_CONFIRMATION_RESOLVED",
                self._on_confirmation_resolved,
            )
        self._started = True
        logger.info("Voice session manager started")

    def start_warmup(self) -> None:
        """Load the local STT model before the first Live Voice turn.

        The model load is the largest one-time cost.  Starting it with the
        agent removes that delay from the first spoken turn without blocking
        agent startup.
        """
        if self._warmup_task is not None and not self._warmup_task.done():
            return
        self._warmup_task = asyncio.create_task(
            self.warmup(), name="voice-provider-warmup"
        )

    async def warmup(self) -> None:
        try:
            stt, _tts = await self._get_providers(None)
            warm = getattr(stt, "warmup", None)
            if warm is not None:
                await warm()
            logger.info("Voice providers warmed up")
        except Exception:
            logger.debug("Voice provider warmup failed", exc_info=True)

    async def shutdown(self) -> None:
        warmup = self._warmup_task
        self._warmup_task = None
        if warmup is not None and not warmup.done():
            warmup.cancel()
            try:
                await warmup
            except asyncio.CancelledError:
                pass
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self._by_conversation.clear()
        for session in sessions:
            try:
                await session.close(reason="agent_shutdown")
            except Exception:
                logger.debug("Voice session close failed", exc_info=True)
        unsubscribe = getattr(self.event_bus, "unsubscribe", None)
        if unsubscribe is not None:
            for event_name, handler in (
                ("ORCHESTRATION_COMPLETED", self._on_orchestration_completed),
                ("ORCHESTRATION_FAILED", self._on_orchestration_failed),
                ("ORCHESTRATION_CANCELLED", self._on_orchestration_cancelled),
                ("ORCHESTRATION_TEXT_DELTA", self._on_orchestration_text_delta),
                ("CONVERSATION_CONFIRMATION_PENDING", self._on_confirmation_pending),
                ("CONVERSATION_CONFIRMATION_RESOLVED", self._on_confirmation_resolved),
            ):
                try:
                    await unsubscribe(event_name, handler)
                except Exception:
                    pass
        self._started = False
        logger.info("Voice session manager stopped")

    async def close_sessions_for_sender(self, send: SendCallback) -> int:
        async with self._lock:
            matches = [
                session
                for session in self._sessions.values()
                if session.send is send
            ]
        for session in matches:
            await self.close_session(session.session_id, reason="client_disconnected")
        return len(matches)

    # ------------------------------------------------------------------
    # Message intake
    # ------------------------------------------------------------------

    async def handle_message(
        self, message_type: str, payload: dict[str, Any], send: SendCallback
    ) -> None:
        if message_type not in CLIENT_MESSAGE_TYPES:
            await self._send_error(
                send, "UNKNOWN_VOICE_MESSAGE", f"Unsupported voice message: {message_type}"
            )
            return
        payload = payload if isinstance(payload, dict) else {}
        try:
            if message_type == VOICE_SESSION_START:
                await self._create_session(payload, send)
                return
            session_id = validate_session_id(payload.get("session_id"))
            session = self._sessions.get(session_id)
            if session is None:
                await self._send_error(
                    send,
                    "VOICE_SESSION_NOT_FOUND",
                    "The voice session is no longer active. Start a new session.",
                    session_id=session_id,
                )
                return
            if session.send is not send:
                await self._send_error(
                    send,
                    "VOICE_SESSION_OWNER_MISMATCH",
                    "This voice session belongs to another connection.",
                    session_id=session_id,
                )
                return
            if message_type == VOICE_SESSION_STOP:
                await self.close_session(session_id, reason="client_stop")
                return
            await session.handle_message(message_type, payload)
        except VoiceProtocolError as error:
            await self._send_error(
                send, "INVALID_VOICE_MESSAGE", str(error), recoverable=True
            )
        except Exception as error:
            logger.exception("Voice manager message failed: %s", message_type)
            await self._send_error(
                send,
                "VOICE_MANAGER_ERROR",
                f"The voice request failed ({type(error).__name__}).",
                recoverable=True,
            )

    async def _create_session(self, payload: dict, send: SendCallback) -> None:
        session_id = validate_session_id(payload.get("session_id"))
        config = parse_session_start(payload)
        stt, tts = await self._get_providers(config.voice_id)
        if stt is not None and getattr(stt, "available", True) is False:
            warmup = getattr(stt, "warmup", None)
            if callable(warmup):
                await warmup()
        if stt is not None and getattr(stt, "available", True) is False:
            await self._send_error(
                send,
                "STT_UNAVAILABLE",
                "Local speech recognition is unavailable. Install faster-whisper "
                "or check the cached Whisper model.",
                session_id=session_id,
            )
            return
        session = VoiceSession(
            session_id=session_id,
            event_bus=self.event_bus,
            send=send,
            stt=stt,
            tts=tts,
            confirmation_manager=self.confirmation_manager,
            config=config,
            server_audio_factory=self.server_audio_factory,
        )
        async with self._lock:
            existing = self._sessions.pop(session_id, None)
            if existing is not None:
                self._by_conversation.pop(existing.conversation_id, None)
            self._sessions[session_id] = session
            self._by_conversation[session.conversation_id] = session_id
        if existing is not None:
            await existing.close(reason="session_replaced")
        try:
            await session.start()
        except Exception as error:
            logger.exception("Voice session failed to start")
            async with self._lock:
                self._sessions.pop(session_id, None)
                self._by_conversation.pop(session.conversation_id, None)
            await session.close(reason="start_failed")
            await self._send_error(
                send,
                "VOICE_START_FAILED",
                f"The voice session could not start ({type(error).__name__}).",
                session_id=session_id,
            )
            return
        logger.info(
            "VOICE_SESSION_STARTED session=%s mode=%s conversation=%s",
            session_id,
            config.mode,
            session.conversation_id,
        )

    async def close_session(self, session_id: str, *, reason: str = "closed") -> None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                self._by_conversation.pop(session.conversation_id, None)
        if session is not None:
            await session.close(reason=reason)
            logger.info("VOICE_SESSION_STOPPED session=%s reason=%s", session_id, reason)

    # ------------------------------------------------------------------
    # Providers
    # ------------------------------------------------------------------

    async def _get_providers(
        self, voice_id: Optional[str]
    ) -> tuple[SpeechToTextProvider, Optional[TextToSpeechProvider]]:
        async with self._provider_lock:
            if self.stt_factory is not None:
                if self._stt is None:
                    self._stt = self.stt_factory()
            else:
                settings = self._settings()
                profile = settings.get("voice_stt_mode", "accuracy")
                if not isinstance(profile, str) or profile not in {
                    "speed",
                    "accuracy",
                }:
                    logger.warning(
                        "Invalid voice_stt_mode=%r; using accuracy profile",
                        profile,
                    )
                    profile = "accuracy"
                model = "tiny" if profile == "speed" else "base"
                if model not in self._stt_by_model:
                    self._stt_by_model[model] = LocalWhisperSTT(model=model)
                self._stt = self._stt_by_model[model]
            if self._tts is None:
                if self.tts_factory is not None:
                    self._tts = self.tts_factory(voice_id)
                else:
                    settings = self._settings()
                    # Live voice is strictly local: never fall back to Edge or
                    # any network TTS, even if a legacy configured voice asks
                    # for it. Local engines ignore an Edge-style voice id.
                    local_voice = settings.get("voice_live_voice_id") or voice_id
                    self._tts = TTSRouter(voice_id=local_voice, allow_edge=False)
        return self._stt, self._tts

    def _settings(self) -> dict:
        try:
            value = self.settings_provider()
            return value if isinstance(value, dict) else {}
        except Exception:
            logger.debug("Could not read voice settings", exc_info=True)
            return {}

    # ------------------------------------------------------------------
    # Event routing
    # ------------------------------------------------------------------

    def _session_for(self, payload: dict) -> Optional[VoiceSession]:
        conversation_id = payload.get("conversation_id")
        if not isinstance(conversation_id, str):
            return None
        session_id = self._by_conversation.get(conversation_id)
        if session_id is None:
            return None
        return self._sessions.get(session_id)

    async def _on_orchestration_completed(self, _event_name: str, payload: dict) -> None:
        session = self._session_for(payload)
        if session is not None:
            await session.on_orchestration_completed(payload)

    async def _on_orchestration_text_delta(
        self, _event_name: str, payload: dict
    ) -> None:
        session = self._session_for(payload)
        if session is not None:
            await session.on_orchestration_text_delta(payload)

    async def _on_orchestration_failed(self, _event_name: str, payload: dict) -> None:
        session = self._session_for(payload)
        if session is not None:
            await session.on_orchestration_failed(payload)

    async def _on_orchestration_cancelled(self, _event_name: str, payload: dict) -> None:
        session = self._session_for(payload)
        if session is not None and not session.is_closed:
            await session.on_orchestration_failed(
                {**payload, "error": "ORCHESTRATION_CANCELLED"}
            )

    async def _on_confirmation_pending(self, _event_name: str, payload: dict) -> None:
        session = self._session_for(payload)
        if session is not None:
            await session.on_confirmation_pending(payload)

    async def _on_confirmation_resolved(self, _event_name: str, payload: dict) -> None:
        conversation_id = payload.get("conversation_id")
        if not isinstance(conversation_id, str):
            # The conversation manager includes it for voice confirmations;
            # fall back to the single session that owns the request.
            session = next(
                (
                    candidate
                    for candidate in self._sessions.values()
                    if candidate._pending_confirmation_id == payload.get("request_id")
                ),
                None,
            )
        else:
            session = self._session_for(payload)
        if session is not None:
            await session.on_confirmation_resolved(payload)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        sessions = [session.status() for session in self._sessions.values()]
        return {
            "active_sessions": len(sessions),
            "sessions": sessions,
            "stt": getattr(self._stt, "name", "not_loaded") if self._stt else "not_loaded",
            "tts": getattr(self._tts, "name", "not_loaded") if self._tts else "not_loaded",
            "local_only": True,
        }

    async def _send_error(
        self,
        send: SendCallback,
        code: str,
        message: str,
        *,
        session_id: Optional[str] = None,
        recoverable: bool = True,
    ) -> None:
        try:
            await send(
                server_event(
                    VOICE_ERROR,
                    session_id or "unbound",
                    code=code,
                    message=message,
                    recoverable=recoverable,
                )
            )
        except Exception:
            logger.debug("Could not send voice manager error", exc_info=True)
