import logging
import asyncio
from enum import Enum
import pyaudio

logger = logging.getLogger(__name__)

class VoiceState(Enum):
    IDLE = "IDLE"
    WAKE_DETECTED = "WAKE_DETECTED"
    LISTENING = "LISTENING"
    TRANSCRIBING = "TRANSCRIBING"
    SPEAKING = "SPEAKING"
    ERROR = "ERROR"

class VoiceEngine:
    def __init__(self, config: dict, event_bus, key_manager):
        self.config = config
        self.event_bus = event_bus
        self.key_manager = key_manager
        self.enabled = config.get('VOICE_ENABLED', 'false').lower() == 'true'
        self.state = VoiceState.IDLE
        self._is_active = False
        self._task = None
        
        if not self.enabled:
            logger.info("VoiceEngine is disabled in config.")
            return
            
        from services.agent.perception.wake_word import WakeWordDetector
        from services.agent.perception.vad import VADDetector
        from services.agent.perception.speech_to_text import SpeechToText
        from services.agent.perception.text_to_speech import TextToSpeech
        
        openai_key = key_manager.get_key('OPENAI_API_KEY')
        
        self.wake_detector = WakeWordDetector(
            wake_word=config.get('WAKE_WORD', 'hey helix'),
            provider=config.get('WAKE_PROVIDER', 'openwakeword'),
            event_bus=self.event_bus
        )
        self.vad = VADDetector()
        self.stt = SpeechToText(
            provider=config.get('STT_PROVIDER', 'openai'),
            api_key=openai_key
        )
        self.tts = TextToSpeech(
            provider=config.get('TTS_PROVIDER', 'openai'),
            api_key=openai_key
        )
        
        self.event_bus.on("VOICE_WAKE", lambda data: self._on_wake_word(data.get("phrase", "")))

    async def start(self):
        if not self.enabled or self._is_active:
            return
        self._is_active = True
        await self.wake_detector.start()
        logger.info("VoiceEngine started.")

    async def stop(self):
        self._is_active = False
        await self.wake_detector.stop()
        if self._task:
            self._task.cancel()
        logger.info("VoiceEngine stopped.")

    def is_active(self) -> bool:
        return self._is_active

    async def speak(self, text: str):
        if not self.enabled:
            return
        self.state = VoiceState.SPEAKING
        try:
            await self.tts.speak(text)
        except Exception as e:
            logger.error(f"VoiceEngine speak error: {e}")
            self.state = VoiceState.ERROR
        finally:
            self.state = VoiceState.IDLE

    def _on_wake_word(self, phrase: str):
        if self.state != VoiceState.IDLE:
            return
        self.state = VoiceState.WAKE_DETECTED
        logger.info(f"Wake word '{phrase}' detected. Transitioning to LISTENING.")
        self._task = asyncio.create_task(self._handle_interaction())

    async def _handle_interaction(self):
        try:
            self.state = VoiceState.LISTENING
            transcription = await self._listen_and_transcribe()
            if transcription:
                self._on_transcription(transcription)
        except Exception as e:
            logger.error(f"Error during interaction: {e}")
            self.state = VoiceState.ERROR
        finally:
            self.state = VoiceState.IDLE

    async def _audio_generator(self, p, stream, frame_size):
        while self.state == VoiceState.LISTENING:
            try:
                data = await asyncio.to_thread(stream.read, frame_size, exception_on_overflow=False)
                yield data
            except Exception as e:
                logger.error(f"Audio stream read error: {e}")
                break

    async def _listen_and_transcribe(self) -> str:
        p = pyaudio.PyAudio()
        try:
            stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=self.vad.frame_size)
            logger.info("Listening for speech...")
            
            gen = self._audio_generator(p, stream, self.vad.frame_size)
            audio_bytes = await self.vad.collect_speech(gen)
            
            stream.stop_stream()
            stream.close()
            
            if not audio_bytes:
                logger.info("No speech detected.")
                return ""
                
            self.state = VoiceState.TRANSCRIBING
            logger.info("Transcribing audio...")
            text = await self.stt.transcribe(audio_bytes)
            return text
        finally:
            p.terminate()

    def _on_transcription(self, text: str):
        logger.info(f"Transcription: {text}")
        if self.event_bus:
            self.event_bus.emit("VOICE_COMMAND", {"text": text})
