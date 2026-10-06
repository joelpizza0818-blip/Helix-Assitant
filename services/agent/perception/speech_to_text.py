import logging
import asyncio
import importlib.util
import os
import tempfile
import wave

logger = logging.getLogger(__name__)

class SpeechToText:
    def __init__(self, provider: str, model: str = 'whisper-1', api_key: str = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self._local_model = None
        
        if self.provider == 'openai' and not self.api_key:
            logger.warning("OpenAI key not available, falling back to whisper_local")
            self.provider = 'whisper_local'
            
        if self.provider == 'whisper_local':
            if importlib.util.find_spec('whisper') is None:
                logger.warning("openai-whisper not installed, falling back to system STT")
                self.provider = 'system'
            else:
                import whisper
                self._local_model = whisper.load_model(self.model if self.model != 'whisper-1' else 'base')
                
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
            return await self.transcribe_file(tmp_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    async def transcribe_file(self, file_path: str) -> str:
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
                return ""
                
        elif self.provider == 'whisper_local':
            try:
                result = await asyncio.to_thread(self._local_model.transcribe, file_path)
                return result.get('text', '').strip()
            except Exception as e:
                logger.error(f"Local Whisper STT error: {e}")
                return ""
                
        elif self.provider == 'system':
            try:
                import win32com.client
                recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
                logger.warning("System STT via SAPI is limited without proper event loops.")
                return "" # SAPI async streaming requires deeper COM integration
            except Exception as e:
                logger.error(f"System STT error: {e}")
                return ""
        
        return ""
