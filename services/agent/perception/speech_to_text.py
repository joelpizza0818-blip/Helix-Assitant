import logging
import asyncio
import importlib.util
import os
import tempfile
import wave

logger = logging.getLogger(__name__)

class SpeechToText:
    @staticmethod
    def check_ffmpeg() -> bool:
        import subprocess
        try:
            result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True, check=True)
            version_line = result.stdout.split('\n')[0]
            logger.info(f"FFmpeg found: {version_line}")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

    def __init__(self, provider: str, model: str = 'whisper-1', api_key: str = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self._local_model = None
        self._local_backend = None
        self._model_load_lock = asyncio.Lock()
        
        if self.provider == 'openai' and not self.api_key:
            logger.warning("OpenAI key not available, falling back to whisper_local")
            self.provider = 'whisper_local'
            
        if self.provider == 'whisper_local':
            if importlib.util.find_spec('faster_whisper') is not None:
                self._local_backend = 'faster-whisper'
            elif importlib.util.find_spec('whisper') is not None:
                self._local_backend = 'openai-whisper'
                logger.warning(
                    "faster-whisper is not installed; using the slower openai-whisper backend."
                )
            else:
                logger.error(
                    "Neither faster-whisper nor openai-whisper is installed; "
                    "local speech recognition is unavailable."
                )
                self.provider = None
            if self._local_backend == 'openai-whisper':
                if not self.check_ffmpeg():
                    # Try to find ffmpeg in common winget install path
                    winget_path = os.path.expandvars(
                        r'%LOCALAPPDATA%\Microsoft\WinGet\Packages'
                    )
                    found_ffmpeg = None
                    if os.path.isdir(winget_path):
                        for entry in os.listdir(winget_path):
                            if 'FFmpeg' in entry or 'ffmpeg' in entry:
                                bin_dir = os.path.join(winget_path, entry)
                                # walk to find ffmpeg.exe
                                for root, dirs, files in os.walk(bin_dir):
                                    if 'ffmpeg.exe' in files:
                                        found_ffmpeg = root
                                        break
                                if found_ffmpeg:
                                    break
                    if found_ffmpeg:
                        # Add to PATH for this process
                        os.environ['PATH'] = found_ffmpeg + os.pathsep + os.environ.get('PATH', '')
                        logger.info(f'Added ffmpeg to PATH from winget: {found_ffmpeg}')
                    
                    if not self.check_ffmpeg():  # retry after PATH update
                        logger.warning(
                            'ffmpeg not found. Voice transcription for non-WAV files is unavailable. '
                            'Install with: winget install Gyan.FFmpeg'
                        )
                        # Do not set self.provider = None so standard WAVs can still be transcribed
                        pass
                
                
        logger.info(f"SpeechToText initialized with provider: {self.provider}")

    async def transcribe(self, audio_bytes: bytes, language: str = None) -> str:
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            with wave.open(tmp.name, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(audio_bytes)
            tmp_path = tmp.name

        try:
            return await self.transcribe_file(tmp_path, language=language)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    async def warmup(self) -> None:
        if self.provider == 'whisper_local':
            await self._get_local_model()

    async def _get_local_model(self):
        if self._local_model is not None:
            return self._local_model

        async with self._model_load_lock:
            if self._local_model is None:
                model_name = self.model if self.model != 'whisper-1' else 'base'
                if self._local_backend == 'faster-whisper':
                    from faster_whisper import WhisperModel

                    logger.info(
                        "STT_MODEL_LOAD_STARTED backend=faster-whisper model=%s "
                        "device=cpu compute_type=int8",
                        model_name,
                    )
                    self._local_model = await asyncio.to_thread(
                        WhisperModel,
                        model_name,
                        device="cpu",
                        compute_type="int8",
                    )
                else:
                    import whisper

                    logger.info(
                        "STT_MODEL_LOAD_STARTED backend=openai-whisper model=%s",
                        model_name,
                    )
                    self._local_model = await asyncio.to_thread(
                        whisper.load_model,
                        model_name,
                    )
                logger.info(
                    "STT_MODEL_LOAD_COMPLETED backend=%s model=%s",
                    self._local_backend,
                    model_name,
                )
        return self._local_model

    async def transcribe_file(self, file_path: str, language: str = None) -> str:
        if self.provider == 'openai':
            try:
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=self.api_key)
                with open(file_path, 'rb') as audio_file:
                    transcript = await client.audio.transcriptions.create(
                        model=self.model,
                        file=audio_file
                    )
                return transcript.text
            except Exception as e:
                logger.error(f"OpenAI STT error: {e}")
                raise RuntimeError("OpenAI speech transcription failed") from e
                
        elif self.provider == 'whisper_local':
            try:
                model = await self._get_local_model()
                audio = self._read_pcm_wav(file_path)
                if audio is None:
                    if (
                        self._local_backend != 'faster-whisper'
                        and not self.check_ffmpeg()
                    ):
                        raise RuntimeError(
                            "This audio file is not 16 kHz mono PCM WAV and ffmpeg is unavailable."
                        )
                    audio = file_path
                if self._local_backend == 'faster-whisper':
                    return await asyncio.to_thread(
                        self._transcribe_faster_whisper,
                        model,
                        audio,
                        language,
                    )
                result = await asyncio.to_thread(
                    model.transcribe,
                    audio,
                    **({"language": language} if language else {}),
                )
                return result.get('text', '').strip()
            except Exception as e:
                logger.error(f"Local Whisper STT error: {e}")
                raise RuntimeError("Local Whisper speech transcription failed") from e
                
        elif self.provider == 'system':
            raise RuntimeError(
                "System speech recognition is not implemented; use whisper_local or openai."
            )
        
        raise RuntimeError("No speech-to-text provider is available.")

    @staticmethod
    def _transcribe_faster_whisper(model, audio, language: str = None) -> str:
        options = {"beam_size": 5}
        if language:
            options["language"] = language
        segments, _ = model.transcribe(audio, **options)
        return " ".join(segment.text.strip() for segment in segments).strip()

    @staticmethod
    def _read_pcm_wav(file_path: str):
        try:
            with wave.open(file_path, 'rb') as audio_file:
                if (
                    audio_file.getcomptype() != 'NONE'
                    or audio_file.getnchannels() != 1
                    or audio_file.getsampwidth() != 2
                    or audio_file.getframerate() != 16000
                ):
                    return None
                frames = audio_file.readframes(audio_file.getnframes())
        except (wave.Error, EOFError):
            return None

        if not frames:
            raise ValueError("WAV audio contains no samples")

        import numpy as np

        return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
