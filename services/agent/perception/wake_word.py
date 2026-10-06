import logging
import asyncio
import importlib.util
import struct

logger = logging.getLogger(__name__)

class WakeWordDetector:
    def __init__(self, wake_word: str, provider: str = 'openwakeword', access_key: str = None, event_bus=None):
        self.wake_word = wake_word.lower()
        self.provider = provider
        self.access_key = access_key
        self.event_bus = event_bus
        self._is_running = False
        self._task = None
        self._model = None
        self._audio_stream = None
        
        self._initialize_provider()

    def _initialize_provider(self):
        if self.provider == 'openwakeword':
            if importlib.util.find_spec('openwakeword') is None:
                logger.warning("openwakeword not installed. Wake word detection disabled.")
                self.provider = None
                return
            import openwakeword
            from openwakeword.model import Model
            openwakeword.utils.download_models()
            self._model = Model(wakeword_models=[self.wake_word], inference_framework="onnx")
        elif self.provider == 'porcupine':
            if importlib.util.find_spec('pvporcupine') is None:
                logger.warning("pvporcupine not installed. Wake word detection disabled.")
                self.provider = None
                return
            if not self.access_key:
                logger.warning("Porcupine requires an access key. Wake word detection disabled.")
                self.provider = None
                return
            import pvporcupine
            self._model = pvporcupine.create(access_key=self.access_key, keywords=[self.wake_word])
        else:
            logger.warning(f"Unknown wake word provider: {self.provider}")
            self.provider = None

    async def start(self):
        if not self.provider:
            logger.warning("No wake word provider initialized. Cannot start.")
            return
        
        if self._is_running:
            return

        import pyaudio
        self.pyaudio_instance = pyaudio.PyAudio()
        
        try:
            if self.provider == 'openwakeword':
                self._audio_stream = self.pyaudio_instance.open(
                    format=pyaudio.paInt16,
                    channels=1,
                    rate=16000,
                    input=True,
                    frames_per_buffer=1280
                )
            elif self.provider == 'porcupine':
                self._audio_stream = self.pyaudio_instance.open(
                    rate=self._model.sample_rate,
                    channels=1,
                    format=pyaudio.paInt16,
                    input=True,
                    frames_per_buffer=self._model.frame_length
                )
            self._is_running = True
            self._task = asyncio.create_task(self._listen_loop())
            logger.info(f"Wake word detector started with provider {self.provider}")
        except Exception as e:
            logger.error(f"Failed to open microphone: {e}")
            self._is_running = False

    async def stop(self):
        self._is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        
        if self._audio_stream:
            self._audio_stream.stop_stream()
            self._audio_stream.close()
        
        if hasattr(self, 'pyaudio_instance'):
            self.pyaudio_instance.terminate()
            
        logger.info("Wake word detector stopped")

    def is_running(self) -> bool:
        return self._is_running

    def _on_wake(self):
        logger.info("Wake word detected!")
        if self.event_bus:
            self.event_bus.emit("VOICE_WAKE", {"phrase": self.wake_word})

    async def _listen_loop(self):
        import numpy as np
        try:
            while self._is_running:
                if self.provider == 'openwakeword':
                    pcm = self._audio_stream.read(1280, exception_on_overflow=False)
                    audio = np.frombuffer(pcm, dtype=np.int16)
                    prediction = self._model.predict(audio)
                    for mdl, scores in prediction.items():
                        if scores > 0.5:
                            self._on_wake()
                            await asyncio.sleep(2.0)
                elif self.provider == 'porcupine':
                    pcm = self._audio_stream.read(self._model.frame_length, exception_on_overflow=False)
                    audio_frame = struct.unpack_from("h" * self._model.frame_length, pcm)
                    result = self._model.process(audio_frame)
                    if result >= 0:
                        self._on_wake()
                        await asyncio.sleep(2.0)
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in wake word listen loop: {e}")
            self._is_running = False
