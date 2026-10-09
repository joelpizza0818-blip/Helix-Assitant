import logging
import asyncio
import os
import uuid
from enum import Enum

logger = logging.getLogger(__name__)

class VoiceState(Enum):
    IDLE = "IDLE"
    WAKE_DETECTED = "WAKE_DETECTED"
    LISTENING = "LISTENING"
    TRANSCRIBING = "TRANSCRIBING"
    WAITING_RESPONSE = "WAITING_RESPONSE"
    SPEAKING = "SPEAKING"
    ERROR = "ERROR"

class VoiceEngine:
    WAKE_WORD_RETRY_SECONDS = 3.0
    AUDIO_READ_TIMEOUT_SECONDS = 5.0

    def __init__(self, config: dict, event_bus, key_manager, state_manager=None):
        self.config = config
        self.event_bus = event_bus
        self.key_manager = key_manager
        self.state_manager = state_manager
        self.enabled = config.get('VOICE_ENABLED', 'false').lower() == 'true'
        self.state = VoiceState.IDLE
        self._is_active = False
        self._audio_device = None
        self._task = None
        self._wake_monitor_task = None
        self._stt_warmup_task = None
        self._conversation_id = None
        self._conversation_history = []
        self.configure_memory(config.get("MEMORY_CONTEXT_LIMIT", 20))
        
        if not self.enabled:
            logger.info("VoiceEngine is disabled in config.")
            return
            
        if __package__ == "perception":
            from .wake_word import WakeWordDetector
            from .vad import VADDetector
            from .speech_to_text import SpeechToText
            from .text_to_speech import TextToSpeech
        else:
            from services.agent.perception.wake_word import WakeWordDetector
            from services.agent.perception.vad import VADDetector
            from services.agent.perception.speech_to_text import SpeechToText
            from services.agent.perception.text_to_speech import TextToSpeech
        
        key_info = key_manager.get_available_key('openai')
        openai_key = key_info[1] if key_info else None
        wake_word_threshold = float(
            config.get(
                'WAKE_WORD_THRESHOLD',
                os.environ.get('WAKE_WORD_THRESHOLD', '0.5'),
            )
        )
        
        self.wake_detector = WakeWordDetector(
            wake_word=config.get('WAKE_WORD', os.environ.get('WAKE_WORD', 'hey helix')),
            provider=config.get('WAKE_WORD_PROVIDER', os.environ.get('WAKE_WORD_PROVIDER', 'openwakeword')),
            model_path=config.get('WAKE_WORD_MODEL_PATH', os.environ.get('WAKE_WORD_MODEL_PATH')),
            event_bus=self.event_bus,
            threshold=wake_word_threshold,
            aliases=config.get("WAKE_WORD_ALIASES", []),
        )
        try:
            vad_threshold = float(config.get("VAD_THRESHOLD", config.get("VAD_SILENCE_THRESHOLD_MS", 250)))
        except (TypeError, ValueError):
            vad_threshold = 250
        self.vad = VADDetector(min_speech_rms=max(50.0, min(2000.0, vad_threshold)))
        self.stt = SpeechToText(
            provider=config.get('STT_PROVIDER', 'whisper_local'),
            model=config.get('STT_MODEL', 'base'),
            api_key=openai_key
        )
        self.tts = TextToSpeech(
            provider=config.get('TTS_PROVIDER', 'system'),
            model=config.get('TTS_MODEL', 'tts-1'),
            api_key=self._tts_api_key(config.get('TTS_PROVIDER', 'system'), openai_key),
            voice_id=config.get('TTS_VOICE', 'echo'),
        )
        self.fallback_tts = TextToSpeech(
            provider='system',
        )
        
        self._subscriptions = []

    def _subscribe_events(self) -> None:
        self._subscriptions = [
            asyncio.create_task(
                self.event_bus.subscribe("VOICE_WAKE", self._handle_wake_event)
            ),
            asyncio.create_task(
                self.event_bus.subscribe(
                    "ORCHESTRATION_COMPLETED", self._handle_response_event
                )
            ),
            asyncio.create_task(
                self.event_bus.subscribe(
                    "ORCHESTRATION_FAILED", self._handle_response_event
                )
            ),
            asyncio.create_task(
                self.event_bus.subscribe("VOICE_STOP", self._handle_stop_event)
            ),
        ]

    async def start(self):
        if not self.enabled or self._is_active:
            return
        if not getattr(self.wake_detector, "provider", None):
            raise RuntimeError(
                "Voice activation has no compatible wake-word ONNX model."
            )
        if not self._subscriptions:
            self._subscribe_events()
        await asyncio.gather(*self._subscriptions)
        self._is_active = True
        await self.wake_detector.start()
        if not self.wake_detector.is_running():
            logger.error(
                "VoiceEngine could not start wake-word microphone input; "
                "automatic recovery will retry."
            )
        self._audio_device = getattr(self.wake_detector, "input_device", None)
        logger.info("VoiceEngine started.")
        self._wake_monitor_task = asyncio.create_task(
            self._monitor_wake_detector()
        )
        if self.stt.provider == "whisper_local":
            self._stt_warmup_task = asyncio.create_task(self.stt.warmup())
            self._stt_warmup_task.add_done_callback(self._log_stt_warmup_result)

    async def _monitor_wake_detector(self) -> None:
        while self._is_active:
            if (
                self.state == VoiceState.IDLE
                and not self.wake_detector.is_running()
            ):
                logger.warning(
                    "Wake-word microphone is not responding; attempting recovery."
                )
                try:
                    await self.wake_detector.start()
                except Exception:
                    logger.exception("Wake-word microphone recovery failed.")
                if self.wake_detector.is_running():
                    self._audio_device = getattr(
                        self.wake_detector, "input_device", None
                    )
                    logger.info("Wake-word microphone recovered.")
            await asyncio.sleep(self.WAKE_WORD_RETRY_SECONDS)

    @staticmethod
    def _log_stt_warmup_result(task):
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            logger.error("Background STT model warm-up failed: %s", error)

    async def stop(self):
        self._is_active = False
        if self._wake_monitor_task:
            self._wake_monitor_task.cancel()
            try:
                await self._wake_monitor_task
            except asyncio.CancelledError:
                pass
            self._wake_monitor_task = None
        await self.wake_detector.stop()
        if self.state_manager:
            await self.state_manager.update_state(voice_active=False)
        await self.event_bus.unsubscribe("VOICE_WAKE", self._handle_wake_event)
        await self.event_bus.unsubscribe(
            "ORCHESTRATION_COMPLETED", self._handle_response_event
        )
        await self.event_bus.unsubscribe(
            "ORCHESTRATION_FAILED", self._handle_response_event
        )
        await self.event_bus.unsubscribe("VOICE_STOP", self._handle_stop_event)
        for subscription in self._subscriptions:
            if not subscription.done():
                subscription.cancel()
        self._subscriptions = []
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("VoiceEngine stopped.")

    def is_active(self) -> bool:
        return self._is_active

    def configure_memory(self, turn_limit: int) -> None:
        try:
            turns = int(turn_limit)
        except (TypeError, ValueError):
            turns = 20
        self._conversation_history_limit = max(1, min(100, turns)) * 2
        self._trim_conversation_history()

    def _tts_api_key(self, provider: str, openai_key: str | None = None) -> str | None:
        if provider == "openai":
            if openai_key is not None:
                return openai_key
            key_info = self.key_manager.get_available_key("openai")
            return key_info[1] if key_info else None
        if provider == "elevenlabs":
            return os.environ.get("ELEVENLABS_API_KEY")
        return None

    async def configure_stt(self, provider: str, model: str) -> None:
        if __package__ == "perception":
            from .speech_to_text import SpeechToText
        else:
            from services.agent.perception.speech_to_text import SpeechToText
        key_info = self.key_manager.get_available_key("openai")
        self.stt = SpeechToText(
            provider=provider,
            model=model,
            api_key=key_info[1] if key_info else None,
        )
        self.config.update({"STT_PROVIDER": provider, "STT_MODEL": model})
        if self._is_active and provider == "whisper_local":
            if self._stt_warmup_task and not self._stt_warmup_task.done():
                self._stt_warmup_task.cancel()
                try:
                    await self._stt_warmup_task
                except asyncio.CancelledError:
                    pass
            self._stt_warmup_task = asyncio.create_task(self.stt.warmup())
            self._stt_warmup_task.add_done_callback(self._log_stt_warmup_result)

    def _trim_conversation_history(self) -> None:
        history_limit = getattr(self, "_conversation_history_limit", 40)
        self._conversation_history = self._conversation_history[-history_limit:]

    async def speak(self, text: str):
        if not self.enabled:
            return
        self.state = VoiceState.SPEAKING
        try:
            await self._speak_with_fallback(text)
        except Exception as e:
            logger.exception("VoiceEngine could not speak the response: %s", e)
            self.state = VoiceState.ERROR
        finally:
            self.state = VoiceState.IDLE

    async def configure_tts(
        self, provider: str, model: str, voice_id: str
    ) -> None:
        if __package__ == "perception":
            from .text_to_speech import TextToSpeech
        else:
            from services.agent.perception.text_to_speech import TextToSpeech

        self.tts = TextToSpeech(
            provider=provider,
            model=model,
            api_key=self._tts_api_key(provider),
            voice_id=voice_id,
        )
        self.config.update(
            {
                "TTS_PROVIDER": provider,
                "TTS_MODEL": model,
                "TTS_VOICE": voice_id,
            }
        )

    async def configure_wake_word(
        self,
        wake_word: str,
        provider: str,
        threshold: float,
        aliases: list[str] | None = None,
        model_path: str | None = None,
    ) -> None:
        was_active = self._is_active
        if __package__ == "perception":
            from .wake_word import WakeWordDetector
        else:
            from services.agent.perception.wake_word import WakeWordDetector
        new_detector = WakeWordDetector(
            wake_word=wake_word,
            provider=provider,
            model_path=model_path or self.config.get("WAKE_WORD_MODEL_PATH"),
            event_bus=self.event_bus,
            threshold=threshold,
            aliases=aliases or [],
        )
        if not getattr(new_detector, "provider", None):
            raise RuntimeError(
                "The selected wake phrase has no matching OpenWakeWord model."
            )
        previous_detector = self.wake_detector
        if was_active:
            await previous_detector.stop()
            try:
                await new_detector.start()
                if not new_detector.is_running():
                    raise RuntimeError(
                        "The wake-word microphone could not start with the new settings."
                    )
            except Exception:
                try:
                    await previous_detector.start()
                except Exception:
                    logger.exception("Could not restore the previous wake-word detector.")
                raise
        self.wake_detector = new_detector
        self.config.update({
            "WAKE_WORD": wake_word,
            "WAKE_WORD_PROVIDER": provider,
            "WAKE_WORD_THRESHOLD": str(threshold),
            "WAKE_WORD_ALIASES": aliases or [],
        })

    async def _speak_with_fallback(self, text: str) -> None:
        try:
            await self.tts.speak(text)
        except Exception:
            if getattr(self.tts, "provider", "system") == "system":
                raise
            logger.exception(
                "Primary TTS provider %s failed; falling back to the Windows system voice.",
                getattr(self.tts, "provider", "unknown"),
            )
            await self.fallback_tts.speak(text)

    async def _handle_wake_event(self, _event_name: str, payload: dict):
        if self.state != VoiceState.IDLE:
            logger.info(
                "VOICE_WAKE_EVENT_IGNORED state=%s phrase=%r",
                self.state.value,
                payload.get("phrase", ""),
            )
            return
        logger.info("VOICE_WAKE_EVENT_RECEIVED phrase=%r", payload.get("phrase", ""))
        self._conversation_id = str(uuid.uuid4())
        self._conversation_history = []
        if self.state_manager:
            await self.state_manager.update_state(voice_active=True)
        self._on_wake_word(payload.get("phrase", ""))

    def _on_wake_word(self, phrase: str):
        if self.state != VoiceState.IDLE:
            return
        self.state = VoiceState.WAKE_DETECTED
        logger.info("VOICE_STATE transition=%s phrase=%r", self.state.value, phrase)
        self._task = asyncio.create_task(self._handle_interaction(initial=True))

    async def _handle_interaction(self, initial: bool):
        try:
            await self.wake_detector.stop()
            self.state = VoiceState.LISTENING
            transcription = await self._listen_and_transcribe(
                start_timeout_s=8.0 if initial else 10.0
            )
            if transcription:
                self._conversation_history.append(
                    {"role": "user", "content": transcription}
                )
                self._trim_conversation_history()
                self.state = VoiceState.WAITING_RESPONSE
                logger.info(
                    "VOICE_USER_TEXT_EMITTED source=voice characters=%d conversation_id=%s",
                    len(transcription),
                    self._conversation_id,
                )
                await self.event_bus.publish(
                    "USER_TEXT",
                    {
                        "text": transcription,
                        "input_source": "voice",
                        "conversation_id": self._conversation_id,
                        "conversation_history": list(self._conversation_history),
                    },
                )
            else:
                await self._end_conversation()
        except Exception as e:
            logger.exception("Voice interaction failed: %s", e)
            self.state = VoiceState.ERROR
            await self._end_conversation()
        finally:
            if self.state not in {
                VoiceState.WAITING_RESPONSE,
                VoiceState.LISTENING,
            }:
                self.state = VoiceState.IDLE

    async def _audio_generator(self, stream, frame_size):
        loop = asyncio.get_running_loop()
        frames_received = 0
        last_report = loop.time()
        while self.state == VoiceState.LISTENING:
            try:
                data, overflowed = await asyncio.wait_for(
                    asyncio.to_thread(stream.read, frame_size),
                    timeout=self.AUDIO_READ_TIMEOUT_SECONDS,
                )
                frames_received += 1
                now = loop.time()
                if frames_received == 1:
                    logger.info(
                        "VOICE_AUDIO_FRAME_RECEIVED stage=capture frames_total=1 "
                        "samples=%d bytes=%d",
                        len(data) // 2,
                        len(data),
                    )
                elif now - last_report >= 5.0:
                    logger.info(
                        "VOICE_AUDIO_FRAME_RECEIVED stage=capture "
                        "frames_total=%d interval_seconds=%.1f",
                        frames_received,
                        now - last_report,
                    )
                    last_report = now
                if overflowed:
                    logger.warning("Audio input overflowed while recording speech.")
                yield data
            except asyncio.TimeoutError:
                logger.error(
                    "Audio input stopped returning frames; ending this capture "
                    "so the wake-word microphone can recover."
                )
                break
            except Exception as e:
                logger.exception("Audio stream read error: %s", e)
                break

    async def _listen_and_transcribe(self, start_timeout_s: float | None = None) -> str:
        import sounddevice as sd

        stream = None
        audio_bytes = b""
        capture_started = False
        capture_announced = False
        capture_stop_reason = "error"
        try:
            frame_count = self.vad.frame_size // 2
            stream = sd.RawInputStream(
                device=getattr(self, "_audio_device", None),
                channels=1,
                samplerate=self.vad.sample_rate,
                dtype="int16",
                blocksize=frame_count,
            )
            stream.start()
            capture_started = True
            await self.event_bus.publish("VOICE_CAPTURE_STARTED", {})
            capture_announced = True
            logger.info(
                "AUDIO_CAPTURE_STARTED device=%s sample_rate=%s channels=1 "
                "format=int16 frame_samples=%d frame_bytes=%d",
                getattr(stream, "device", getattr(self, "_audio_device", None)),
                self.vad.sample_rate,
                frame_count,
                self.vad.frame_size,
            )
            
            gen = self._audio_generator(stream, frame_count)
            audio_bytes = await self.vad.collect_speech(
                gen,
                start_timeout_s=start_timeout_s,
            )
            logger.info(
                "AUDIO_CAPTURE_STOPPED reason=%s bytes=%d",
                getattr(self.vad, "last_capture_stop_reason", "unknown"),
                len(audio_bytes),
            )
            capture_stop_reason = getattr(
                self.vad, "last_capture_stop_reason", "completed"
            )
            capture_started = False
            captured_stream = stream
            stream = None
            try:
                captured_stream.stop()
            finally:
                captured_stream.close()
            
            if not audio_bytes:
                logger.info("STT_SKIPPED reason=no_audio")
                return ""

            self.state = VoiceState.TRANSCRIBING
            logger.info(
                "VOICE_STATE transition=%s",
                self.state.value,
            )
            logger.info(
                "STT_STARTED provider=%s bytes=%d sample_rate=%d channels=1 format=int16",
                getattr(self.stt, "provider", "unknown"),
                len(audio_bytes),
                self.vad.sample_rate,
            )
            try:
                text = await self.stt.transcribe(audio_bytes)
            except Exception as exc:
                logger.exception(
                    "STT_FAILED provider=%s exception_type=%s",
                    getattr(self.stt, "provider", "unknown"),
                    type(exc).__name__,
                )
                raise
            logger.info(
                "STT_COMPLETED empty=%s characters=%d",
                not bool(text.strip()),
                len(text),
            )
            return text
        finally:
            if capture_started:
                logger.info(
                    "AUDIO_CAPTURE_STOPPED reason=error bytes=%d",
                    len(audio_bytes),
                )
            if stream is not None:
                try:
                    try:
                        stream.stop()
                    finally:
                        stream.close()
                finally:
                    if capture_announced:
                        await self.event_bus.publish(
                            "VOICE_CAPTURE_STOPPED",
                            {"reason": capture_stop_reason},
                        )
            elif capture_announced:
                await self.event_bus.publish(
                    "VOICE_CAPTURE_STOPPED",
                    {"reason": capture_stop_reason},
                )

    async def _handle_stop_event(self, _event_name: str, _payload: dict):
        if self.state == VoiceState.IDLE:
            return
        logger.info("VOICE_STOP received; ending active conversation.")
        active_task = self._task
        if active_task and active_task is not asyncio.current_task() and not active_task.done():
            active_task.cancel()
            try:
                await active_task
            except asyncio.CancelledError:
                pass
        await self._end_conversation()

    async def _handle_response_event(self, _event_name: str, payload: dict):
        if (
            payload.get("input_source") != "voice"
            or payload.get("conversation_id") != self._conversation_id
            or self.state != VoiceState.WAITING_RESPONSE
        ):
            return

        response = (
            "No pude completar eso. Inténtalo de nuevo."
            if _event_name == "ORCHESTRATION_FAILED"
            else payload.get("response")
        )
        if not isinstance(response, str) or not response.strip():
            logger.error("Voice conversation completed without a speakable response.")
            await self._end_conversation()
            return

        response = response.strip()
        self._conversation_history.append({"role": "assistant", "content": response})
        self._trim_conversation_history()
        self.state = VoiceState.SPEAKING
        logger.info(
            "TTS_STARTED provider=%s characters=%d conversation_id=%s",
            getattr(self.tts, "provider", "unknown"),
            len(response),
            self._conversation_id,
        )
        try:
            await self._speak_with_fallback(response)
        except Exception:
            logger.exception("Failed to speak the voice response.")
            await self._end_conversation()
            return
        logger.info(
            "TTS_COMPLETED provider=%s",
            getattr(self.tts, "provider", "unknown"),
        )

        if self._is_active:
            self.state = VoiceState.LISTENING
            self._task = asyncio.create_task(self._handle_interaction(initial=False))
        else:
            await self._end_conversation()

    async def _end_conversation(self):
        self._conversation_id = None
        self._conversation_history = []
        self.state = VoiceState.IDLE
        if self.state_manager:
            await self.state_manager.update_state(voice_active=False)
        if self._is_active:
            await self.wake_detector.start()
