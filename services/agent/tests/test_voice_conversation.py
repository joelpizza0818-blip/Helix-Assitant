import asyncio
import io
import sys
import wave
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from services.agent.core.orchestrator import Orchestrator
from services.agent.core.task_manager import TaskStatus
from services.agent.perception import speech_to_text
from services.agent.perception.text_to_speech import TextToSpeech
from services.agent.perception.voice_engine import VoiceEngine, VoiceState
from services.agent.perception.vad import VADDetector


class EventBusStub:
    def __init__(self):
        self.events = []

    async def publish(self, event_name, payload):
        self.events.append((event_name, payload))


class TaskManagerStub:
    def __init__(self):
        self.statuses = []

    async def update_status(self, task_id, status):
        self.statuses.append((task_id, status))


def test_voice_orchestration_returns_direct_conversational_answer():
    event_bus = EventBusStub()
    task_manager = TaskManagerStub()
    react_loop = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(content="Hola.")))
    planner = SimpleNamespace(create_plan=AsyncMock())
    orchestrator = Orchestrator(
        planner=planner,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=None,
        tool_registry=None,
        role_config=None,
    )
    history = [
        {"role": "user", "content": "¿Qué hora es?"},
        {"role": "assistant", "content": "No puedo ver el reloj."},
        {"role": "user", "content": "Entonces salúdame."},
    ]

    asyncio.run(
        orchestrator.execute_task(
            "task-1",
            "Entonces salúdame.",
            {
                "input_source": "voice",
                "conversation_id": "conversation-1",
                "conversation_history": history,
            },
        )
    )

    planner.create_plan.assert_not_awaited()
    react_loop.execute.assert_awaited_once()
    messages = react_loop.execute.await_args.args[0]
    assert messages[0].role == "system"
    assert "spoken conversation" in messages[0].content
    assert [(message.role, message.content) for message in messages[1:]] == [
        (message["role"], message["content"]) for message in history
    ]
    assert task_manager.statuses == [
        ("task-1", TaskStatus.RUNNING),
        ("task-1", TaskStatus.COMPLETED),
    ]
    assert event_bus.events[-1] == (
        "ORCHESTRATION_COMPLETED",
        {
            "task_id": "task-1",
            "response": "Hola.",
            "input_source": "voice",
            "conversation_id": "conversation-1",
        },
    )


def test_voice_engine_publishes_one_user_text_with_voice_metadata():
    engine = VoiceEngine.__new__(VoiceEngine)
    engine.event_bus = EventBusStub()
    engine._is_active = True
    engine._conversation_id = "voice-session"
    engine._conversation_history = []
    engine.state = VoiceState.LISTENING
    engine.wake_detector = SimpleNamespace(stop=AsyncMock())
    engine._listen_and_transcribe = AsyncMock(return_value="Hola Helix")

    async def run_interaction():
        await engine._handle_interaction(initial=True)

    asyncio.run(run_interaction())

    assert engine.event_bus.events == [
        (
            "USER_TEXT",
            {
                "text": "Hola Helix",
                "input_source": "voice",
                "conversation_id": "voice-session",
                "conversation_history": [{"role": "user", "content": "Hola Helix"}],
            },
        )
    ]
    assert engine.state is VoiceState.WAITING_RESPONSE


def test_voice_engine_speaks_only_its_active_voice_conversation_response():
    engine = VoiceEngine.__new__(VoiceEngine)
    engine._conversation_id = "conversation-1"
    engine._conversation_history = [{"role": "user", "content": "Hola."}]
    engine._is_active = True
    engine.state = VoiceState.WAITING_RESPONSE
    engine.tts = SimpleNamespace(speak=AsyncMock())
    engine._handle_interaction = AsyncMock()

    async def handle_response():
        await engine._handle_response_event(
            "ORCHESTRATION_COMPLETED",
            {
                "input_source": "voice",
                "conversation_id": "conversation-1",
                "response": "¡Hola! ¿Cómo estás?",
            },
        )
        await engine._task

    asyncio.run(handle_response())

    engine.tts.speak.assert_awaited_once_with("¡Hola! ¿Cómo estás?")
    engine._handle_interaction.assert_awaited_once_with(initial=False)
    assert engine._conversation_history[-1] == {
        "role": "assistant",
        "content": "¡Hola! ¿Cómo estás?",
    }
    assert engine.state == VoiceState.LISTENING


