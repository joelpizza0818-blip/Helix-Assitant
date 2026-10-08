import logging
import asyncio
import importlib.util
import os
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "wakeword" / "hey_helix.onnx"
DEFAULT_WAKE_WORD_THRESHOLD = 0.5
MIN_WAKE_WORD_THRESHOLD = 0.1
MAX_WAKE_WORD_THRESHOLD = 0.9
WAKE_WORD_CONFIRMATION_FRAMES = 3


class WakeWordDetector:
    AUDIO_HEARTBEAT_TIMEOUT_SECONDS = 15.0

    def __init__(
        self,
        wake_word: str = "hey helix",
        provider: str = "openwakeword",
        model_path: str | Path | None = None,
        event_bus=None,
        threshold: float = DEFAULT_WAKE_WORD_THRESHOLD,
        aliases: list[str] | None = None,
    ):
        self.wake_word = wake_word.lower()
        self.aliases = []
        for alias in aliases or []:
            if not isinstance(alias, str):
                continue
            normalized_alias = alias.strip().casefold()
            if not normalized_alias:
                continue
            if not re.fullmatch(r"[a-z0-9]+(?:[ -][a-z0-9]+)*", normalized_alias):
                logger.warning("Ignoring wake alias containing unsupported characters.")
                continue
            self.aliases.append(normalized_alias)
        self.provider = provider
        self.event_bus = event_bus
        self.threshold = float(threshold)
        if not MIN_WAKE_WORD_THRESHOLD <= self.threshold <= MAX_WAKE_WORD_THRESHOLD:
            raise ValueError(
                "Wake word threshold must be between "
                f"{MIN_WAKE_WORD_THRESHOLD} and {MAX_WAKE_WORD_THRESHOLD}."
            )
        self._is_running = False
        self._task = None
        self._model = None
        self._audio_stream = None
        self._last_frame_at = 0.0
        self.input_device = None
        configured_path = model_path or os.environ.get("WAKE_WORD_MODEL_PATH")
        self.model_path = Path(configured_path) if configured_path else DEFAULT_MODEL_PATH
        if not self.model_path.is_absolute():
            self.model_path = Path(__file__).resolve().parents[1] / self.model_path
        if configured_path is None or self.model_path == DEFAULT_MODEL_PATH:
            normalized_wake_word = self._normalize_model_output(self.wake_word)
            candidate_stems = [normalized_wake_word]
            if not normalized_wake_word.startswith("hey_"):
                candidate_stems.append(f"hey_{normalized_wake_word}")
            matching_model = next(
                (
                    self.model_path.parent / f"{stem}.onnx"
                    for stem in candidate_stems
                    if (self.model_path.parent / f"{stem}.onnx").is_file()
                ),
                None,
            )
            if matching_model is not None:
                self.model_path = matching_model
        self._model_paths: list[Path] = [self.model_path]
        self._expected_outputs: dict[str, str] = {}

        self._initialize_provider()

    @staticmethod
    def _normalize_model_output(value: str) -> str:
        return value.casefold().replace(" ", "_").replace("-", "_")

    def _initialize_provider(self):
        if self.provider != "openwakeword":
            logger.error("Unsupported wake word provider %r; this app uses OpenWakeWord.", self.provider)
            self.provider = None
            return
        if importlib.util.find_spec("openwakeword") is None:
            logger.error("openwakeword is not installed. Wake word detection is unavailable.")
            self.provider = None
            return
        for alias in self.aliases:
            alias_path = self.model_path.parent / f"{self._normalize_model_output(alias)}.onnx"
            if alias_path.is_file() and alias_path not in self._model_paths:
                self._model_paths.append(alias_path)
            else:
                logger.warning(
                    "Wake alias %r has no matching OpenWakeWord model at %s; it cannot activate HELIX until the model exists.",
                    alias,
                    alias_path,
                )

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
            wakeword_models=[str(path) for path in self._model_paths],
            inference_framework="onnx",
        )
        self._expected_outputs = {
            self._normalize_model_output(path.stem): path.stem.lower().replace("_", " ")
            for path in self._model_paths
        }
        model_phrase = self.model_path.stem.lower().replace("_", " ")
        normalized_model_phrase = self._normalize_model_output(model_phrase)
        normalized_wake_word = self._normalize_model_output(self.wake_word)
        phrase_matches_model = (
            normalized_model_phrase == normalized_wake_word
            or (
                normalized_model_phrase == f"hey_{normalized_wake_word}"
                and normalized_wake_word == "helix"
            )
        )
        logger.info(
            "WAKE_WORD_MODEL_LOADED phrase=%r models=%s threshold=%.3f "
            "phrase_matches_model=%s",
            self.wake_word,
            [path.name for path in self._model_paths],
            self.threshold,
            phrase_matches_model,
        )
        if not phrase_matches_model:
            logger.error(
                "Configured wake phrase %r does not match model filename %r; "
                "voice activation is unavailable until a matching ONNX model is selected.",
                self.wake_word,
                model_phrase,
            )
            self._model = None
            self.provider = None

    async def start(self):
        if not self.provider:
            logger.warning("No wake word provider initialized. Cannot start.")
            return
        
        if self.is_running():
            return

        try:
            if self._task is not None or self._audio_stream is not None:
                await self.stop()
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
            self._last_frame_at = time.monotonic()
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
        task = self._task
        self._task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        stream = self._audio_stream
        self._audio_stream = None
        if stream:
            try:
                if stream.active:
                    stream.stop()
            finally:
                stream.close()

        if self._model:
            self._model.reset()

        logger.info("Wake word detector stopped")

    def is_running(self) -> bool:
        return (
            self._is_running
            and self._task is not None
            and not self._task.done()
            and time.monotonic() - self._last_frame_at
            < self.AUDIO_HEARTBEAT_TIMEOUT_SECONDS
        )

    async def _on_wake(self, model_output=None, score=None):
        expected_outputs = getattr(self, "_expected_outputs", None)
        if not isinstance(expected_outputs, dict):
            legacy_output = getattr(self, "_expected_model_output", None)
            expected_outputs = (
                {legacy_output: self.wake_word}
                if isinstance(legacy_output, str)
                else {}
            )
        normalized_output = self._normalize_model_output(str(model_output))
        phrase = expected_outputs.get(normalized_output, self.wake_word)
        logger.info(
            "WAKE_WORD_DETECTED phrase=%r model_output=%r score=%s",
            phrase,
            model_output,
            f"{score:.3f}" if isinstance(score, (int, float)) else "unknown",
        )
        if self.event_bus:
            await self.event_bus.publish("VOICE_WAKE", {"phrase": phrase})

    async def _listen_loop(self):
        import numpy as np
        loop = asyncio.get_running_loop()
        frames_received = 0
        last_report = loop.time()
        listening_logged = False
        interval_max_score = 0.0
        interval_max_rms = 0.0
        interval_output = "none"
        consecutive_matches = 0
        wake_reported = False
        try:
            while self._is_running:
                pcm, overflowed = await asyncio.to_thread(
                    self._audio_stream.read,
                    1280,
                )
                self._last_frame_at = time.monotonic()
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
                if prediction and not wake_reported:
                    expected_outputs = getattr(self, "_expected_outputs", None)
                    if not isinstance(expected_outputs, dict):
                        legacy_output = getattr(
                            self, "_expected_model_output", None
                        )
                        expected_outputs = (
                            {legacy_output: self.wake_word}
                            if isinstance(legacy_output, str)
                            else {}
                        )
                    scored_outputs = [
                        (self._normalize_model_output(str(model_output)), float(score))
                        for model_output, score in prediction.items()
                        if self._normalize_model_output(str(model_output)) in expected_outputs
                    ]
                    matched_output, score = max(scored_outputs, key=lambda item: item[1], default=("", 0.0))
                    if score >= interval_max_score:
                        interval_max_score = score
                        interval_output = matched_output or "none"
                    if score >= self.threshold:
                        consecutive_matches += 1
                        if consecutive_matches >= WAKE_WORD_CONFIRMATION_FRAMES:
                            wake_reported = True
                            await self._on_wake(
                                matched_output,
                                score,
                            )
                    else:
                        consecutive_matches = 0
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
