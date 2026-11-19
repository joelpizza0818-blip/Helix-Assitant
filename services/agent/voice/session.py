"""One live voice conversation, backed by the existing HELIX agent runtime."""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from .adapters import (
    SpeechToTextProvider,
    TTSRouter,
    TextToSpeechProvider,
    VoiceProviderError,
    local_provider_summary,
)
from .audio import (
    AudioLevelMeter,
    ServerAudio,
    ServerAudioError,
    StreamingVAD,
    Utterance,
    pcm16_duration_ms,
    resample_pcm16,
    wav_to_pcm16,
    VOICE_SAMPLE_RATE,
)
from .confirmations import ConfirmationOutcome, ConversationConfirmationManager
from .protocol import (
    VOICE_ASSISTANT_TEXT,
    VOICE_AUDIO_SEGMENT,
    VOICE_AUDIO_STOP,
    VOICE_CONFIRMATION_REQUEST,
    VOICE_CONFIRMATION_RESOLVED,
    VOICE_ERROR,
    VOICE_INTERRUPTED,
    VOICE_LEVEL,
    VOICE_PONG,
    VOICE_SESSION_CLOSED,
    VOICE_SESSION_READY,
    VOICE_SPEAKING_END,
    VOICE_SPEECH_TEXT,
    VOICE_STATE,
    VOICE_TRANSCRIPT,
    VOICE_CONFIG,
    VOICE_AUDIO_CHUNK,
    VOICE_CONFIRMATION,
    VOICE_CONFIRMATION_TEXT,
    VOICE_INTERRUPT,
    VOICE_MUTE,
    VOICE_PLAYBACK_DONE,
    VOICE_PLAYBACK_PROGRESS,
    VOICE_PING,
    VOICE_RECORDING_START,
    VOICE_RECORDING_STOP,
    VOICE_SERVER_AUDIO_START,
    VOICE_SERVER_AUDIO_STOP,
    VOICE_SESSION_START,
    VOICE_SESSION_STOP,
    VOICE_UNMUTE,
    VoiceConfig,
    VoiceProtocolError,
    decode_audio_chunk,
    parse_confirmation_decision,
    server_event,
    text_value,
)
from .response_filter import IncrementalSpeechFilter, filter_for_speech
from .states import (
    InvalidVoiceTransition,
    VoiceMode,
    VoiceState,
    VoiceStateMachine,
)

logger = logging.getLogger(__name__)

SendCallback = Callable[[dict], Awaitable[None]]

MAX_HISTORY_MESSAGES = 40
MAX_LIVE_QUEUE = 3
MAX_NORMAL_RECORDING_BYTES = VOICE_SAMPLE_RATE * 2 * 120  # 120 seconds
MAX_SPEECH_SEGMENT_CHARS = 260
LIVE_CONTINUATION_GRACE_MS = 1_000


def split_speech_segments(text: str, max_chars: int = MAX_SPEECH_SEGMENT_CHARS) -> list[str]:
    """Split speakable prose at natural boundaries for low-latency playback."""
    if not text:
        return []
    normalized = " ".join(text.replace("\r", " ").replace("\n", " ").split())
    if not normalized:
        return []
    raw_segments = [
        segment.strip()
        for segment in re.split(r"(?<=[.!?…])\s+|(?<=[;:])\s+", normalized)
        if segment.strip()
    ]
    if not raw_segments:
        raw_segments = [normalized]
    segments: list[str] = []
    buffer = ""
    for segment in raw_segments:
        if len(segment) > max_chars:
            if buffer:
                segments.append(buffer.strip())
                buffer = ""
            words = segment.split()
            current = ""
            for word in words:
                candidate = f"{current} {word}".strip()
                if len(candidate) > max_chars and current:
                    segments.append(current)
                    current = word
                else:
                    current = candidate
            if current:
                segments.append(current)
            continue
        candidate = f"{buffer} {segment}".strip()
        if len(candidate) > max_chars and buffer:
            segments.append(buffer.strip())
            buffer = segment
        else:
            buffer = candidate
    if buffer:
        segments.append(buffer.strip())
    return [segment for segment in segments if segment]


@dataclass
class SpeechSegment:
    index: int
    text: str
    duration_ms: float = 0.0
    sent: bool = False
    completed: bool = False


