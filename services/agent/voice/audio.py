"""Local audio primitives: PCM conversion, streaming VAD and server audio I/O.

All helpers operate on memory buffers.  No audio is written to disk by the
voice session; the only temporary file is created internally by the existing
speech-to-text adapter and deleted immediately after transcription.
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import logging
import math
import struct
import wave
from collections import deque
from dataclasses import dataclass
from typing import Callable, Deque, Iterable, Optional

logger = logging.getLogger(__name__)

VOICE_SAMPLE_RATE = 16_000
VOICE_SAMPLE_WIDTH = 2
VOICE_CHANNELS = 1
FRAME_MS = 30
FRAME_SAMPLES = VOICE_SAMPLE_RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * VOICE_SAMPLE_WIDTH


# ---------------------------------------------------------------------------
# PCM / WAV helpers
# ---------------------------------------------------------------------------


def pcm16_duration_ms(pcm: bytes, sample_rate: int = VOICE_SAMPLE_RATE) -> float:
    if not pcm or sample_rate <= 0:
        return 0.0
    return (len(pcm) / (sample_rate * VOICE_SAMPLE_WIDTH)) * 1000.0


def pcm16_rms(pcm: bytes) -> float:
    """Return RMS in the 0..32768 range for little-endian PCM16."""
    count = len(pcm) // 2
    if count == 0:
        return 0.0
    try:
        import numpy as np

        samples = np.frombuffer(pcm[: count * 2], dtype="<i2").astype("float64")
        return float(math.sqrt(float((samples * samples).mean())))
    except Exception:
        total = 0.0
        for (sample,) in struct.iter_unpack("<h", pcm[: count * 2]):
            total += float(sample) * float(sample)
        return math.sqrt(total / count)


def pcm16_peak(pcm: bytes) -> float:
    count = len(pcm) // 2
    if count == 0:
        return 0.0
    try:
        import numpy as np

        return float(np.abs(np.frombuffer(pcm[: count * 2], dtype="<i2")).max())
    except Exception:
        return float(max((abs(sample) for (sample,) in struct.iter_unpack("<h", pcm[: count * 2])), default=0))


def resample_pcm16(
    pcm: bytes, source_rate: int, target_rate: int = VOICE_SAMPLE_RATE
) -> bytes:
    """Linear-interpolation mono PCM16 resampler.

    Voice audio is speech, not music; linear interpolation is adequate and
    avoids pulling in a native resampling dependency.
    """
    if source_rate == target_rate or not pcm:
        return pcm
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    try:
        import numpy as np

        samples = np.frombuffer(pcm, dtype="<i2").astype("float32")
        if samples.size == 0:
            return b""
        target_length = max(1, int(round(samples.size * target_rate / source_rate)))
        source_positions = np.linspace(0.0, samples.size - 1.0, num=target_length)
        left = np.floor(source_positions).astype("int64")
        right = np.minimum(left + 1, samples.size - 1)
        weight = (source_positions - left).astype("float32")
        mixed = samples[left] * (1.0 - weight) + samples[right] * weight
        return np.clip(np.rint(mixed), -32768, 32767).astype("<i2").tobytes()
    except Exception:
        sample_count = len(pcm) // 2
        if sample_count <= 1:
            return pcm
        source = struct.unpack(f"<{sample_count}h", pcm[: sample_count * 2])
        target_length = max(1, int(round(sample_count * target_rate / source_rate)))
        output = []
        for index in range(target_length):
            position = index * (sample_count - 1) / max(1, target_length - 1)
            left = int(position)
            right = min(left + 1, sample_count - 1)
            weight = position - left
            value = source[left] * (1.0 - weight) + source[right] * weight
            output.append(max(-32768, min(32767, int(round(value)))))
        return struct.pack(f"<{len(output)}h", *output)


def pcm16_to_wav(
    pcm: bytes,
    sample_rate: int = VOICE_SAMPLE_RATE,
    channels: int = 1,
    sample_width: int = VOICE_SAMPLE_WIDTH,
) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
    return buffer.getvalue()


def wav_to_pcm16(wav_bytes: bytes) -> tuple[bytes, int, int]:
    """Return ``(pcm, sample_rate, channels)`` for a PCM WAV payload."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        if wav_file.getcomptype() != "NONE":
            raise ValueError("Compressed WAV audio is not supported")
        if wav_file.getsampwidth() != VOICE_SAMPLE_WIDTH:
            raise ValueError("WAV audio must be 16-bit PCM")
        channels = wav_file.getnchannels()
        sample_rate = wav_file.getframerate()
        pcm = wav_file.readframes(wav_file.getnframes())
    return pcm, sample_rate, channels


