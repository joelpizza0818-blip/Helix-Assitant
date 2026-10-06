import logging
import asyncio
import importlib.util
import struct

logger = logging.getLogger(__name__)

class VADDetector:
    def __init__(self, aggressiveness: int = 2, sample_rate: int = 16000, frame_duration_ms: int = 30):
        self.aggressiveness = aggressiveness
        self.sample_rate = sample_rate
        self.frame_duration_ms = frame_duration_ms
        self.frame_size = int(sample_rate * (frame_duration_ms / 1000.0) * 2) # 16-bit
        self._vad = None
        
        if importlib.util.find_spec('webrtcvad') is not None:
            import webrtcvad
            self._vad = webrtcvad.Vad(self.aggressiveness)
        else:
            logger.warning("webrtcvad not installed. Falling back to energy threshold.")

    def is_speech(self, audio_chunk: bytes) -> bool:
        if self._vad:
            try:
                # Ensure correct frame size for webrtcvad
                if len(audio_chunk) == self.frame_size:
                    return self._vad.is_speech(audio_chunk, self.sample_rate)
                return False
            except Exception as e:
                logger.error(f"VAD error: {e}")
                return False
        else:
            import math
            count = len(audio_chunk) // 2
            if count == 0:
                return False
            shorts = struct.unpack('h' * count, audio_chunk)
            sum_squares = sum(s * s for s in shorts)
            rms = math.sqrt(sum_squares / count)
            return rms > 500

    async def collect_speech(self, audio_stream_gen, silence_duration_s: float = 0.8, max_duration_s: float = 30.0) -> bytes:
        frames = []
        silence_frames_max = int(silence_duration_s / (self.frame_duration_ms / 1000.0))
        silence_frames = 0
        total_frames = 0
        max_frames = int(max_duration_s / (self.frame_duration_ms / 1000.0))
        
        async for chunk in audio_stream_gen:
            total_frames += 1
            if total_frames > max_frames:
                break
                
            is_speech_flag = self.is_speech(chunk)
            
            if is_speech_flag:
                silence_frames = 0
                frames.append(chunk)
            else:
                silence_frames += 1
                if frames:
                    frames.append(chunk)
                    
            if frames and silence_frames > silence_frames_max:
                break
                
        return b''.join(frames)
