import math
import struct

from services.agent.voice.audio import (
    AudioLevelMeter,
    StreamingVAD,
    level_from_rms,
    pcm16_duration_ms,
    pcm16_rms,
    pcm16_to_wav,
    resample_pcm16,
    wav_to_pcm16,
)


def tone(duration_ms=500, sample_rate=16000, amplitude=9000, frequency=220):
    count = int(sample_rate * duration_ms / 1000)
    samples = [
        int(amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
        for index in range(count)
    ]
    return struct.pack(f"<{len(samples)}h", *samples)


def silence(duration_ms=500, sample_rate=16000):
    return b"\x00\x00" * int(sample_rate * duration_ms / 1000)


def test_pcm_helpers_roundtrip_wav():
    pcm = tone(120)
    wav = pcm16_to_wav(pcm)
    decoded, sample_rate, channels = wav_to_pcm16(wav)
    assert decoded == pcm
    assert sample_rate == 16000
    assert channels == 1
    assert abs(pcm16_duration_ms(decoded) - 120.0) < 1.0


def test_resample_changes_length_and_is_stable():
    pcm = tone(1000, sample_rate=48000)
    resampled = resample_pcm16(pcm, 48000, 16000)
    assert abs(len(resampled) - len(pcm) / 3) <= 4
    assert pcm16_rms(resampled) > 1000


def test_streaming_vad_emits_one_utterance_with_preroll_and_hangover():
    vad = StreamingVAD(silence_ms=300, min_speech_ms=150, pre_roll_ms=90)

    class AcceptTone:
        @staticmethod
        def is_speech(frame, _sample_rate):
            return pcm16_rms(frame) > 1000

    vad._vad = AcceptTone()
    emitted = []
    for chunk in (
        silence(400),
        tone(700),
        silence(500),
    ):
        emitted.extend(vad.feed(chunk))
    assert len(emitted) == 1
    utterance = emitted[0]
    assert utterance.reason == "silence"
    assert utterance.duration_ms >= 600
    assert vad.speaking is False


def test_streaming_vad_ignores_quiet_room_noise():
    vad = StreamingVAD(silence_ms=300, min_speech_ms=150)
    emitted = []
    for _ in range(20):
        emitted.extend(vad.feed(struct.pack("<480h", *([80] * 480))))
    assert emitted == []


def test_streaming_vad_rejects_loud_noise_when_web_rtc_says_non_speech():
    class RejectNoise:
        @staticmethod
        def is_speech(_frame, _sample_rate):
            return False

    vad = StreamingVAD(silence_ms=300, min_speech_ms=150)
    vad._vad = RejectNoise()

    assert vad.feed(tone(900, amplitude=12000)) == []
    assert vad.speaking is False


def test_streaming_vad_requires_minimum_classified_speech_duration():
    class AcceptTone:
        @staticmethod
        def is_speech(frame, _sample_rate):
            return pcm16_rms(frame) > 1000

    vad = StreamingVAD(silence_ms=300, min_speech_ms=200)
    vad._vad = AcceptTone()

    emitted = vad.feed(tone(60))
    emitted.extend(vad.feed(silence(500)))

    assert emitted == []


def test_streaming_vad_merges_repeated_pauses_inside_continuation_window():
    class AcceptTone:
        @staticmethod
        def is_speech(frame, _sample_rate):
            return pcm16_rms(frame) > 1000

    vad = StreamingVAD(silence_ms=2_000, min_speech_ms=150)
    vad._vad = AcceptTone()
    emitted = []
    for chunk in (
        tone(300),
        silence(1_500),
        tone(300),
        silence(1_500),
        tone(300),
        silence(2_100),
    ):
        emitted.extend(vad.feed(chunk))

    assert len(emitted) == 1
    assert emitted[0].reason == "silence"
    assert emitted[0].duration_ms < 5_000
    assert emitted[0].speech_ratio > 0


def test_level_meter_is_bounded_and_reactive():
    meter = AudioLevelMeter()
    quiet = meter.update(silence(100))
    loud = meter.update(tone(100))
    assert 0.0 <= quiet <= 1.0
    assert 0.0 <= loud <= 1.0
    assert loud > quiet
    assert 0.0 <= level_from_rms(0) <= 1.0
    assert level_from_rms(100000) == 1.0