def level_from_rms(rms: float, *, floor: float = 20.0, ceiling: float = 6000.0) -> float:
    """Map RMS to a perceptually useful 0..1 level for the visual nucleus."""
    if rms <= floor:
        return 0.0
    normalized = (rms - floor) / max(1.0, ceiling - floor)
    return max(0.0, min(1.0, math.sqrt(max(0.0, normalized))))


class AudioLevelMeter:
    """Smoothed RMS meter used by the reactive visual and CLI waveform."""

    def __init__(self, attack: float = 0.55, decay: float = 0.12) -> None:
        self.attack = attack
        self.decay = decay
        self.level = 0.0
        self.peak = 0.0

    def update(self, pcm: bytes) -> float:
        value = level_from_rms(pcm16_rms(pcm))
        coefficient = self.attack if value > self.level else self.decay
        self.level = self.level + (value - self.level) * coefficient
        self.peak = max(self.peak * 0.96, value)
        return round(self.level, 4)


# ---------------------------------------------------------------------------
# Streaming VAD / utterance segmentation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Utterance:
    pcm: bytes
    duration_ms: float
    reason: str
    speech_ratio: float


class StreamingVAD:
    """Energy + optional WebRTC VAD with pre-roll and silence hangover.

    The class consumes arbitrarily sized PCM chunks and emits complete
    utterances.  It is deterministic and does not depend on a microphone, so it
    is used for both streamed desktop/mobile audio and CLI server audio.
    """

    def __init__(
        self,
        *,
        sample_rate: int = VOICE_SAMPLE_RATE,
        frame_ms: int = FRAME_MS,
        silence_ms: int = 1_000,
        min_speech_ms: int = 200,
        max_utterance_ms: int = 30_000,
        pre_roll_ms: int = 240,
        min_speech_rms: float = 320.0,
        aggressiveness: int = 2,
        vad_threshold: Optional[float] = None,
    ) -> None:
        if sample_rate not in {8_000, 16_000, 32_000, 48_000}:
            raise ValueError("StreamingVAD supports 8/16/32/48 kHz audio")
        if frame_ms not in {10, 20, 30}:
            raise ValueError("frame_ms must be 10, 20 or 30")
        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.frame_samples = sample_rate * frame_ms // 1000
        self.frame_bytes = self.frame_samples * VOICE_SAMPLE_WIDTH
        self.silence_frames = max(1, int(math.ceil(silence_ms / frame_ms)))
        self.min_speech_frames = max(1, int(round(min_speech_ms / frame_ms)))
        self.max_frames = max(1, int(round(max_utterance_ms / frame_ms)))
        self.pre_roll_frames = max(0, int(round(pre_roll_ms / frame_ms)))
        self.min_speech_rms = max(1.0, float(min_speech_rms))
        if vad_threshold is not None:
            # A client setting of 0..1 maps onto a useful RMS band.
            self.min_speech_rms = max(60.0, min(4000.0, float(vad_threshold) * 4000.0))
        self._pre_roll: Deque[bytes] = deque(maxlen=self.pre_roll_frames)
        self._residual = b""
        self._frames: list[bytes] = []
        self._speaking = False
        self._silence_run = 0
        self._speech_frames = 0
        self._noise_floor = self.min_speech_rms * 0.35
        self._vad = None
        if importlib.util.find_spec("webrtcvad") is not None:
            try:
                import webrtcvad

                self._vad = webrtcvad.Vad(max(0, min(3, int(aggressiveness))))
            except Exception as error:  # pragma: no cover - optional native module
                logger.warning("WebRTC VAD unavailable, using energy detection: %s", error)

    @property
    def speaking(self) -> bool:
        return self._speaking

    @property
    def noise_floor(self) -> float:
        return self._noise_floor

    def _frame_is_speech(self, frame: bytes) -> tuple[bool, float]:
        rms = pcm16_rms(frame)
        threshold = max(self.min_speech_rms, self._noise_floor * 2.2)
        energy_ok = rms >= threshold
        if not energy_ok:
            # Adapt only while clearly silent.  Loud continuous noise raises the
            # floor slowly enough that speech still crosses it.
            self._noise_floor = self._noise_floor * 0.995 + rms * 0.005
            return False, rms
        if self._vad is not None:
            try:
                return bool(self._vad.is_speech(frame, self.sample_rate)), rms
            except Exception as error:
                logger.warning(
                    "WebRTC VAD failed; using energy detection: %s", error
                )
                self._vad = None
        return True, rms

    def feed(self, pcm: bytes) -> list[Utterance]:
        if not pcm:
            return []
        data = self._residual + pcm
        utterances: list[Utterance] = []
        offset = 0
        while offset + self.frame_bytes <= len(data):
            frame = data[offset : offset + self.frame_bytes]
            offset += self.frame_bytes
            utterance = self._consume_frame(frame)
            if utterance is not None:
                utterances.append(utterance)
        self._residual = data[offset:]
        return utterances

    def _consume_frame(self, frame: bytes) -> Optional[Utterance]:
        is_speech, _rms = self._frame_is_speech(frame)
        if not self._speaking:
            if not is_speech:
                self._pre_roll.append(frame)
                return None
            self._speaking = True
            self._frames = list(self._pre_roll)
            self._pre_roll.clear()
            self._frames.append(frame)
            self._silence_run = 0
            self._speech_frames = 1
            return None

        self._frames.append(frame)
        if is_speech:
            self._speech_frames += 1
            self._silence_run = 0
        else:
            self._silence_run += 1

        if self._silence_run >= self.silence_frames:
            return self._finish("silence")
        if len(self._frames) >= self.max_frames:
            return self._finish("max_duration")
        return None

    def _finish(self, reason: str) -> Optional[Utterance]:
        frames = self._frames
        speech_frames = self._speech_frames
        if reason == "silence" and self._silence_run:
            frames = frames[:-self._silence_run]
        self._frames = []
        self._speaking = False
        self._silence_run = 0
        self._speech_frames = 0
        if speech_frames < self.min_speech_frames:
            self._pre_roll.clear()
            return None
        pcm = b"".join(frames)
        duration = pcm16_duration_ms(pcm, self.sample_rate)
        ratio = min(1.0, speech_frames / max(1, len(frames)))
        return Utterance(
            pcm=pcm,
            duration_ms=round(duration, 1),
            reason=reason,
            speech_ratio=round(ratio, 3),
        )

    def flush(self) -> Optional[Utterance]:
        """Finish any in-progress utterance, e.g. when the client stops."""
        if not self._speaking:
            self._pre_roll.clear()
            self._residual = b""
            return None
        return self._finish("flush")

    def reset(self) -> None:
        self._pre_roll.clear()
        self._residual = b""
        self._frames = []
        self._speaking = False
        self._silence_run = 0
        self._speech_frames = 0


