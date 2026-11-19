"""Local-only STT/TTS adapters.

Defaults are deliberately $0 and offline:

* STT: faster-whisper with a cached local model (the existing HELIX adapter).
* TTS: Windows SAPI (built into Windows) or espeak-ng/Piper when installed.

Paid cloud providers are never selected by the voice session, even if the
desktop settings contain an Edge/OpenAI/ElevenLabs preference.  Those settings
remain available for the legacy wake-word voice engine.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable

from .audio import VOICE_SAMPLE_RATE, resample_pcm16
from .response_filter import filter_for_speech

logger = logging.getLogger(__name__)


class VoiceProviderError(RuntimeError):
    """A local speech provider is missing or failed."""


@runtime_checkable
class SpeechToTextProvider(Protocol):
    async def transcribe_pcm16(
        self, pcm: bytes, sample_rate: int = VOICE_SAMPLE_RATE, language: Optional[str] = None
    ) -> str: ...

    async def warmup(self) -> None: ...

    @property
    def name(self) -> str: ...


@runtime_checkable
class TextToSpeechProvider(Protocol):
    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes: ...

    @property
    def name(self) -> str: ...


class LocalWhisperSTT:
    """Offline faster-whisper adapter over the existing HELIX STT class."""

    def __init__(self, model: str = "base") -> None:
        try:
            from ..perception.speech_to_text import SpeechToText
        except ImportError:
            from services.agent.perception.speech_to_text import SpeechToText

        self._stt = SpeechToText("whisper_local", model=model)
        self._model_name = model
        self._warmup_lock = asyncio.Lock()

    @property
    def name(self) -> str:
        backend = getattr(self._stt, "_local_backend", None) or "unavailable"
        return f"faster-whisper:{self._model_name}:{backend}"

    @property
    def available(self) -> bool:
        return getattr(self._stt, "_local_backend", None) is not None

    async def warmup(self) -> None:
        async with self._warmup_lock:
            try:
                await self._stt.warmup()
            except Exception as error:
                logger.warning("Local STT warmup failed: %s", error)

    async def transcribe_pcm16(
        self, pcm: bytes, sample_rate: int = VOICE_SAMPLE_RATE, language: Optional[str] = None
    ) -> str:
        if not pcm:
            return ""
        normalized = (
            pcm if sample_rate == VOICE_SAMPLE_RATE else resample_pcm16(pcm, sample_rate)
        )
        try:
            direct = getattr(self._stt, "transcribe_pcm16", None)
            if direct is not None:
                text = await direct(
                    normalized,
                    sample_rate=VOICE_SAMPLE_RATE,
                    language=language,
                    beam_size=1,
                    low_latency=True,
                )
            else:
                text = await self._stt.transcribe(normalized, language=language)
        except Exception as error:
            raise VoiceProviderError(f"Local speech recognition failed: {error}") from error
        return (text or "").strip()


class _TempWavResult:
    def __init__(self, path: str) -> None:
        self.path = path

    def read_and_delete(self) -> bytes:
        try:
            with open(self.path, "rb") as handle:
                return handle.read()
        finally:
            try:
                os.remove(self.path)
            except OSError:
                pass


def _new_temp_wav_path() -> str:
    descriptor, path = tempfile.mkstemp(prefix="helix_voice_", suffix=".wav")
    os.close(descriptor)
    return path


class WindowsSapiTTS:
    """Windows built-in SAPI voice, synthesized to an in-memory WAV."""

    def __init__(self, rate: int = 0, volume: int = 100) -> None:
        self.rate = max(-10, min(10, int(rate)))
        self.volume = max(0, min(100, int(volume)))
        self._available = (
            os.name == "nt" and importlib.util.find_spec("win32com") is not None
        )

    @property
    def name(self) -> str:
        return "windows-sapi"

    @property
    def available(self) -> bool:
        return self._available

    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes:
        filtered = filter_for_speech(text).text
        if not filtered:
            raise VoiceProviderError("There is no speakable text after code filtering.")
        if not self._available:
            raise VoiceProviderError(
                "Windows SAPI is unavailable. Install pywin32 or use espeak-ng/Piper."
            )
        return await asyncio.to_thread(self._synthesize_sync, filtered, voice_id)

    def _synthesize_sync(self, text: str, voice_id: Optional[str]) -> bytes:
        import pythoncom
        import win32com.client

        path = _new_temp_wav_path()
        result = _TempWavResult(path)
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            speaker.Rate = self.rate
            speaker.Volume = self.volume
            if voice_id:
                self._select_voice(speaker, voice_id)
            stream = win32com.client.Dispatch("SAPI.SpFileStream")
            # SSFMCreateForWrite = 3.  DoEvents=False makes Speak synchronous.
            stream.Open(path, 3, False)
            speaker.AudioOutputStream = stream
            speaker.Speak(text)
            stream.Close()
            wav = result.read_and_delete()
            if not wav:
                raise VoiceProviderError("Windows SAPI produced an empty audio file.")
            return wav
        except Exception as error:
            result.read_and_delete()
            raise VoiceProviderError(f"Windows SAPI synthesis failed: {error}") from error
        finally:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass

    @staticmethod
    def _select_voice(speaker, voice_id: str) -> None:
        try:
            voices = speaker.GetVoices()
        except Exception:
            return
        wanted = voice_id.strip()
        if wanted.isdigit():
            index = int(wanted)
            if 0 <= index < voices.Count:
                speaker.Voice = voices.Item(index)
                return
        lowered = wanted.casefold()
        for index in range(voices.Count):
            token = voices.Item(index)
            try:
                description = str(token.GetDescription())
            except Exception:
                description = ""
            if lowered and lowered in description.casefold():
                speaker.Voice = token
                return


class Pyttsx3TTS:
    """Cross-platform fallback using pyttsx3's file writer."""

    def __init__(self) -> None:
        self._available = importlib.util.find_spec("pyttsx3") is not None

    @property
    def name(self) -> str:
        return "pyttsx3"

    @property
    def available(self) -> bool:
        return self._available

    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes:
        filtered = filter_for_speech(text).text
        if not filtered:
            raise VoiceProviderError("There is no speakable text after code filtering.")
        if not self._available:
            raise VoiceProviderError("pyttsx3 is not installed.")
        return await asyncio.to_thread(self._synthesize_sync, filtered, voice_id)

    def _synthesize_sync(self, text: str, voice_id: Optional[str]) -> bytes:
        import pyttsx3

        path = _new_temp_wav_path()
        result = _TempWavResult(path)
        engine = None
        try:
            engine = pyttsx3.init()
            if voice_id:
                try:
                    engine.setProperty("voice", voice_id)
                except Exception:
                    logger.debug("Requested pyttsx3 voice is unavailable")
            engine.save_to_file(text, path)
            engine.runAndWait()
            wav = result.read_and_delete()
            if not wav:
                raise VoiceProviderError("pyttsx3 produced an empty audio file.")
            return wav
        except Exception as error:
            result.read_and_delete()
            raise VoiceProviderError(f"pyttsx3 synthesis failed: {error}") from error
        finally:
            try:
                if engine is not None:
                    engine.stop()
            except Exception:
                pass