def test_voice_engine_falls_back_to_system_voice_when_primary_tts_fails():
    engine = VoiceEngine.__new__(VoiceEngine)
    engine._conversation_id = "conversation-1"
    engine._conversation_history = []
    engine._is_active = False
    engine.state_manager = None
    engine.state = VoiceState.WAITING_RESPONSE
    engine.tts = SimpleNamespace(
        provider="edge_tts",
        speak=AsyncMock(side_effect=RuntimeError("TTS unavailable")),
    )
    engine.fallback_tts = SimpleNamespace(speak=AsyncMock())

    asyncio.run(
        engine._handle_response_event(
            "ORCHESTRATION_COMPLETED",
            {
                "input_source": "voice",
                "conversation_id": "conversation-1",
                "response": "¡Hola!",
            },
        )
    )

    engine.tts.speak.assert_awaited_once_with("¡Hola!")
    engine.fallback_tts.speak.assert_awaited_once_with("¡Hola!")
    assert engine.state == VoiceState.IDLE


def test_voice_engine_ignores_non_voice_and_other_conversation_responses():
    engine = VoiceEngine.__new__(VoiceEngine)
    engine._conversation_id = "conversation-1"
    engine._conversation_history = []
    engine._is_active = False
    engine.state = VoiceState.WAITING_RESPONSE
    engine.tts = SimpleNamespace(speak=AsyncMock())

    asyncio.run(
        engine._handle_response_event(
            "ORCHESTRATION_COMPLETED",
            {
                "input_source": "text",
                "conversation_id": "conversation-1",
                "response": "No debe leerse.",
            },
        )
    )
    asyncio.run(
        engine._handle_response_event(
            "ORCHESTRATION_COMPLETED",
            {
                "input_source": "voice",
                "conversation_id": "another-conversation",
                "response": "Tampoco debe leerse.",
            },
        )
    )

    engine.tts.speak.assert_not_awaited()
    assert engine._conversation_history == []
    assert engine.state == VoiceState.WAITING_RESPONSE


def test_voice_conversation_history_uses_configured_turn_limit():
    engine = VoiceEngine.__new__(VoiceEngine)
    engine._conversation_history = [
        {"role": "user", "content": f"turn {index}"}
        for index in range(12)
    ]

    engine.configure_memory(3)

    assert engine._conversation_history_limit == 6
    assert engine._conversation_history == [
        {"role": "user", "content": f"turn {index}"}
        for index in range(6, 12)
    ]


def test_vad_stops_waiting_after_initial_silence_timeout():
    vad = VADDetector()
    vad.is_speech = lambda _chunk: False

    async def silence_frames():
        yield b"\x00" * vad.frame_size
        yield b"\x00" * vad.frame_size
        yield b"\x00" * vad.frame_size

    audio = asyncio.run(
        vad.collect_speech(
            silence_frames(),
            start_timeout_s=0.06,
        )
    )

    assert audio == b""
    assert vad.last_capture_stop_reason == "start_timeout"