class VoiceSession:
    """Live/normal voice interface over the same agent, tools and memory."""

    def __init__(
        self,
        *,
        session_id: str,
        event_bus,
        send: SendCallback,
        stt: SpeechToTextProvider,
        tts: Optional[TextToSpeechProvider],
        confirmation_manager: ConversationConfirmationManager,
        config: VoiceConfig,
        server_audio_factory: Optional[Callable[[Callable[[bytes], None]], ServerAudio]] = None,
    ) -> None:
        self.session_id = session_id
        self.conversation_id = f"voice_{session_id}"
        self.event_bus = event_bus
        self.send = send
        self.stt = stt
        self.tts = tts
        self.confirmation_manager = confirmation_manager
        self.config = config
        self.mode = VoiceMode(config.mode)
        self.server_audio_factory = server_audio_factory or ServerAudio

        self.state_machine = VoiceStateMachine(
            VoiceState.INITIALIZING, on_change=self._on_state_change
        )
        self.history: list[dict[str, str]] = []
        self._vad = StreamingVAD(
            sample_rate=VOICE_SAMPLE_RATE,
            silence_ms=(
                config.silence_ms + LIVE_CONTINUATION_GRACE_MS
                if self.mode is VoiceMode.LIVE
                else config.silence_ms
            ),
            max_utterance_ms=config.max_utterance_ms,
            vad_threshold=config.vad_threshold,
        )
        self._normal_pcm = bytearray()
        self._level_meter = AudioLevelMeter()
        self._last_level_sent = 0.0
        self._utterance_queue: asyncio.Queue[Utterance] = asyncio.Queue(maxsize=MAX_LIVE_QUEUE)
        self._worker_task: Optional[asyncio.Task] = None
        self._processing_task: Optional[asyncio.Task] = None
        self._speech_task: Optional[asyncio.Task] = None
        self._stream_speech_queue: Optional[asyncio.Queue[Optional[str]]] = None
        self._stream_filter: Optional[IncrementalSpeechFilter] = None
        self._stream_task_id: Optional[str] = None
        self._streaming_audio_started = False
        self._server_consumer_task: Optional[asyncio.Task] = None
        self._server_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=128)
        self._server_audio: Optional[ServerAudio] = None
        self._closed = False
        self._muted = False
        self._awaiting_agent_response = False
        self._interrupt_requested = False
        self._discard_current_utterance = False
        self._pending_interruption_texts: list[str] = []
        self._pending_modification: Optional[str] = None
        self._pending_confirmation_id: Optional[str] = None
        self._last_user_text = ""
        self._response_watchdog: Optional[asyncio.Task] = None
        self._speech_segments: list[SpeechSegment] = []
        self._speech_active = False
        self._speech_finalized = True
        self._speech_preserve_state: Optional[VoiceState] = None
        self._playback_done_event = asyncio.Event()
        self._speech_interrupted = False
        self._last_playback_index = -1
        self._server_audio_active = False
        self._started_at = time.monotonic()
        self._agent_request_started_at: Optional[float] = None
        self._first_audio_logged = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def state(self) -> VoiceState:
        return self.state_machine.state

    @property
    def is_closed(self) -> bool:
        return self._closed or self.state is VoiceState.CLOSED

    async def start(self) -> None:
        if self.state is not VoiceState.INITIALIZING:
            return
        summary = local_provider_summary(self.stt, self.tts)
        await self._safe_send(
            server_event(
                VOICE_SESSION_READY,
                self.session_id,
                conversation_id=self.conversation_id,
                mode=self.mode.value,
                sample_rate=VOICE_SAMPLE_RATE,
                stt=summary.stt,
                tts=summary.tts,
                local_only=True,
                confirmation_ttl_seconds=self.confirmation_manager.ttl_seconds,
                policy={
                    "code_to_speech": False,
                    "permanent_audio_recording": False,
                    "cloud_audio": False,
                },
            )
        )
        target = VoiceState.LISTENING if self.mode is VoiceMode.LIVE else VoiceState.IDLE
        await self._transition(target, "session_started")
        self._worker_task = asyncio.create_task(
            self._utterance_worker(), name=f"voice-utterance-{self.session_id}"
        )
        asyncio.create_task(self._warmup(), name=f"voice-warmup-{self.session_id}")
        if self.config.server_audio:
            await self._start_server_audio()
        if self.mode is VoiceMode.LIVE and self.config.opening_greeting:
            await self._submit_user_text(
                "Inicia esta llamada de voz con un saludo breve y natural en el "
                "idioma del usuario. Invítalo a comenzar, sin sonar como una "
                "frase prefabricada y sin iniciar ninguna tarea.",
                voice_greeting=True,
            )

    async def _warmup(self) -> None:
        try:
            await self.stt.warmup()
        except Exception:
            logger.debug("STT warmup failed", exc_info=True)

    async def close(self, reason: str = "client_closed") -> None:
        if self._closed:
            return
        self._closed = True
        try:
            await self._transition(VoiceState.STOPPING, reason)
        except InvalidVoiceTransition:
            await self.state_machine.force(VoiceState.STOPPING, reason)
        self._cancel_task(self._processing_task)
        self._cancel_task(self._speech_task)
        self._cancel_task(self._response_watchdog)
        self._cancel_task(self._worker_task)
        self._cancel_task(self._server_consumer_task)
        self._stop_server_audio()
        self._vad.reset()
        self._normal_pcm = bytearray()
        self._speech_segments.clear()
        self.history.clear()
        self._awaiting_agent_response = False
        self._pending_interruption_texts.clear()
        await self._safe_send(
            server_event(
                VOICE_SESSION_CLOSED,
                self.session_id,
                reason=reason,
                conversation_id=self.conversation_id,
            )
        )
        await self.state_machine.force(VoiceState.CLOSED, reason)
        logger.info("VOICE_SESSION_CLOSED session=%s reason=%s", self.session_id, reason)

    # ------------------------------------------------------------------
    # Client messages
    # ------------------------------------------------------------------

    async def handle_message(self, message_type: str, payload: dict[str, Any]) -> None:
        if self._closed:
            return
        try:
            if message_type == VOICE_AUDIO_CHUNK:
                pcm, sample_rate = decode_audio_chunk(payload)
                await self.ingest_audio(pcm, sample_rate=sample_rate)
            elif message_type == VOICE_RECORDING_START:
                await self._start_normal_recording()
            elif message_type == VOICE_RECORDING_STOP:
                await self._stop_normal_recording()
            elif message_type == VOICE_INTERRUPT:
                await self.interrupt(reason="user_speech")
            elif message_type == VOICE_CONFIRMATION:
                await self._handle_confirmation_click(payload)
            elif message_type == VOICE_CONFIRMATION_TEXT:
                await self._handle_confirmation_text(payload)
            elif message_type == VOICE_MUTE:
                await self.mute()
            elif message_type == VOICE_UNMUTE:
                await self.unmute()
            elif message_type == VOICE_PLAYBACK_PROGRESS:
                self._handle_playback_progress(payload)
            elif message_type == VOICE_PLAYBACK_DONE:
                self._handle_playback_done(payload)
            elif message_type == VOICE_SERVER_AUDIO_START:
                await self._start_server_audio()
            elif message_type == VOICE_SERVER_AUDIO_STOP:
                self._stop_server_audio()
            elif message_type == VOICE_PING:
                await self._safe_send(
                    server_event(VOICE_PONG, self.session_id, state=self.state.value)
                )
            elif message_type == VOICE_CONFIG:
                await self._apply_config(payload)
            elif message_type in {VOICE_SESSION_START, VOICE_SESSION_STOP}:
                # The manager owns creation and destruction.
                return
            else:
                raise VoiceProtocolError(f"Unsupported voice message: {message_type}")
        except VoiceProtocolError as error:
            await self._send_error("INVALID_VOICE_MESSAGE", str(error), recoverable=True)
        except Exception as error:
            logger.exception("Voice session message failed: %s", message_type)
            await self._send_error(
                "VOICE_MESSAGE_FAILED", f"The voice request failed ({type(error).__name__}).", recoverable=True
            )

    async def _apply_config(self, payload: dict) -> None:
        # Only non-destructive runtime options are mutable mid-session.
        new_voice = payload.get("voice_id")
        if isinstance(new_voice, str) and new_voice.strip():
            self.config = VoiceConfig(
                mode=self.config.mode,
                language=self.config.language,
                voice_id=new_voice.strip(),
                opening_greeting=self.config.opening_greeting,
                silence_ms=self.config.silence_ms,
                max_utterance_ms=self.config.max_utterance_ms,
                tts_enabled=self.config.tts_enabled,
                server_audio=self.config.server_audio,
                sample_rate=self.config.sample_rate,
                vad_threshold=self.config.vad_threshold,
            )
            if isinstance(self.tts, TTSRouter):
                self.tts.voice_id = new_voice.strip()
        await self._emit_state(self.state, "config_updated")

    # ------------------------------------------------------------------
    # Audio intake
    # ------------------------------------------------------------------

    async def ingest_audio(self, pcm: bytes, sample_rate: int = VOICE_SAMPLE_RATE) -> None:
        if self._closed or self._muted or not pcm:
            return
        if sample_rate != VOICE_SAMPLE_RATE:
            pcm = resample_pcm16(pcm, sample_rate)
        if not pcm:
            return
        level = self._level_meter.update(pcm)
        now = time.monotonic()
        if now - self._last_level_sent >= 0.06:
            self._last_level_sent = now
            await self._safe_send(
                server_event(
                    VOICE_LEVEL,
                    self.session_id,
                    level=level,
                    state=self.state.value,
                )
            )

        if self.mode is VoiceMode.NORMAL:
            if self.state is not VoiceState.LISTENING:
                return
            if len(self._normal_pcm) + len(pcm) > MAX_NORMAL_RECORDING_BYTES:
                await self._send_error(
                    "RECORDING_TOO_LONG",
                    "The recording reached the two-minute limit.",
                    recoverable=True,
                )
                self._normal_pcm.clear()
                return
            self._normal_pcm.extend(pcm)
            return

        if self.state not in {
            VoiceState.LISTENING,
            VoiceState.INTERRUPTED,
            VoiceState.AWAITING_CONFIRMATION,
        }:
            return
        if self._awaiting_agent_response and self.state not in {
            VoiceState.AWAITING_CONFIRMATION,
            VoiceState.INTERRUPTED,
        }:
            return
        for utterance in self._vad.feed(pcm):
            self._enqueue_utterance(utterance)

    def _enqueue_utterance(self, utterance: Utterance) -> None:
        if not utterance.pcm or utterance.duration_ms < 200:
            return
        if self._utterance_queue.full():
            try:
                self._utterance_queue.get_nowait()
                self._utterance_queue.task_done()
            except asyncio.QueueEmpty:
                pass
        try:
            self._utterance_queue.put_nowait(utterance)
        except asyncio.QueueFull:
            logger.warning("Voice utterance queue is full; dropping audio")

    async def _utterance_worker(self) -> None:
        try:
            while not self._closed:
                utterance = await self._utterance_queue.get()
                try:
                    await self._process_utterance(utterance)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("Voice utterance processing failed")
                    await self._send_error(
                        "VOICE_TURN_FAILED",
                        "I couldn't process that turn. Please try again.",
                        recoverable=True,
                    )
                    await self._recover_to_listening()
                finally:
                    self._utterance_queue.task_done()
        except asyncio.CancelledError:
            return

    async def _start_normal_recording(self) -> None:
        if self.mode is not VoiceMode.NORMAL:
            return
        if self.state not in {VoiceState.IDLE, VoiceState.LISTENING}:
            return
        self._normal_pcm.clear()
        self._interrupt_requested = False
        self._discard_current_utterance = False
        await self._transition(VoiceState.LISTENING, "recording_started")

    async def _stop_normal_recording(self) -> None:
        if self.mode is not VoiceMode.NORMAL:
            return
        pcm = bytes(self._normal_pcm)
        self._normal_pcm.clear()
        if len(pcm) < 3200:  # 100 ms at 16 kHz mono
            await self._safe_send(
                server_event(VOICE_TRANSCRIPT, self.session_id, text="", final=True, empty=True)
            )
            await self._transition(VoiceState.IDLE, "recording_empty")
            return
        duration = pcm16_duration_ms(pcm)
        self._enqueue_utterance(
            Utterance(pcm=pcm, duration_ms=duration, reason="recording_stop", speech_ratio=1.0)
        )

    # ------------------------------------------------------------------
    # Transcription and agent handoff
    # ------------------------------------------------------------------

    async def _process_utterance(self, utterance: Utterance) -> None:
        if self._closed:
            return
        if self.state in {VoiceState.THINKING, VoiceState.SPEAKING}:
            # A new turn cannot start while the agent is working.  The client
            # must send an explicit interrupt first.
            return
        self._discard_current_utterance = False
        stt_started = time.monotonic()
        await self._transition(VoiceState.PROCESSING, "transcribing")
        await self._safe_send(
            server_event(
                VOICE_TRANSCRIPT,
                self.session_id,
                text="",
                final=False,
                duration_ms=utterance.duration_ms,
            )
        )
        try:
            transcript = await self.stt.transcribe_pcm16(
                utterance.pcm,
                sample_rate=VOICE_SAMPLE_RATE,
                language=self.config.language,
            )
        except VoiceProviderError as error:
            await self._send_error("STT_FAILED", str(error), recoverable=True)
            await self._recover_after_turn()
            return
        except Exception:
            logger.exception("Speech recognition failed")
            await self._send_error(
                "STT_FAILED", "Local speech recognition failed.", recoverable=True
            )
            await self._recover_after_turn()
            return

        if self._discard_current_utterance or self._closed:
            return
        transcript = (transcript or "").strip()
        logger.info(
            "VOICE_LATENCY stage=stt session=%s audio_ms=%.1f stt_ms=%.1f chars=%d",
            self.session_id,
            utterance.duration_ms,
            (time.monotonic() - stt_started) * 1000.0,
            len(transcript),
        )
        await self._safe_send(
            server_event(
                VOICE_TRANSCRIPT,
                self.session_id,
                text=transcript,
                final=True,
                duration_ms=utterance.duration_ms,
                reason=utterance.reason,
            )
        )
        if not transcript:
            await self._recover_after_turn()
            return

        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        if pending:
            outcome = await self.confirmation_manager.try_resolve_text(
                transcript, conversation_id=self.conversation_id, source="voice"
            )
            await self._handle_confirmation_outcome(outcome, pending_count=len(pending))
            return

        if self._awaiting_agent_response and self._interrupt_requested:
            self._pending_interruption_texts.append(transcript)
            return

        await self._submit_user_text(transcript)

    async def _submit_user_text(
        self, text: str, *, voice_greeting: bool = False
    ) -> None:
        text = text.strip()
        if not text:
            return
        self._last_user_text = text
        if not voice_greeting:
            self._append_history("user", text)
        self._agent_request_started_at = time.monotonic()
        self._mark_awaiting_agent()
        await self._transition(VoiceState.THINKING, "agent_request")
        try:
            await self.event_bus.publish(
                "USER_TEXT",
                {
                    "text": text,
                    "input_source": "voice",
                    "conversation_id": self.conversation_id,
                    "conversation_history": list(self.history),
                    "voice_greeting": voice_greeting,
                },
            )
        except Exception as error:
            logger.exception("Could not submit voice text to the agent")
            self._awaiting_agent_response = False
            await self._send_error(
                "AGENT_UNAVAILABLE",
                f"The agent did not accept the request ({type(error).__name__}).",
                recoverable=True,
            )
            await self._recover_after_turn()

    def _mark_awaiting_agent(self) -> None:
        """The agent is (or will resume) working on this conversation."""
        self._awaiting_agent_response = True
        self._interrupt_requested = False
        self._cancel_task(self._response_watchdog)
        self._response_watchdog = asyncio.create_task(
            self._response_timeout(), name=f"voice-response-timeout-{self.session_id}"
        )

    async def _response_timeout(self) -> None:
        try:
            await asyncio.sleep(120)
        except asyncio.CancelledError:
            return
        if not self._awaiting_agent_response or self._closed:
            return
        if await self.confirmation_manager.get_pending(self.conversation_id):
            return
        logger.warning("Voice agent response timed out session=%s", self.session_id)
        self._awaiting_agent_response = False
        await self._abort_streamed_response()
        self._interrupt_requested = False
        self._pending_interruption_texts.clear()
        await self._send_error(
            "AGENT_TIMEOUT",
            "The agent is taking too long. You can try again or cancel the task.",
            recoverable=True,
        )
        await self._recover_after_turn()

    # ------------------------------------------------------------------
    # Agent / confirmation events (called by VoiceSessionManager)
    # ------------------------------------------------------------------

    async def on_orchestration_text_delta(self, payload: dict) -> None:
        if (
            self._closed
            or not self._awaiting_agent_response
            or not self.config.tts_enabled
            or self.tts is None
            or self._interrupt_requested
        ):
            return
        delta = payload.get("delta")
        if not isinstance(delta, str) or not delta:
            return
        task_id = payload.get("task_id")
        if self._stream_task_id is None:
            self._stream_task_id = task_id if isinstance(task_id, str) else None
            self._stream_filter = IncrementalSpeechFilter()
        elif isinstance(task_id, str) and task_id != self._stream_task_id:
            return
        if self._stream_filter is None:
            return
        for segment in self._stream_filter.feed(delta):
            self._enqueue_stream_speech(segment)

    async def on_orchestration_completed(self, payload: dict) -> None:
        if self._closed:
            return
        if self._agent_request_started_at is not None:
            logger.info(
                "VOICE_LATENCY stage=agent session=%s agent_ms=%.1f",
                self.session_id,
                (time.monotonic() - self._agent_request_started_at) * 1000.0,
            )
        self._awaiting_agent_response = False
        self._cancel_task(self._response_watchdog)
        self._response_watchdog = None

        if self._pending_modification:
            followup = self._pending_modification
            self._pending_modification = None
            logger.info("VOICE_MODIFICATION_FOLLOWUP session=%s", self.session_id)
            await self._abort_streamed_response()
            await self._submit_user_text(followup)
            return

        if self._interrupt_requested:
            self._interrupt_requested = False
            await self._abort_streamed_response()
            pending_text = self._drain_interruption_text()
            if pending_text:
                await self._submit_user_text(pending_text)
                return
            await self._recover_after_turn(reason="response_skipped_after_barge_in")
            return

        response = payload.get("response")
        if not isinstance(response, str) or not response.strip():
            await self._abort_streamed_response()
            await self._send_error(
                "EMPTY_AGENT_RESPONSE",
                "The agent completed without a spoken response.",
                recoverable=True,
            )
            await self._recover_after_turn()
            return

        filtered = filter_for_speech(response)
        speech_text = filtered.text
        if not speech_text:
            speech_text = "I finished, but the result is only shown on screen."
        await self._safe_send(
            server_event(
                VOICE_ASSISTANT_TEXT,
                self.session_id,
                text=response,
                speech_text=speech_text,
                had_code=filtered.had_code,
                kinds=list(filtered.kinds),
                task_id=payload.get("task_id"),
                conversation_id=self.conversation_id,
            )
        )
        if not self.config.tts_enabled or self.tts is None:
            self._reset_streamed_response()
            await self._safe_send(
                server_event(
                    VOICE_SPEECH_TEXT,
                    self.session_id,
                    text=speech_text,
                    had_code=filtered.had_code,
                )
            )
            self._append_history("assistant", speech_text)
            await self._recover_after_turn(reason="tts_disabled")
            return
        streamed = self._finish_streamed_response()
        if streamed:
            return
        self._start_speech_task(speech_text, preserve_state=None)

    async def on_orchestration_failed(self, payload: dict) -> None:
        if self._closed:
            return
        self._awaiting_agent_response = False
        self._cancel_task(self._response_watchdog)
        self._response_watchdog = None
        if self._pending_modification:
            self._pending_modification = None
        await self._abort_streamed_response()
        if self._interrupt_requested:
            self._interrupt_requested = False
            pending_text = self._drain_interruption_text()
            if pending_text:
                await self._submit_user_text(pending_text)
                return
        error_code = str(payload.get("error") or "AGENT_FAILED")
        await self._send_error(
            "AGENT_FAILED",
            f"The agent could not complete that request ({error_code}).",
            recoverable=True,
        )
        if self.config.tts_enabled and self.tts is not None:
            self._start_speech_task(
                "I could not complete that request. The details are on screen.",
                preserve_state=None,
            )
        else:
            await self._recover_after_turn()

    def _enqueue_stream_speech(self, text: str) -> None:
        if not text:
            return
        if self._stream_speech_queue is None:
            queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
            self._stream_speech_queue = queue
            self._streaming_audio_started = True
            self._speech_task = asyncio.create_task(
                self._speak_stream(queue),
                name=f"voice-speak-stream-{self.session_id}",
            )
        self._stream_speech_queue.put_nowait(text)

    def _finish_streamed_response(self) -> bool:
        if self._stream_filter is not None:
            for segment in self._stream_filter.finish():
                self._enqueue_stream_speech(segment)
        streamed = self._streaming_audio_started
        queue = self._stream_speech_queue
        if queue is not None:
            queue.put_nowait(None)
        self._reset_streamed_response()
        return streamed

    async def _abort_streamed_response(self) -> None:
        was_streaming = self._streaming_audio_started
        self._reset_streamed_response()
        task = self._speech_task if was_streaming else None
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def _reset_streamed_response(self) -> None:
        self._stream_speech_queue = None
        self._stream_filter = None
        self._stream_task_id = None
        self._streaming_audio_started = False

    def _drain_interruption_text(self) -> str:
        text = " ".join(self._pending_interruption_texts).strip()
        self._pending_interruption_texts.clear()
        return text

    async def on_confirmation_pending(self, payload: dict) -> None:
        if self._closed:
            return
        conversation_id = payload.get("conversation_id")
        if conversation_id not in (None, self.conversation_id):
            return
        request_id = payload.get("request_id")
        if not isinstance(request_id, str):
            return
        await self._abort_streamed_response()
        self._pending_confirmation_id = request_id
        speech_text = str(payload.get("speech_text") or "").strip()
        await self._safe_send(
            server_event(
                VOICE_CONFIRMATION_REQUEST,
                self.session_id,
                request_id=request_id,
                action=payload.get("action"),
                what_will_change=payload.get("what_will_change"),
                why=payload.get("why"),
                level=payload.get("level"),
                task_id=payload.get("task_id"),
                expires_in_seconds=payload.get("expires_in_seconds"),
                speech_text=speech_text,
                conversation_id=self.conversation_id,
            )
        )
        if self.state in {VoiceState.THINKING, VoiceState.LISTENING, VoiceState.INTERRUPTED}:
            await self._transition(VoiceState.AWAITING_CONFIRMATION, "confirmation_pending")
        if speech_text:
            if self.config.tts_enabled and self.tts is not None:
                self._start_speech_task(
                    speech_text, preserve_state=VoiceState.AWAITING_CONFIRMATION
                )
            else:
                await self._safe_send(
                    server_event(VOICE_SPEECH_TEXT, self.session_id, text=speech_text)
                )

    async def on_confirmation_resolved(self, payload: dict) -> None:
        if self._closed:
            return
        request_id = payload.get("request_id")
        if self._pending_confirmation_id and request_id != self._pending_confirmation_id:
            return
        self._pending_confirmation_id = None
        decision = payload.get("decision")
        await self._safe_send(
            server_event(
                VOICE_CONFIRMATION_RESOLVED,
                self.session_id,
                request_id=request_id,
                decision=decision,
                approved=payload.get("approved"),
                message=payload.get("message"),
                source=payload.get("source"),
            )
        )
        if decision in {"approve", "reject"}:
            # Approving or rejecting a tool resumes the agent loop, which will
            # eventually emit ORCHESTRATION_COMPLETED.  Keep the session in
            # THINKING (and under the response watchdog) until then.
            self._mark_awaiting_agent()
            await self._transition(
                VoiceState.THINKING, f"confirmation_{decision}"
            )
            return
        if decision == "expired":
            if not self._awaiting_agent_response and not self._speech_active:
                if self.mode is VoiceMode.LIVE:
                    await self._transition(VoiceState.LISTENING, "confirmation_expired")
                else:
                    await self._transition(VoiceState.IDLE, "confirmation_expired")
            return
        if not self._awaiting_agent_response and not self._speech_active:
            if self.mode is VoiceMode.LIVE:
                await self._transition(VoiceState.LISTENING, "confirmation_resolved")
            else:
                await self._transition(VoiceState.IDLE, "confirmation_resolved")

    async def _handle_confirmation_outcome(
        self, outcome: ConfirmationOutcome, *, pending_count: int
    ) -> None:
        if outcome.decision in {"approve", "reject"}:
            self._mark_awaiting_agent()
            await self._transition(VoiceState.THINKING, f"confirmation_{outcome.decision}")
            return
        if outcome.decision == "modify":
            self._pending_modification = outcome.followup_text
            if self._awaiting_agent_response:
                await self._transition(VoiceState.THINKING, "confirmation_modified")
            else:
                followup = self._pending_modification
                self._pending_modification = None
                if followup:
                    await self._submit_user_text(followup)
            return
        # Ambiguous or unrecognised speech while a confirmation is pending:
        # never approve and never start an unrelated task behind the prompt.
        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        spanish = any(item.prompt_text.startswith("Voy a ") for item in pending)
        message = outcome.message or (
            "Dime si te parece bien que continúe o prefieres que lo deje."
            if spanish
            else "Let me know if you’re comfortable with me going ahead or would rather I stop."
        )
        await self._safe_send(
            server_event(
                VOICE_ASSISTANT_TEXT,
                self.session_id,
                text=message,
                speech_text=message,
                had_code=False,
                kinds=[],
                conversation_id=self.conversation_id,
            )
        )
        if self.state is not VoiceState.AWAITING_CONFIRMATION:
            await self._transition(
                VoiceState.AWAITING_CONFIRMATION, "confirmation_still_pending"
            )
        if self.config.tts_enabled and self.tts is not None:
            self._start_speech_task(
                message, preserve_state=VoiceState.AWAITING_CONFIRMATION
            )
        else:
            await self._safe_send(
                server_event(VOICE_SPEECH_TEXT, self.session_id, text=message)
            )

    async def _handle_confirmation_click(self, payload: dict) -> None:
        decision, instructions = parse_confirmation_decision(payload)
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            pending = await self.confirmation_manager.get_pending(self.conversation_id)
            if len(pending) != 1:
                raise VoiceProtocolError(
                    "request_id is required when several confirmations are pending"
                )
            request_id = pending[0].request_id
        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        if not any(item.request_id == request_id for item in pending):
            await self._send_error(
                "CONFIRMATION_NOT_PENDING",
                "That confirmation is no longer pending.",
                recoverable=True,
            )
            return
        outcome = await self.confirmation_manager.resolve_explicit(
            request_id, decision, instructions=instructions, source="voice_ui"
        )
        if decision == "modify":
            self._pending_modification = outcome.followup_text
            if self._awaiting_agent_response:
                await self._transition(VoiceState.THINKING, "confirmation_modified_ui")
            elif outcome.followup_text:
                followup = self._pending_modification
                self._pending_modification = None
                if followup:
                    await self._submit_user_text(followup)
        elif decision == "approve":
            self._mark_awaiting_agent()
            await self._transition(VoiceState.THINKING, "confirmation_approved_ui")
        else:
            self._mark_awaiting_agent()
            await self._transition(VoiceState.THINKING, "confirmation_rejected_ui")

    async def _handle_confirmation_text(self, payload: dict) -> None:
        """Resolve a pending confirmation from typed text in a voice client.

        The same bilingual intent parser used for speech decides the outcome.
        Ambiguous or unrelated text never approves: it returns the centralized
        conversational guidance and keeps the confirmation pending.
        """
        text = text_value(payload, "text", required=True)
        request_id = payload.get("request_id")
        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        if not pending:
            await self._send_error(
                "NO_PENDING_CONFIRMATION",
                "There is no confirmation waiting for an answer.",
                recoverable=True,
            )
            return
        if isinstance(request_id, str) and request_id:
            if not any(item.request_id == request_id for item in pending):
                await self._send_error(
                    "CONFIRMATION_NOT_PENDING",
                    "That confirmation is no longer pending.",
                    recoverable=True,
                )
                return
        outcome = await self.confirmation_manager.try_resolve_text(
            text, conversation_id=self.conversation_id, source="voice_text"
        )
        await self._handle_confirmation_outcome(outcome, pending_count=len(pending))

    # ------------------------------------------------------------------
    # Speech synthesis and playback
    # ------------------------------------------------------------------

    def _start_speech_task(
        self, text: str, *, preserve_state: Optional[VoiceState]
    ) -> None:
        if not text.strip():
            return
        self._cancel_task(self._speech_task)
        self._speech_task = asyncio.create_task(
            self._speak(text, preserve_state=preserve_state),
            name=f"voice-speak-{self.session_id}",
        )

    async def _speak(self, text: str, *, preserve_state: Optional[VoiceState]) -> None:
        if self._closed:
            return
        self._speech_active = True
        self._speech_finalized = False
        self._speech_interrupted = False
        self._speech_preserve_state = preserve_state
        self._last_playback_index = -1
        self._first_audio_logged = False
        self._playback_done_event.clear()
        self._speech_segments = []
        if preserve_state is None:
            try:
                await self._transition(VoiceState.SPEAKING, "speech_started")
            except InvalidVoiceTransition:
                pass
        segments = split_speech_segments(text)
        if not segments:
            await self._finalize_speech(interrupted=False)
            return
        total_duration_ms = 0.0
        try:
            for index, segment_text in enumerate(segments):
                if not self._speech_active or self._closed:
                    return
                segment = SpeechSegment(index=index, text=segment_text)
                self._speech_segments.append(segment)
                try:
                    wav = await self.tts.synthesize_wav(
                        segment_text, getattr(self.config, "voice_id", None)
                    )
                except VoiceProviderError as error:
                    logger.warning("TTS unavailable: %s", error)
                    await self._send_error("TTS_FAILED", str(error), recoverable=True)
                    break
                except Exception:
                    logger.exception("TTS synthesis failed")
                    await self._send_error(
                        "TTS_FAILED", "Local speech synthesis failed.", recoverable=True
                    )
                    break
                try:
                    _pcm, sample_rate, _channels = wav_to_pcm16(wav)
                    duration_ms = pcm16_duration_ms(_pcm, sample_rate)
                except Exception:
                    duration_ms = 0.0
                segment.duration_ms = duration_ms
                total_duration_ms += duration_ms
                segment.sent = True
                if self._server_audio_active:
                    await self._safe_send(
                        server_event(
                            VOICE_AUDIO_SEGMENT,
                            self.session_id,
                            index=index,
                            text=segment_text,
                            server_playback=True,
                            duration_ms=round(duration_ms, 1),
                        )
                    )
                    try:
                        await self._server_audio.play_wav(wav)
                        segment.completed = True
                        self._last_playback_index = index
                    except Exception:
                        logger.exception("Server audio playback failed")
                        await self._send_error(
                            "PLAYBACK_FAILED", "Local playback failed.", recoverable=True
                        )
                        break
                else:
                    await self._safe_send(
                        server_event(
                            VOICE_AUDIO_SEGMENT,
                            self.session_id,
                            index=index,
                            text=segment_text,
                            audio_base64=base64.b64encode(wav).decode("ascii"),
                            mime_type="audio/wav",
                            duration_ms=round(duration_ms, 1),
                        )
                    )
                self._mark_first_audio_sent()
            if not self._speech_active:
                return
            if not any(segment.sent for segment in self._speech_segments):
                # Every synthesis attempt failed.  Report the error and return
                # to listening instead of waiting for playback that cannot
                # happen.
                await self._finalize_speech(interrupted=False)
                return
            if self._server_audio_active:
                await self._finalize_speech(interrupted=False)
                return
            await self._safe_send(
                server_event(
                    VOICE_SPEAKING_END,
                    self.session_id,
                    segment_count=len(self._speech_segments),
                    total_duration_ms=round(total_duration_ms, 1),
                    expects_playback=True,
                    preserve_state=preserve_state.value if preserve_state else None,
                )
            )
            timeout = max(8.0, total_duration_ms / 1000.0 + 8.0)
            try:
                await asyncio.wait_for(self._playback_done_event.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("Voice playback acknowledgement timed out session=%s", self.session_id)
                await self._finalize_speech(interrupted=False, assume_complete=True)
        except asyncio.CancelledError:
            await self._finalize_speech(interrupted=True)
            return
        finally:
            if self._speech_active:
                await self._finalize_speech(interrupted=self._speech_interrupted)

    async def _speak_stream(
        self, queue: asyncio.Queue[Optional[str]]
    ) -> None:
        if self._closed or self._interrupt_requested:
            return
        self._speech_active = True
        self._speech_finalized = False
        self._speech_interrupted = False
        self._speech_preserve_state = None
        self._last_playback_index = -1
        self._first_audio_logged = False
        self._playback_done_event.clear()
        self._speech_segments = []
        try:
            await self._transition(VoiceState.SPEAKING, "streamed_speech_started")
        except InvalidVoiceTransition:
            pass

        total_duration_ms = 0.0
        try:
            while self._speech_active and not self._closed:
                streamed_text = await queue.get()
                if streamed_text is None:
                    break
                for segment_text in split_speech_segments(streamed_text):
                    if not self._speech_active or self._closed:
                        return
                    segment = SpeechSegment(
                        index=len(self._speech_segments), text=segment_text
                    )
                    self._speech_segments.append(segment)
                    try:
                        wav = await self.tts.synthesize_wav(
                            segment_text, getattr(self.config, "voice_id", None)
                        )
                    except VoiceProviderError as error:
                        logger.warning("TTS unavailable: %s", error)
                        await self._send_error(
                            "TTS_FAILED", str(error), recoverable=True
                        )
                        await self._finalize_speech(interrupted=False)
                        return
                    except Exception:
                        logger.exception("TTS synthesis failed")
                        await self._send_error(
                            "TTS_FAILED",
                            "Local speech synthesis failed.",
                            recoverable=True,
                        )
                        await self._finalize_speech(interrupted=False)
                        return
                    try:
                        pcm, sample_rate, _channels = wav_to_pcm16(wav)
                        duration_ms = pcm16_duration_ms(pcm, sample_rate)
                    except Exception:
                        duration_ms = 0.0
                    segment.duration_ms = duration_ms
                    total_duration_ms += duration_ms
                    segment.sent = True
                    if self._server_audio_active:
                        await self._safe_send(
                            server_event(
                                VOICE_AUDIO_SEGMENT,
                                self.session_id,
                                index=segment.index,
                                text=segment_text,
                                server_playback=True,
                                duration_ms=round(duration_ms, 1),
                            )
                        )
                        try:
                            await self._server_audio.play_wav(wav)
                            segment.completed = True
                            self._last_playback_index = segment.index
                        except Exception:
                            logger.exception("Server audio playback failed")
                            await self._send_error(
                                "PLAYBACK_FAILED",
                                "Local playback failed.",
                                recoverable=True,
                            )
                            await self._finalize_speech(interrupted=False)
                            return
                    else:
                        await self._safe_send(
                            server_event(
                                VOICE_AUDIO_SEGMENT,
                                self.session_id,
                                index=segment.index,
                                text=segment_text,
                                audio_base64=base64.b64encode(wav).decode("ascii"),
                                mime_type="audio/wav",
                                duration_ms=round(duration_ms, 1),
                            )
                        )
                    self._mark_first_audio_sent()

            if not self._speech_active:
                return
            if not any(segment.sent for segment in self._speech_segments):
                await self._finalize_speech(interrupted=False)
                return
            if self._server_audio_active:
                await self._finalize_speech(interrupted=False)
                return
            await self._safe_send(
                server_event(
                    VOICE_SPEAKING_END,
                    self.session_id,
                    segment_count=len(self._speech_segments),
                    total_duration_ms=round(total_duration_ms, 1),
                    expects_playback=True,
                    preserve_state=None,
                )
            )
            timeout = max(8.0, total_duration_ms / 1000.0 + 8.0)
            try:
                await asyncio.wait_for(
                    self._playback_done_event.wait(), timeout=timeout
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Voice playback acknowledgement timed out session=%s",
                    self.session_id,
                )
                await self._finalize_speech(
                    interrupted=False, assume_complete=True
                )
        except asyncio.CancelledError:
            await self._finalize_speech(interrupted=self._speech_interrupted)
            return
        finally:
            if self._speech_active:
                await self._finalize_speech(interrupted=self._speech_interrupted)

    def _mark_first_audio_sent(self) -> None:
        if self._first_audio_logged or self._agent_request_started_at is None:
            return
        self._first_audio_logged = True
        elapsed_ms = (time.monotonic() - self._agent_request_started_at) * 1000.0
        logger.info(
            "VOICE_LATENCY stage=first_audio session=%s total_ms=%.1f",
            self.session_id,
            elapsed_ms,
        )

    def _handle_playback_progress(self, payload: dict) -> None:
        index = payload.get("index", payload.get("last_index"))
        if not isinstance(index, int) or not self._speech_segments:
            return
        for segment in self._speech_segments:
            if segment.index <= index:
                segment.completed = True
        self._last_playback_index = max(self._last_playback_index, index)

    def _handle_playback_done(self, payload: dict) -> None:
        if not self._speech_active:
            return
        interrupted = bool(payload.get("interrupted"))
        last_index = payload.get("last_index")
        if isinstance(last_index, int):
            for segment in self._speech_segments:
                if segment.index <= last_index:
                    segment.completed = True
        elif not interrupted:
            for segment in self._speech_segments:
                if segment.sent:
                    segment.completed = True
        self._speech_interrupted = interrupted
        self._playback_done_event.set()

    async def _finalize_speech(
        self, *, interrupted: bool, assume_complete: bool = False
    ) -> None:
        if self._speech_finalized:
            return
        self._speech_finalized = True
        self._speech_active = False
        if assume_complete:
            for segment in self._speech_segments:
                if segment.sent:
                    segment.completed = True
        spoken = " ".join(
            segment.text
            for segment in self._speech_segments
            if segment.completed and segment.text
        ).strip()
        self._speech_segments = []
        self._playback_done_event.clear()
        if spoken:
            self._append_history("assistant", spoken)
        preserve = self._speech_preserve_state
        self._speech_preserve_state = None
        if interrupted:
            await self._safe_send(
                server_event(
                    VOICE_INTERRUPTED,
                    self.session_id,
                    reason="barge_in",
                    committed_text=spoken,
                )
            )
            await self._transition(VoiceState.INTERRUPTED, "barge_in")
            if not self._awaiting_agent_response and not self._closed:
                await self._transition(VoiceState.LISTENING, "listening_after_barge_in")
            return
        if self._closed:
            return
        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        if pending or preserve is VoiceState.AWAITING_CONFIRMATION:
            await self._transition(VoiceState.AWAITING_CONFIRMATION, "speech_finished_confirmation")
        elif self.mode is VoiceMode.LIVE:
            await self._transition(VoiceState.LISTENING, "speech_finished")
        else:
            await self._transition(VoiceState.IDLE, "speech_finished")

    async def interrupt(self, reason: str = "user_speech") -> None:
        if self._closed:
            return
        logger.info("VOICE_INTERRUPT session=%s state=%s", self.session_id, self.state.value)
        if self.state is VoiceState.SPEAKING or (
            self.state is VoiceState.AWAITING_CONFIRMATION and self._speech_active
        ):
            self._speech_interrupted = True
            self._server_audio_stop_playback()
            await self._safe_send(
                server_event(VOICE_AUDIO_STOP, self.session_id, reason=reason)
            )
            if self._awaiting_agent_response:
                self._interrupt_requested = True
            self._cancel_task(self._speech_task)
            if not self._speech_finalized:
                await self._finalize_speech(interrupted=True)
            else:
                await self._transition(VoiceState.INTERRUPTED, reason)
                if not self._awaiting_agent_response:
                    await self._transition(VoiceState.LISTENING, "listening_after_interrupt")
            return
        if self.state is VoiceState.THINKING:
            self._interrupt_requested = True
            await self._safe_send(
                server_event(VOICE_INTERRUPTED, self.session_id, reason=reason, during="thinking")
            )
            await self._transition(VoiceState.INTERRUPTED, "interrupt_while_thinking")
            return
        if self.state is VoiceState.PROCESSING:
            self._discard_current_utterance = True
            self._vad.reset()
            await self._safe_send(
                server_event(VOICE_INTERRUPTED, self.session_id, reason=reason, during="transcribing")
            )
            await self._transition(VoiceState.LISTENING, "interrupt_while_transcribing")
            return
        await self._safe_send(
            server_event(VOICE_INTERRUPTED, self.session_id, reason=reason, during=self.state.value)
        )

    # ------------------------------------------------------------------
    # Mute / server audio
    # ------------------------------------------------------------------

    async def mute(self) -> None:
        if self._closed or self._muted:
            return
        self._muted = True
        self._vad.reset()
        self._normal_pcm.clear()
        if self._speech_active:
            self._speech_interrupted = True
            self._server_audio_stop_playback()
            self._cancel_task(self._speech_task)
        await self._transition(VoiceState.MUTED, "muted_by_user")

    async def unmute(self) -> None:
        if self._closed or not self._muted:
            return
        self._muted = False
        self._vad.reset()
        target = VoiceState.LISTENING if self.mode is VoiceMode.LIVE else VoiceState.IDLE
        await self._transition(target, "unmuted_by_user")

    async def _start_server_audio(self) -> None:
        if self._server_audio_active or self._closed:
            return
        loop = asyncio.get_running_loop()

        def enqueue(chunk: bytes) -> None:
            try:
                loop.call_soon_threadsafe(self._server_queue.put_nowait, chunk)
            except RuntimeError:
                pass
            except asyncio.QueueFull:
                pass

        try:
            server_audio = self.server_audio_factory(enqueue)
            server_audio.start()
        except ServerAudioError as error:
            await self._send_error("SERVER_AUDIO_FAILED", str(error), recoverable=True)
            return
        except Exception as error:
            await self._send_error(
                "SERVER_AUDIO_FAILED",
                f"Could not start local audio ({type(error).__name__}).",
                recoverable=True,
            )
            return
        self._server_audio = server_audio
        self._server_audio_active = True
        self._server_consumer_task = asyncio.create_task(
            self._server_audio_consumer(), name=f"voice-server-audio-{self.session_id}"
        )
        await self._safe_send(
            server_event(VOICE_STATE, self.session_id, state=self.state.value, server_audio=True)
        )

    def _stop_server_audio(self) -> None:
        self._server_audio_active = False
        server_audio = self._server_audio
        self._server_audio = None
        if server_audio is not None:
            try:
                server_audio.stop()
            except Exception:
                logger.debug("Could not stop server audio", exc_info=True)
        self._cancel_task(self._server_consumer_task)
        self._server_consumer_task = None

    def _server_audio_stop_playback(self) -> None:
        server_audio = self._server_audio
        if server_audio is not None:
            try:
                server_audio.stop_playback()
            except Exception:
                logger.debug("Could not stop server playback", exc_info=True)

    async def _server_audio_consumer(self) -> None:
        try:
            while not self._closed:
                chunk = await self._server_queue.get()
                try:
                    await self.ingest_audio(chunk, VOICE_SAMPLE_RATE)
                finally:
                    self._server_queue.task_done()
        except asyncio.CancelledError:
            return

    # ------------------------------------------------------------------
    # State / history / helpers
    # ------------------------------------------------------------------

    async def _on_state_change(
        self, previous: VoiceState, current: VoiceState, reason: str
    ) -> None:
        await self._emit_state(
            current,
            reason,
            previous=previous.value,
            muted=self._muted,
            awaiting_agent=self._awaiting_agent_response,
        )

    async def _emit_state(self, state: VoiceState, reason: str, **extra: Any) -> None:
        await self._safe_send(
            server_event(
                VOICE_STATE,
                self.session_id,
                state=state.value,
                reason=reason,
                mode=self.mode.value,
                conversation_id=self.conversation_id,
                **extra,
            )
        )

    async def _transition(self, target: VoiceState, reason: str) -> None:
        try:
            await self.state_machine.transition(target, reason)
        except InvalidVoiceTransition:
            logger.warning(
                "VOICE_TRANSITION_FALLBACK %s -> %s reason=%s",
                self.state.value,
                target.value,
                reason,
            )
            await self.state_machine.force(target, reason)

    def _append_history(self, role: str, content: str) -> None:
        if not content.strip():
            return
        self.history.append({"role": role, "content": content.strip()})
        if len(self.history) > MAX_HISTORY_MESSAGES:
            self.history = self.history[-MAX_HISTORY_MESSAGES:]

    async def _recover_after_turn(self, reason: str = "turn_finished") -> None:
        if self._closed:
            return
        if self._muted:
            await self._transition(VoiceState.MUTED, reason)
            return
        pending = await self.confirmation_manager.get_pending(self.conversation_id)
        if pending:
            await self._transition(VoiceState.AWAITING_CONFIRMATION, reason)
        elif self.mode is VoiceMode.LIVE:
            self._vad.reset()
            await self._transition(VoiceState.LISTENING, reason)
        else:
            await self._transition(VoiceState.IDLE, reason)

    async def _recover_to_listening(self) -> None:
        await self._recover_after_turn(reason="recovered")

    async def _send_error(self, code: str, message: str, *, recoverable: bool) -> None:
        await self._safe_send(
            server_event(
                VOICE_ERROR,
                self.session_id,
                code=code,
                message=message,
                recoverable=recoverable,
                state=self.state.value,
            )
        )

    async def _safe_send(self, event: dict) -> None:
        try:
            await self.send(event)
        except Exception:
            logger.debug("Voice client send failed session=%s", self.session_id, exc_info=True)

    @staticmethod
    def _cancel_task(task: Optional[asyncio.Task]) -> None:
        if task is not None and not task.done():
            task.cancel()

    def status(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "conversation_id": self.conversation_id,
            "state": self.state.value,
            "mode": self.mode.value,
            "muted": self._muted,
            "history_messages": len(self.history),
            "server_audio": self._server_audio_active,
            "awaiting_agent": self._awaiting_agent_response,
            "pending_confirmation_id": self._pending_confirmation_id,
            "uptime_seconds": round(time.monotonic() - self._started_at, 1),
        }