def split_utterance_frames(pcm: bytes, frame_bytes: int = FRAME_BYTES) -> Iterable[bytes]:
    for offset in range(0, len(pcm) - frame_bytes + 1, frame_bytes):
        yield pcm[offset : offset + frame_bytes]


# ---------------------------------------------------------------------------
# Optional server-side microphone / speaker for the CLI
# ---------------------------------------------------------------------------


class ServerAudioError(RuntimeError):
    pass


class ServerAudio:
    """Microphone/speaker bridge for a terminal that has no audio engine.

    The CLI asks the agent to use its local device.  This is opt-in; desktop
    and mobile always stream their own microphone audio.
    """

    def __init__(
        self,
        on_chunk: Callable[[bytes], None],
        *,
        sample_rate: int = VOICE_SAMPLE_RATE,
        block_ms: int = 30,
    ) -> None:
        if importlib.util.find_spec("sounddevice") is None:
            raise ServerAudioError(
                "Server audio requires the optional 'sounddevice' package."
            )
        self.on_chunk = on_chunk
        self.sample_rate = sample_rate
        self.block_ms = block_ms
        self._stream = None
        self._playing = False
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if self._stream is not None:
            return
        import sounddevice as sd

        blocksize = max(1, self.sample_rate * self.block_ms // 1000)

        def callback(indata, _frames, _time, status) -> None:
            if status:
                logger.debug("Server microphone status: %s", status)
            try:
                self.on_chunk(bytes(indata))
            except Exception:
                logger.exception("Server microphone callback failed")

        try:
            self._stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype="int16",
                blocksize=blocksize,
                callback=callback,
            )
            self._stream.start()
        except Exception as error:
            self._stream = None
            raise ServerAudioError(f"Could not open the microphone: {error}") from error

    def stop(self) -> None:
        stream = self._stream
        self._stream = None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                logger.debug("Could not close server microphone cleanly", exc_info=True)
        self.stop_playback()

    async def play_wav(self, wav_bytes: bytes) -> None:
        if not wav_bytes:
            return
        async with self._lock:
            self._playing = True
            try:
                await asyncio.to_thread(self._play_wav_sync, wav_bytes)
            finally:
                self._playing = False

    def _play_wav_sync(self, wav_bytes: bytes) -> None:
        import numpy as np
        import sounddevice as sd

        pcm, sample_rate, channels = wav_to_pcm16(wav_bytes)
        samples = np.frombuffer(pcm, dtype="<i2")
        if channels > 1:
            samples = samples.reshape(-1, channels)
        sd.play(samples, sample_rate, blocking=True)

    def stop_playback(self) -> None:
        if not self._playing:
            return
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:
            logger.debug("Could not stop server playback", exc_info=True)
        self._playing = False
