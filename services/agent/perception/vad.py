import logging
import asyncio
import importlib.util
import struct

logger = logging.getLogger(__name__)

class VADDetector:
    def __init__(
        self,
        aggressiveness: int = 2,
        sample_rate: int = 16000,
        frame_duration_ms: int = 30,
        min_speech_rms: float = 500,
    ):
        self.aggressiveness = aggressiveness
        self.sample_rate = sample_rate
        self.frame_duration_ms = frame_duration_ms
        self.frame_size = int(sample_rate * (frame_duration_ms / 1000.0) * 2) # 16-bit
        self.min_speech_rms = min_speech_rms
        self._vad = None
        self.last_capture_stop_reason = None
        self.last_frame_rms = 0.0
        
        if importlib.util.find_spec('webrtcvad') is None:
            logger.warning("webrtcvad not installed. Falling back to energy threshold.")
        else:
            try:
                import webrtcvad
                self._vad = webrtcvad.Vad(self.aggressiveness)
            except ImportError as error:
                logger.warning(
                    "webrtcvad could not be loaded (%s). Falling back to energy threshold.",
                    error,
                )

    def is_speech(self, audio_chunk: bytes) -> bool:
        count = len(audio_chunk) // 2
        if count == 0:
            return False
        samples = struct.unpack(f"<{count}h", audio_chunk[:count * 2])
        sum_squares = sum(sample * sample for sample in samples)
        rms = (sum_squares / count) ** 0.5
        self.last_frame_rms = rms
        if rms <= self.min_speech_rms:
            return False

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
            return True

    async def collect_speech(
        self,
        audio_stream_gen,
        silence_duration_s: float = 0.8,
        max_duration_s: float = 30.0,
        start_timeout_s: float | None = None,
    ) -> bytes:
        frames = []
        silence_frames_max = int(silence_duration_s / (self.frame_duration_ms / 1000.0))
        silence_frames = 0
        initial_silence_frames = 0
        initial_silence_frames_max = (
            int(start_timeout_s / (self.frame_duration_ms / 1000.0))
            if start_timeout_s is not None
            else None
        )
        total_frames = 0
        max_frames = int(max_duration_s / (self.frame_duration_ms / 1000.0))
        speech_detected = False
        speech_frames = 0
        speech_rms_total = 0.0
        speech_rms_peak = 0.0
        capture_rms_peak = 0.0
        stop_reason = "input_ended"
        loop = asyncio.get_running_loop()
        last_report = loop.time()
        interval_speech_frames = 0
        
        async for chunk in audio_stream_gen:
            total_frames += 1
            if total_frames > max_frames:
                stop_reason = "max_duration"
                break
                
            is_speech_flag = self.is_speech(chunk)
            frame_rms = self.last_frame_rms
            capture_rms_peak = max(capture_rms_peak, frame_rms)
            
            if is_speech_flag:
                interval_speech_frames += 1
                speech_frames += 1
                speech_rms_total += frame_rms
                speech_rms_peak = max(speech_rms_peak, frame_rms)
                if not speech_detected:
                    logger.info(
                        "VAD_SPEECH_DETECTED frame=%d frame_bytes=%d",
                        total_frames,
                        len(chunk),
                    )
                    speech_detected = True
                silence_frames = 0
                frames.append(chunk)
            else:
                if not frames:
                    initial_silence_frames += 1
                silence_frames += 1
                if frames:
                    frames.append(chunk)

            now = loop.time()
            if now - last_report >= 5.0:
                logger.info(
                    "VAD_CAPTURE_HEALTH frames_total=%d speech_frames_interval=%d "
                    "interval_seconds=%.1f speech_started=%s capture_peak_rms=%.1f "
                    "speech_peak_rms=%.1f",
                    total_frames,
                    interval_speech_frames,
                    now - last_report,
                    speech_detected,
                    capture_rms_peak,
                    speech_rms_peak,
                )
                last_report = now
                interval_speech_frames = 0

            if (
                not frames
                and initial_silence_frames_max is not None
                and initial_silence_frames >= initial_silence_frames_max
            ):
                stop_reason = "start_timeout"
                break
                
            if frames and silence_frames > silence_frames_max:
                stop_reason = "silence_timeout"
                break

        audio = b''.join(frames)
        self.last_capture_stop_reason = stop_reason
        logger.info(
            "VAD_CAPTURE_FINISHED reason=%s frames=%d speech_detected=%s audio_bytes=%d "
            "capture_peak_rms=%.1f speech_frames=%d speech_avg_rms=%.1f "
            "speech_peak_rms=%.1f min_speech_rms=%.1f",
            stop_reason,
            total_frames,
            speech_detected,
            len(audio),
            capture_rms_peak,
            speech_frames,
            speech_rms_total / speech_frames if speech_frames else 0.0,
            speech_rms_peak,
            self.min_speech_rms,
        )
        return audio