class EspeakTTS:
    """Linux/macOS fallback when espeak-ng is installed."""

    def __init__(self) -> None:
        self.binary = shutil.which("espeak-ng") or shutil.which("espeak")

    @property
    def name(self) -> str:
        return "espeak-ng" if self.binary else "espeak-unavailable"

    @property
    def available(self) -> bool:
        return bool(self.binary)

    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes:
        filtered = filter_for_speech(text).text
        if not filtered:
            raise VoiceProviderError("There is no speakable text after code filtering.")
        if not self.binary:
            raise VoiceProviderError(
                "espeak-ng is not installed. Install it with your package manager."
            )
        return await asyncio.to_thread(self._synthesize_sync, filtered, voice_id)

    def _synthesize_sync(self, text: str, voice_id: Optional[str]) -> bytes:
        import subprocess

        path = _new_temp_wav_path()
        result = _TempWavResult(path)
        command = [self.binary, "-w", path]
        if voice_id:
            command.extend(["-v", voice_id])
        command.append(text)
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=45,
                check=False,
            )
            if completed.returncode != 0:
                raise VoiceProviderError(
                    f"espeak-ng failed: {completed.stderr.strip()[:300]}"
                )
            wav = result.read_and_delete()
            if not wav:
                raise VoiceProviderError("espeak-ng produced an empty audio file.")
            return wav
        except Exception as error:
            result.read_and_delete()
            if isinstance(error, VoiceProviderError):
                raise
            raise VoiceProviderError(f"espeak-ng synthesis failed: {error}") from error