def test_vad_stops_when_low_energy_frames_follow_speech():
    vad = VADDetector()
    vad._vad = SimpleNamespace(is_speech=lambda *_args: True)
    speech = (1200).to_bytes(2, byteorder="little", signed=True) * (vad.frame_size // 2)
    silence = b"\x00" * vad.frame_size

    async def speech_then_silence():
        yield speech
        for _ in range(27):
            yield silence

    audio = asyncio.run(vad.collect_speech(speech_then_silence()))

    assert audio == speech + silence * 27
    assert vad.last_capture_stop_reason == "silence_timeout"


def test_vad_reports_aggregate_capture_rms(caplog):
    caplog.set_level("INFO")
    vad = VADDetector()
    vad._vad = SimpleNamespace(is_speech=lambda *_args: True)
    speech = (1000).to_bytes(2, byteorder="little", signed=True) * (vad.frame_size // 2)
    silence = b"\x00" * vad.frame_size

    async def speech_then_silence():
        yield speech
        for _ in range(27):
            yield silence

    asyncio.run(vad.collect_speech(speech_then_silence()))

    assert "capture_peak_rms=1000.0" in caplog.text
    assert "speech_frames=1 speech_avg_rms=1000.0 speech_peak_rms=1000.0" in caplog.text


def test_voice_capture_closes_microphone_before_stt(monkeypatch):
    operations = []

    class Stream:
        def start(self):
            operations.append("capture_started")

        def read(self, _frame_size):
            return b"", False

        def stop(self):
            operations.append("capture_ended")

        def close(self):
            operations.append("stream_closed")

    stream = Stream()
    monkeypatch.setitem(
        sys.modules,
        "sounddevice",
        SimpleNamespace(RawInputStream=lambda **_kwargs: stream),
    )
    engine = VoiceEngine.__new__(VoiceEngine)
    engine.vad = SimpleNamespace(
        frame_size=960,
        sample_rate=16000,
        collect_speech=AsyncMock(return_value=b"audio"),
    )

    async def transcribe(_audio):
        operations.append("stt_started")
        return "recognized"

    engine.stt = SimpleNamespace(transcribe=transcribe)
    engine.state = VoiceState.LISTENING

    assert asyncio.run(engine._listen_and_transcribe()) == "recognized"
    assert operations == [
        "capture_started",
        "capture_ended",
        "stream_closed",
        "stt_started",
    ]


@pytest.mark.asyncio
async def test_voice_engine_resubscribes_after_stop_and_restart():
    from services.agent.core.event_bus import EventBus

    event_bus = EventBus()
    wake_detector = SimpleNamespace(
        start=AsyncMock(),
        stop=AsyncMock(),
        is_running=lambda: True,
        input_device=0,
        provider="openwakeword",
    )
    engine = VoiceEngine.__new__(VoiceEngine)
    engine.enabled = True
    engine._is_active = False
    engine._subscriptions = []
    engine.event_bus = event_bus
    engine.wake_detector = wake_detector
    engine.state_manager = None
    engine.state = VoiceState.IDLE
    engine._task = None
    engine._wake_monitor_task = None
    engine._audio_device = None
    engine.stt = SimpleNamespace(provider="remote")

    await engine.start()
    assert engine._handle_wake_event in event_bus.subscribers["VOICE_WAKE"]
    await engine.stop()
    assert not event_bus.subscribers["VOICE_WAKE"]

    await engine.start()
    assert engine._handle_wake_event in event_bus.subscribers["VOICE_WAKE"]
    await engine.stop()


@pytest.mark.asyncio
async def test_voice_engine_retries_a_stopped_wake_word_detector(monkeypatch):
    engine = VoiceEngine.__new__(VoiceEngine)
    engine._is_active = True
    engine.state = VoiceState.IDLE
    engine._audio_device = None
    engine.wake_detector = SimpleNamespace(
        start=AsyncMock(),
        is_running=Mock(side_effect=[False, True]),
        input_device=3,
    )

    async def end_monitor(_delay):
        engine._is_active = False

    monkeypatch.setattr(asyncio, "sleep", end_monitor)

    await engine._monitor_wake_detector()

    engine.wake_detector.start.assert_awaited_once()
    assert engine._audio_device == 3


@pytest.mark.asyncio
async def test_audio_generator_ends_when_microphone_read_stalls(caplog):
    class StalledStream:
        def read(self, _frame_size):
            raise asyncio.TimeoutError

    engine = VoiceEngine.__new__(VoiceEngine)
    engine.state = VoiceState.LISTENING
    frames = [
        frame
        async for frame in engine._audio_generator(StalledStream(), 480)
    ]

    assert frames == []
    assert "stopped returning frames" in caplog.text


def test_openai_tts_plays_wav_audio_with_sounddevice(monkeypatch):
    import wave

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 160)

    speech_create = AsyncMock(
        return_value=SimpleNamespace(read=lambda: wav_buffer.getvalue())
    )
    openai_module = ModuleType("openai")
    openai_module.AsyncOpenAI = lambda **_kwargs: SimpleNamespace(
        audio=SimpleNamespace(speech=SimpleNamespace(create=speech_create))
    )
    playback_calls = []
    sounddevice_module = ModuleType("sounddevice")
    sounddevice_module.play = lambda *args, **kwargs: playback_calls.append((args, kwargs))
    monkeypatch.setitem(sys.modules, "openai", openai_module)
    monkeypatch.setitem(sys.modules, "sounddevice", sounddevice_module)

    tts = TextToSpeech(provider="openai", api_key="configured")
    asyncio.run(tts.speak("Hola, Helix."))

    speech_create.assert_awaited_once_with(
        model="tts-1",
        voice="echo",
        input="Hola, Helix.",
        response_format="wav",
        speed=1.0,
    )
    assert len(playback_calls) == 1
    assert playback_calls[0][0][1] == 16000
    assert playback_calls[0][1] == {"blocking": True}


def test_edge_tts_synthesizes_with_multilingual_voice(monkeypatch):
    calls = {}

    class FakeCommunicate:
        def __init__(self, text, voice, rate):
            calls.update(text=text, voice=voice, rate=rate)

        async def stream(self):
            yield {"type": "audio", "data": b"audio"}
            yield {"type": "WordBoundary", "data": b"ignored"}

    edge_tts_module = ModuleType("edge_tts")
    edge_tts_module.Communicate = FakeCommunicate
    monkeypatch.setitem(sys.modules, "edge_tts", edge_tts_module)

    tts = TextToSpeech(
        provider="edge_tts", voice_id="en-US-AndrewMultilingualNeural"
    )
    assert asyncio.run(tts.synthesize("Hola, Helix.")) == b"audio"
    assert calls == {
        "text": "Hola, Helix.",
        "voice": "en-US-AndrewMultilingualNeural",
        "rate": "+0%",
    }


def test_edge_tts_decodes_audio_and_plays_with_sounddevice(monkeypatch):
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b"\x00\x00" * 160)

    playback_calls = []
    sounddevice_module = ModuleType("sounddevice")
    sounddevice_module.play = lambda *args, **kwargs: playback_calls.append((args, kwargs))
    monkeypatch.setitem(sys.modules, "sounddevice", sounddevice_module)

    TextToSpeech._play_edge_audio(wav_buffer.getvalue())

    assert len(playback_calls) == 1
    assert playback_calls[0][0][1] == 24000
    assert playback_calls[0][1] == {"blocking": True}


