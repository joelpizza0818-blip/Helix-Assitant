import logging
import asyncio
import importlib.util
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "wakeword" / "hey_helix.onnx"


class WakeWordDetector:
    def __init__(
        self,
        wake_word: str = "hey helix",
        provider: str = "openwakeword",
        model_path: str | Path | None = None,
        event_bus=None,
        threshold: float = 0.05,
    ):
        self.wake_word = wake_word.lower()
        self.provider = provider
        self.event_bus = event_bus
        self.threshold = float(threshold)
        if not 0.0 <= self.threshold <= 1.0:
            raise ValueError("Wake word threshold must be between 0.0 and 1.0.")
        self._is_running = False
        self._task = None
        self._model = None
        self._audio_stream = None
        self.input_device = None
        configured_path = model_path or os.environ.get("WAKE_WORD_MODEL_PATH")
        self.model_path = Path(configured_path) if configured_path else DEFAULT_MODEL_PATH
        if not self.model_path.is_absolute():
            self.model_path = Path(__file__).resolve().parents[1] / self.model_path

        self._initialize_provider()

    def _initialize_provider(self):
        if self.provider != "openwakeword":
            logger.error("Unsupported wake word provider %r; this app uses OpenWakeWord.", self.provider)
            self.provider = None
            return
        if importlib.util.find_spec("openwakeword") is None:
            logger.error("openwakeword is not installed. Wake word detection is unavailable.")
            self.provider = None
            return
        if not self.model_path.is_file():
            logger.error(
                "Custom wake word model for %r was not found: %s. Train the model before enabling voice activation.",
                self.wake_word,
                self.model_path,
            )
            self.provider = None
            return

        from openwakeword.model import Model
        from openwakeword.utils import download_models

        download_models(model_names=[])
        self._model = Model(
            wakeword_models=[str(self.model_path)],
            inference_framework="onnx",
        )
        model_phrase = self.model_path.stem.lower().replace("_", " ")
        phrase_matches_model = model_phrase == self.wake_word
        logger.info(
            "WAKE_WORD_MODEL_LOADED phrase=%r model=%s threshold=%.3f "
            "phrase_matches_model=%s",
            self.wake_word,
            self.model_path.name,
            self.threshold,
            phrase_matches_model,
        )
        if not phrase_matches_model:
            logger.warning(
                "Configured wake phrase %r does not match model filename %r; "
                "verify the ONNX model was trained for the configured phrase.",
                self.wake_word,
                model_phrase,
            )

    async def start(self):
        if not self.provider:
            logger.warning("No wake word provider initialized. Cannot start.")
            return
        
        if self._is_running:
            return

        try:
            import sounddevice as sd

            default_devices = sd.default.device
            default_input = default_devices[0] if default_devices else None
            if default_input is not None and default_input < 0:
                default_input = None
            device_info = sd.query_devices(
                device=default_input,
                kind="input",
            )
            self.input_device = int(device_info["index"])
            logger.info(
                "VOICE_AUDIO_DEVICE_SELECTED stage=wake_word index=%d name=%r "
                "max_input_channels=%d default_sample_rate=%s "
                "requested_sample_rate=16000 channels=1 format=int16",
                self.input_device,
                device_info["name"],
                device_info["max_input_channels"],
                device_info["default_samplerate"],
            )
            self._audio_stream = sd.RawInputStream(
                device=self.input_device,
                channels=1,
                samplerate=16000,
                dtype="int16",
                blocksize=1280,
            )
            self._audio_stream.start()
            self._is_running = True
            self._task = asyncio.create_task(self._listen_loop())
            logger.info(
                "Wake word detector started with provider %s",
                self.provider,
            )
            logger.info(
                "VOICE_AUDIO_STREAM_STARTED stage=wake_word device=%s "
                "sample_rate=%s channels=%s dtype=%s blocksize=%s",
                self._audio_stream.device,
                self._audio_stream.samplerate,
                self._audio_stream.channels,
                self._audio_stream.dtype,
                self._audio_stream.blocksize,
            )
        except Exception as e:
            logger.exception("Failed to open wake-word microphone: %s", e)
            self._is_running = False
            if self._audio_stream:
                try:
                    self._audio_stream.close()
                except Exception:
                    logger.exception("Failed to close wake-word audio stream.")
                self._audio_stream = None

    async def stop(self):
        self._is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        
        if self._audio_stream:
            if self._audio_stream.active:
                self._audio_stream.stop()
            self._audio_stream.close()
            self._audio_stream = None

        if self._model:
            self._model.reset()

        logger.info("Wake word detector stopped")

    def is_running(self) -> bool:
        return self._is_running and self._task is not None and not self._task.done()

    async def _on_wake(self, model_output=None, score=None):
        logger.info(
            "WAKE_WORD_DETECTED phrase=%r model_output=%r score=%s",
            self.wake_word,
            model_output,
            f"{score:.3f}" if isinstance(score, (int, float)) else "unknown",
        )
        if self.event_bus:
            await self.event_bus.publish("VOICE_WAKE", {"phrase": self.wake_word})

    async def _listen_loop(self):
        import numpy as np
        loop = asyncio.get_running_loop()
        frames_received = 0
        last_report = loop.time()
        listening_logged = False
        interval_max_score = 0.0
        interval_max_rms = 0.0
        interval_output = "none"
        try:
            while self._is_running:
                pcm, overflowed = await asyncio.to_thread(
                    self._audio_stream.read,
                    1280,
                )
                frames_received += 1
                if not listening_logged:
                    logger.info(
                        "WAKE_WORD_LISTENING device=%s sample_rate=16000 "
                        "channels=1 format=int16 frame_samples=1280 frame_bytes=%d "
                        "threshold=%.3f",
                        self.input_device,
                        len(pcm),
                        self.threshold,
                    )
                    logger.info(
                        "VOICE_AUDIO_FRAME_RECEIVED stage=wake_word frames_total=1 "
                        "samples=%d bytes=%d",
                        len(pcm) // 2,
                        len(pcm),
                    )
                    listening_logged = True
                if overflowed:
                    logger.warning("Audio input overflowed while detecting the wake word.")
                audio = np.frombuffer(pcm, dtype=np.int16)
                if audio.size:
                    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))
                    interval_max_rms = max(interval_max_rms, rms)
                prediction = self._model.predict(audio)
                if prediction:
                    model_output, score = max(
                        prediction.items(),
                        key=lambda item: float(item[1]),
                    )
                    score = float(score)
                    if score >= interval_max_score:
                        interval_max_score = score
                        interval_output = str(model_output)
                    if score > self.threshold:
                        await self._on_wake(model_output, score)
                        await asyncio.sleep(2.0)
                now = loop.time()
                if now - last_report >= 5.0:
                    logger.info(
                        "WAKE_WORD_LISTENING_HEALTH frames_total=%d interval_seconds=%.1f "
                        "model_output=%s max_score=%.3f threshold=%.3f max_rms=%.1f",
                        frames_received,
                        now - last_report,
                        interval_output,
                        interval_max_score,
                        self.threshold,
                        interval_max_rms,
                    )
                    last_report = now
                    interval_max_score = 0.0
                    interval_max_rms = 0.0
                    interval_output = "none"
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception("Wake word listen loop failed: %s", e)
            self._is_running = False
