import logging
import asyncio
import importlib.util
import io
import wave
from dataclasses import dataclass
from typing import List

logger = logging.getLogger(__name__)

@dataclass
class VoiceInfo:
    id: str
    name: str
    language: str

class TextToSpeech:
    def __init__(self, provider: str, model: str = 'tts-1', api_key: str = None, voice_id: str = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.voice_id = voice_id
        
        if (self.provider in ['openai', 'elevenlabs']) and not self.api_key:
            logger.warning(f"{self.provider} key not available, falling back to system TTS")
            self.provider = 'system'
            
        logger.info(f"TextToSpeech initialized with provider: {self.provider}")

    async def synthesize(self, text: str) -> bytes:
        if self.provider == 'openai':
            try:
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=self.api_key)
                response = await client.audio.speech.create(
                    model=self.model,
                    voice=self.voice_id or "alloy",
                    input=text,
                    response_format="wav",
                )
                return response.read()
            except Exception as e:
                logger.error(f"OpenAI TTS error: {e}")
                raise RuntimeError("OpenAI text-to-speech failed") from e
                
        elif self.provider == 'elevenlabs':
            try:
                import aiohttp
                url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id or '21m00Tcm4TlvDq8ikWAM'}"
                headers = {"xi-api-key": self.api_key, "Content-Type": "application/json"}
                payload = {"text": text, "model_id": self.model, "voice_settings": {"stability": 0.5, "similarity_boost": 0.5}}
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            return await response.read()
                        else:
                            logger.error(f"ElevenLabs TTS error: {await response.text()}")
                            raise RuntimeError(
                                f"ElevenLabs text-to-speech returned HTTP {response.status}"
                            )
            except Exception as e:
                logger.error(f"ElevenLabs TTS exception: {e}")
                raise RuntimeError("ElevenLabs text-to-speech failed") from e
                
        elif self.provider == 'system':
            return b"" # System TTS typically speaks directly rather than returning bytes easily
        return b""

    async def speak(self, text: str):
        if self.provider == 'system':
            await asyncio.to_thread(self._speak_system, text)
            return

        audio_bytes = await self.synthesize(text)
        if not audio_bytes:
            raise RuntimeError("Text-to-speech returned empty audio.")

        if self.provider == "openai":
            import numpy as np
            import sounddevice as sd

            with wave.open(io.BytesIO(audio_bytes), "rb") as audio:
                sample_width = audio.getsampwidth()
                dtypes = {1: np.uint8, 2: np.int16, 4: np.int32}
                if sample_width not in dtypes:
                    raise RuntimeError(
                        f"Unsupported OpenAI TTS WAV sample width: {sample_width}"
                    )
                frames = np.frombuffer(
                    audio.readframes(audio.getnframes()),
                    dtype=dtypes[sample_width],
                )
                if audio.getnchannels() > 1:
                    frames = frames.reshape(-1, audio.getnchannels())
                sample_rate = audio.getframerate()

            await asyncio.to_thread(sd.play, frames, sample_rate, blocking=True)
            return

        if importlib.util.find_spec('pygame') is not None:
            import tempfile
            import os

            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name
            try:
                os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = "hide"
                import pygame
                pygame.mixer.init()
                pygame.mixer.music.load(tmp_path)
                pygame.mixer.music.play()
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
                pygame.mixer.quit()
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
        else:
            raise RuntimeError(
                "pygame is required to play ElevenLabs audio; install it or use OpenAI TTS."
            )

    def _speak_system(self, text: str):
        if importlib.util.find_spec('pyttsx3') is not None:
            import pyttsx3
            engine = pyttsx3.init()
            if self.voice_id:
                engine.setProperty('voice', self.voice_id)
            engine.say(text)
            engine.runAndWait()
        else:
            import win32com.client
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            speaker.Speak(text)

    def set_voice(self, voice_id: str):
        self.voice_id = voice_id

    async def list_voices(self) -> List[VoiceInfo]:
        voices = []
        if self.provider == 'system':
            if importlib.util.find_spec('pyttsx3') is not None:
                import pyttsx3
                engine = pyttsx3.init()
                for v in engine.getProperty('voices'):
                    voices.append(VoiceInfo(id=v.id, name=v.name, language=v.languages[0] if v.languages else 'en'))
        return voices