def test_speech_to_text_falls_back_to_local_whisper_without_api_key(monkeypatch, tmp_path):
    monkeypatch.setattr(speech_to_text.SpeechToText, "check_ffmpeg", staticmethod(lambda: True))
    whisper_model = SimpleNamespace(
        transcribe=lambda _path: {"text": "Hola, Helix."}
    )
    load_model = lambda model_name: whisper_model
    whisper_module = ModuleType("whisper")
    whisper_module.load_model = load_model
    monkeypatch.setitem(sys.modules, "whisper", whisper_module)
    monkeypatch.setattr(
        speech_to_text.importlib.util,
        "find_spec",
        lambda name: object() if name == "whisper" else None,
    )

    wav_path = tmp_path / "speech.wav"
    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00")

    stt = speech_to_text.SpeechToText(provider="openai", api_key=None)
    transcript = asyncio.run(stt.transcribe_file(str(wav_path)))

    assert stt.provider == "whisper_local"
    assert transcript == "Hola, Helix."


def test_faster_whisper_transcribes_standard_wav_with_cpu_int8(monkeypatch, tmp_path):
    captured = {}

    def transcribe(audio, **options):
        captured["audio"] = audio
        captured["options"] = options
        return iter([SimpleNamespace(text="Hola.")]), SimpleNamespace(language="es")

    faster_whisper_model = SimpleNamespace(
        transcribe=transcribe
    )
    faster_whisper_module = ModuleType("faster_whisper")
    faster_whisper_module.WhisperModel = lambda model_name, **options: (
        captured.update({"model_name": model_name, "model_options": options})
        or faster_whisper_model
    )
    monkeypatch.setitem(sys.modules, "faster_whisper", faster_whisper_module)
    monkeypatch.setattr(
        speech_to_text.importlib.util,
        "find_spec",
        lambda name: object() if name == "faster_whisper" else None,
    )

    wav_path = tmp_path / "speech.wav"
    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00\x00\x40")

    stt = speech_to_text.SpeechToText(provider="whisper_local", model="base")
    transcript = asyncio.run(stt.transcribe_file(str(wav_path), language="es"))

    assert stt._local_backend == "faster-whisper"
    assert transcript == "Hola."
    assert captured["audio"].tolist() == [0.0, 0.5]
    assert captured["model_name"] == "base"
    assert captured["model_options"] == {"device": "cpu", "compute_type": "int8"}
    assert captured["options"] == {"beam_size": 5, "language": "es"}


def test_faster_whisper_reads_non_pcm_wav_without_ffmpeg(monkeypatch, tmp_path):
    captured = {}

    def transcribe(audio, **_options):
        captured["audio"] = audio
        return iter([SimpleNamespace(text="Hello.")]), SimpleNamespace(language="en")

    faster_whisper_module = ModuleType("faster_whisper")
    faster_whisper_module.WhisperModel = lambda *_args, **_kwargs: SimpleNamespace(
        transcribe=transcribe
    )
    monkeypatch.setitem(sys.modules, "faster_whisper", faster_whisper_module)
    monkeypatch.setattr(
        speech_to_text.importlib.util,
        "find_spec",
        lambda name: object() if name == "faster_whisper" else None,
    )
    monkeypatch.setattr(
        speech_to_text.SpeechToText,
        "_read_pcm_wav",
        staticmethod(lambda _file_path: None),
    )
    monkeypatch.setattr(
        speech_to_text.SpeechToText,
        "check_ffmpeg",
        staticmethod(lambda: False),
    )

    wav_path = tmp_path / "non-pcm.wav"
    wav_path.write_bytes(b"audio handled by faster-whisper")
    stt = speech_to_text.SpeechToText(provider="whisper_local", model="base")

    transcript = asyncio.run(stt.transcribe_file(str(wav_path)))

    assert transcript == "Hello."
    assert captured["audio"] == str(wav_path)