class PiperTTS:
    """Optional fully-offline neural voice (binary + local model required)."""

    def __init__(self, model_path: Optional[str] = None) -> None:
        self.binary = shutil.which("piper")
        self.model_path = model_path or os.environ.get("HELIX_PIPER_MODEL")

    @property
    def name(self) -> str:
        return "piper"

    @property
    def available(self) -> bool:
        return bool(
            self.binary
            and self.model_path
            and os.path.isfile(self.model_path)
        )

    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes:
        filtered = filter_for_speech(text).text
        if not filtered:
            raise VoiceProviderError("There is no speakable text after code filtering.")
        if not self.available:
            raise VoiceProviderError(
                "Piper requires the piper binary and HELIX_PIPER_MODEL pointing to a local .onnx model."
            )
        return await asyncio.to_thread(self._synthesize_sync, filtered)

    def _synthesize_sync(self, text: str) -> bytes:
        import subprocess

        path = _new_temp_wav_path()
        result = _TempWavResult(path)
        try:
            completed = subprocess.run(
                [self.binary, "--model", self.model_path, "--output_file", path],
                input=text,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if completed.returncode != 0:
                raise VoiceProviderError(
                    f"Piper failed: {completed.stderr.strip()[:300]}"
                )
            wav = result.read_and_delete()
            if not wav:
                raise VoiceProviderError("Piper produced an empty audio file.")
            return wav
        except Exception as error:
            result.read_and_delete()
            if isinstance(error, VoiceProviderError):
                raise
            raise VoiceProviderError(f"Piper synthesis failed: {error}") from error


class EdgeTTS:
    """Microsoft Edge neural TTS via the edge-tts package ($0, requires internet).

    Falls back gracefully when the package is missing or the network is offline.
    Streams audio internally and returns a complete WAV bytes object.
    """

    def __init__(self) -> None:
        self._available = importlib.util.find_spec("edge_tts") is not None

    @property
    def name(self) -> str:
        return "edge-tts"

    @property
    def available(self) -> bool:
        return self._available

    async def synthesize_wav(self, text: str, voice_id: Optional[str] = None) -> bytes:
        filtered = filter_for_speech(text).text
        if not filtered:
            raise VoiceProviderError("There is no speakable text after code filtering.")
        if not self._available:
            raise VoiceProviderError(
                "edge-tts is not installed. Install with: pip install edge-tts"
            )
        # Default voice: Dalia (es-MX) — natural Spanish neural voice
        effective_voice = voice_id or "es-MX-DaliaNeural"
        try:
            mp3_bytes = await self._stream_mp3(filtered, effective_voice)
            return self._mp3_to_wav(mp3_bytes)
        except VoiceProviderError:
            raise
        except Exception as error:
            raise VoiceProviderError(f"edge-tts synthesis failed: {error}") from error

    @staticmethod
    async def _stream_mp3(text: str, voice: str) -> bytes:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                chunks.append(chunk["data"])
        if not chunks:
            raise VoiceProviderError("edge-tts returned no audio data.")
        return b"".join(chunks)

    @staticmethod
    def _mp3_to_wav(mp3_bytes: bytes) -> bytes:
        """Convert MP3 → PCM16 WAV using pydub if available, else ffmpeg subprocess."""
        # Try pydub first
        try:
            from pydub import AudioSegment  # type: ignore
            import io as _io

            segment = AudioSegment.from_mp3(_io.BytesIO(mp3_bytes))
            segment = segment.set_frame_rate(VOICE_SAMPLE_RATE).set_channels(1).set_sample_width(2)
            buf = _io.BytesIO()
            segment.export(buf, format="wav")
            return buf.getvalue()
        except Exception:
            pass
        # Fallback: ffmpeg subprocess
        import subprocess, shutil as _shutil

        ffmpeg = _shutil.which("ffmpeg")
        if not ffmpeg:
            raise VoiceProviderError(
                "edge-tts MP3→WAV conversion requires pydub or ffmpeg. "
                "Install pydub: pip install pydub"
            )
        descriptor, mp3_path = tempfile.mkstemp(prefix="helix_etts_", suffix=".mp3")
        wav_path = mp3_path.replace(".mp3", ".wav")
        os.close(descriptor)
        try:
            with open(mp3_path, "wb") as fh:
                fh.write(mp3_bytes)
            result = subprocess.run(
                [ffmpeg, "-y", "-i", mp3_path, "-ar", str(VOICE_SAMPLE_RATE),
                 "-ac", "1", "-sample_fmt", "s16", wav_path],
                capture_output=True, timeout=30, check=False,
            )
            if result.returncode != 0:
                raise VoiceProviderError(
                    f"ffmpeg MP3→WAV failed: {result.stderr.decode()[:200]}"
                )
            with open(wav_path, "rb") as fh:
                return fh.read()
        finally:
            for p in (mp3_path, wav_path):
                try:
                    os.remove(p)
                except OSError:
                    pass


class TTSRouter:
    """Route TTS to the best available provider for the requested voice_id.

    Priority logic:
    - If the voice_id looks like an Edge neural voice (e.g. 'es-MX-DaliaNeural'),
      EdgeTTS is tried first; it falls back to the first local engine on failure.
      This mode exists only for legacy callers.
    - Otherwise: WindowsSAPI → Piper → Espeak → Pyttsx3.
    - EdgeTTS can be added as a last resort, but Live Voice disables it with
      ``allow_edge=False`` so no text ever leaves the machine.
    """

    # Known neural voice ID patterns from the UI catalog
    # Se compila una sola vez porque _is_edge_voice se evalúa en cada conexión.
    _EDGE_VOICE_RE = re.compile(
        r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$"
    )

    def __init__(
        self,
        providers: Optional[list] = None,
        voice_id: Optional[str] = None,
        *,
        allow_edge: bool = True,
    ) -> None:
        if providers is None:
            providers = [WindowsSapiTTS(), PiperTTS(), EspeakTTS(), Pyttsx3TTS()]
        self._local_providers = providers
        self._edge = EdgeTTS()
        self.voice_id = voice_id
        self._allow_edge = allow_edge

    def _is_edge_voice(self, voice_id: Optional[str]) -> bool:
        return bool(voice_id and self._EDGE_VOICE_RE.match(voice_id))

    @property
    def name(self) -> str:
        for provider in self._local_providers:
            if getattr(provider, "available", True):
                return provider.name
        return "unavailable"

    def available_provider(self):
        for provider in self._local_providers:
            if getattr(provider, "available", True):
                return provider
        return None

    async def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None
    ) -> bytes:
        effective_voice = voice_id or self.voice_id
        # Neural Edge voice requested → try Edge first, then local fallback
        if self._allow_edge and self._is_edge_voice(effective_voice) and self._edge.available:
            try:
                return await self._edge.synthesize_wav(text, effective_voice)
            except VoiceProviderError as edge_err:
                logger.warning("EdgeTTS failed for %s, falling back: %s", effective_voice, edge_err)
        # Local first (SAPI, Piper, espeak, pyttsx3)
        provider = self.available_provider()
        if provider is not None:
            local_voice = None if self._is_edge_voice(effective_voice) else effective_voice
            return await provider.synthesize_wav(text, local_voice)
        # Last resort: Edge (non-neural voice or generic fallback)
        if self._allow_edge and self._edge.available:
            return await self._edge.synthesize_wav(text, effective_voice)
        raise VoiceProviderError(
            "No local text-to-speech engine is available. Windows SAPI is built in; "
            "on Linux/macOS install espeak-ng or Piper."
        )


@dataclass(frozen=True)
class ProviderSummary:
    stt: str
    tts: str
    stt_local: bool
    tts_local: bool


def local_provider_summary(
    stt: Optional[SpeechToTextProvider], tts: Optional[TextToSpeechProvider]
) -> ProviderSummary:
    stt_name = getattr(stt, "name", "unavailable") if stt is not None else "unavailable"
    tts_name = getattr(tts, "name", "unavailable") if tts is not None else "unavailable"
    return ProviderSummary(
        stt=stt_name,
        tts=tts_name,
        stt_local=True,
        tts_local=True,
    )
