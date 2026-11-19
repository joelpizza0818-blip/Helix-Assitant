import asyncio
import base64
import math

import pytest

from services.agent.voice.audio import Utterance, pcm16_to_wav
from services.agent.voice.confirmations import ConversationConfirmationManager
from services.agent.voice.protocol import (
    VOICE_AUDIO_SEGMENT,
    VOICE_AUDIO_STOP,
    VOICE_ASSISTANT_TEXT,
    VOICE_CONFIRMATION_REQUEST,
    VOICE_CONFIRMATION_TEXT,
    VOICE_INTERRUPTED,
    VOICE_RECORDING_START,
    VOICE_RECORDING_STOP,
    VOICE_SESSION_READY,
    VOICE_SPEAKING_END,
    VOICE_STATE,
    VOICE_TRANSCRIPT,
    VOICE_MUTE,
    VOICE_UNMUTE,
    VOICE_PLAYBACK_DONE,
    VOICE_INTERRUPT,
    VoiceConfig,
)
from services.agent.voice.session import LIVE_CONTINUATION_GRACE_MS, VoiceSession
from services.agent.voice.states import VoiceState


class EventBusStub:
    def __init__(self):
        self.events = []
        self.handlers = {}

    async def subscribe(self, event_name, handler):
        self.handlers.setdefault(event_name, []).append(handler)

    async def unsubscribe(self, event_name, handler):
        handlers = self.handlers.get(event_name, [])
        if handler in handlers:
            handlers.remove(handler)

    async def publish(self, event_name, payload):
        self.events.append((event_name, payload))
        for handler in list(self.handlers.get(event_name, [])):
            await handler(event_name, payload)


class FakeSTT:
    name = "fake-stt"
    available = True

    def __init__(self, *texts):
        self.texts = list(texts)
        self.calls = []

    async def warmup(self):
        return None

    async def transcribe_pcm16(self, pcm, sample_rate=16000, language=None):
        self.calls.append((len(pcm), sample_rate, language))
        return self.texts.pop(0) if self.texts else ""


class FakeTTS:
    name = "fake-tts"

    def __init__(self, fail=False):
        self.texts = []
        self.fail = fail

    async def synthesize_wav(self, text, voice_id=None):
        self.texts.append(text)
        if self.fail:
            from services.agent.voice.adapters import VoiceProviderError

            raise VoiceProviderError("no local voice")
        return pcm16_to_wav(b"\x00\x00" * 1600)  # 100 ms


def config(mode="live", tts_enabled=True, opening_greeting=False):
    return VoiceConfig(
        mode=mode,
        silence_ms=300,
        max_utterance_ms=5000,
        tts_enabled=tts_enabled,
        opening_greeting=opening_greeting,
    ).normalized()


async def wait_for(predicate, timeout=3.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Timed out waiting for condition")


def make_session(
    mode="live",
    tts_enabled=True,
    stt_texts=("hola",),
    opening_greeting=False,
):
    bus = EventBusStub()
    sent = []

    async def send(event):
        sent.append(event)

    stt = FakeSTT(*stt_texts)
    tts = FakeTTS()
    session = VoiceSession(
        session_id="session_test_1",
        event_bus=bus,
        send=send,
        stt=stt,
        tts=tts,
        confirmation_manager=ConversationConfirmationManager(bus),
        config=config(mode, tts_enabled, opening_greeting),
    )
    return session, bus, sent, stt, tts


def event_types(sent):
    return [event["type"] for event in sent]


async def enqueue_and_wait(session, bus, text_pcm=None, duration_ms=300):
    pcm = text_pcm or b"\x00\x00" * 4800
    session._enqueue_utterance(
        Utterance(pcm=pcm, duration_ms=duration_ms, reason="test", speech_ratio=1.0)
    )
    await wait_for(lambda: any(event == "USER_TEXT" for event, _ in bus.events))


def test_live_session_starts_listening_and_reports_local_providers():
    async def run():
        session, bus, sent, _stt, _tts = make_session()
        expected_silence_frames = math.ceil(
            (session.config.silence_ms + LIVE_CONTINUATION_GRACE_MS) / 30
        )
        assert session._vad.silence_frames == expected_silence_frames
        await session.start()
        await wait_for(lambda: any(event["type"] == VOICE_SESSION_READY for event in sent))
        ready = next(event for event in sent if event["type"] == VOICE_SESSION_READY)
        assert ready["payload"]["local_only"] is True
        assert ready["payload"]["policy"]["code_to_speech"] is False
        assert session.state is VoiceState.LISTENING
        await session.close("test_done")

    asyncio.run(run())


def test_agent_response_with_code_never_reaches_tts():
    async def run():
        session, bus, sent, stt, tts = make_session()
        await session.start()
        await enqueue_and_wait(session, bus)
        assert stt.calls
        assert any(event == "USER_TEXT" for event, _ in bus.events)
        assert session.state is VoiceState.THINKING

        await session.on_orchestration_completed(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "response": "Done.\n```python\nprint('secret')\n```\nRestart now.",
            }
        )
        await wait_for(lambda: any(event["type"] == VOICE_AUDIO_SEGMENT for event in sent))
        assert not any("print" in text or "```" in text for text in tts.texts)
        assert all("secret" not in text for text in tts.texts)
        assistant = next(event for event in sent if event["type"] == VOICE_ASSISTANT_TEXT)
        assert "```" in assistant["payload"]["text"]
        assert "```" not in assistant["payload"]["speech_text"]

        await session.handle_message(
            VOICE_PLAYBACK_DONE,
            {"session_id": session.session_id, "last_index": 999},
        )
        await wait_for(lambda: session.state is VoiceState.LISTENING)
        assert session.history[-1]["role"] == "assistant"
        assert "print" not in session.history[-1]["content"]
        await session.close("test_done")

    asyncio.run(run())


def test_streamed_agent_response_synthesizes_before_completion_without_repeating():
    async def run():
        session, bus, sent, _stt, tts = make_session()
        await session.start()
        await enqueue_and_wait(session, bus)

        await session.on_orchestration_text_delta(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "delta": "First sentence. ",
            }
        )
        await wait_for(lambda: any(
            event["type"] == VOICE_AUDIO_SEGMENT for event in sent
        ))
        assert not any(event["type"] == VOICE_ASSISTANT_TEXT for event in sent)

        await session.on_orchestration_text_delta(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "delta": "Second sentence.",
            }
        )
        await session.on_orchestration_completed(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "response": "First sentence. Second sentence.",
            }
        )
        await wait_for(lambda: any(
            event["type"] == VOICE_SPEAKING_END for event in sent
        ))
        assert tts.texts == ["First sentence.", "Second sentence."]
        assert any(event["type"] == VOICE_ASSISTANT_TEXT for event in sent)

        await session.handle_message(
            VOICE_PLAYBACK_DONE,
            {"session_id": session.session_id, "last_index": 999},
        )
        await wait_for(lambda: session.state is VoiceState.LISTENING)
        await session.close("test_done")

    asyncio.run(run())


def test_confirmation_prompt_and_spoken_yes_resolve_exactly_one_action():
    async def run():
        session, bus, sent, _stt, _tts = make_session(stt_texts=("yes",))
        manager = session.confirmation_manager
        await manager.start()
        await session.start()
        await session._submit_user_text("Remove the temporary file.")
        await session.on_orchestration_text_delta(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "delta": "I will remove it now. ",
            }
        )
        await wait_for(lambda: any(
            event["type"] == VOICE_AUDIO_SEGMENT for event in sent
        ))
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-session",
                "task_id": "task-1",
                "action": "shell_tool",
                "what_will_change": '{"command": "rm -rf build"}',
                "why": "This tool requires approval.",
                "level": "HIGH_RISK",
                "conversation_id": session.conversation_id,
            },
        )
        pending = await manager.get_pending(session.conversation_id)
        await session.on_confirmation_pending(
            {
                "request_id": "req-session",
                "conversation_id": session.conversation_id,
                "action": "shell_tool",
                "what_will_change": '{"command": "rm -rf build"}',
                "why": "This tool requires approval.",
                "level": "HIGH_RISK",
                "speech_text": pending[0].prompt_text,
                "expires_in_seconds": 60,
            }
        )
        assert session.state is VoiceState.AWAITING_CONFIRMATION
        assert session._stream_speech_queue is None
        assert any(event["type"] == VOICE_CONFIRMATION_REQUEST for event in sent)

        session._enqueue_utterance(
            Utterance(pcm=b"\x00\x00" * 4800, duration_ms=300, reason="test", speech_ratio=1.0)
        )
        await wait_for(
            lambda: any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)
        )
        await wait_for(lambda: session.state is VoiceState.THINKING)
        assert await manager.get_pending(session.conversation_id) == []
        await session.close("test_done")

    asyncio.run(run())


def test_ambiguous_reply_keeps_confirmation_pending():
    async def run():
        session, bus, sent, _stt, _tts = make_session(tts_enabled=False, stt_texts=("maybe",))
        manager = session.confirmation_manager
        await manager.start()
        await session.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-ambiguous",
                "task_id": "task-1",
                "action": "shell_tool",
                "what_will_change": "{}",
                "why": "Approval required.",
                "level": "HIGH_RISK",
                "conversation_id": session.conversation_id,
            },
        )
        await session.on_confirmation_pending(
            {
                "request_id": "req-ambiguous",
                "conversation_id": session.conversation_id,
                "action": "shell_tool",
                "speech_text": "Please confirm.",
                "expires_in_seconds": 60,
            }
        )
        session._enqueue_utterance(
            Utterance(pcm=b"\x00\x00" * 4800, duration_ms=300, reason="test", speech_ratio=1.0)
        )
        await wait_for(
            lambda: any(
                event["type"] == VOICE_TRANSCRIPT
                and event["payload"].get("final")
                and event["payload"].get("text") == "maybe"
                for event in sent
            )
        )
        # The worker sees the pending confirmation and does not create a task.
        await wait_for(lambda: session.state is VoiceState.AWAITING_CONFIRMATION)
        assert len(await manager.get_pending(session.conversation_id)) == 1
        assert not any(event == "USER_TEXT" for event, _ in bus.events)
        assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)
        await session.close("test_done")

    asyncio.run(run())


def test_typed_confirmation_text_approves_pending_action_once():
    async def run():
        session, bus, sent, _stt, _tts = make_session(tts_enabled=False)
        manager = session.confirmation_manager
        await manager.start()
        await session.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-typed",
                "task_id": "task-typed",
                "action": "delete_tool",
                "what_will_change": "Delete the build directory.",
                "why": "This tool requires approval.",
                "level": "HIGH_RISK",
                "conversation_id": session.conversation_id,
            },
        )
        pending = await manager.get_pending(session.conversation_id)
        await session.on_confirmation_pending(
            {
                "request_id": "req-typed",
                "conversation_id": session.conversation_id,
                "action": "delete_tool",
                "what_will_change": "Delete the build directory.",
                "why": "This tool requires approval.",
                "level": "HIGH_RISK",
                "speech_text": pending[0].prompt_text,
                "expires_in_seconds": 60,
            }
        )
        assert session.state is VoiceState.AWAITING_CONFIRMATION

        await session.handle_message(
            VOICE_CONFIRMATION_TEXT,
            {
                "session_id": session.session_id,
                "request_id": "req-typed",
                "text": "sí, adelante",
            },
        )

        await wait_for(
            lambda: any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)
        )
        assert session.state is VoiceState.THINKING
        assert await manager.get_pending(session.conversation_id) == []

        # The action is single-use: a second typed "yes" cannot resolve it again.
        await session.handle_message(
            VOICE_CONFIRMATION_TEXT,
            {"session_id": session.session_id, "text": "yes"},
        )
        assert any(
            event["type"] == "VOICE_ERROR"
            and event["payload"].get("code") == "NO_PENDING_CONFIRMATION"
            for event in sent
        )
        assert (
            sum(1 for event, _ in bus.events if event == "CONFIRMATION_GRANTED") == 1
        )
        await session.close("test_done")

    asyncio.run(run())


def test_typed_confirmation_text_ambiguity_keeps_action_pending():
    async def run():
        session, bus, sent, _stt, _tts = make_session(tts_enabled=False)
        manager = session.confirmation_manager
        await manager.start()
        await session.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-typed-ambiguous",
                "task_id": "task-typed",
                "action": "delete_tool",
                "what_will_change": "Delete the build directory.",
                "why": "This tool requires approval.",
                "level": "HIGH_RISK",
                "conversation_id": session.conversation_id,
            },
        )
        pending = await manager.get_pending(session.conversation_id)
        await session.on_confirmation_pending(
            {
                "request_id": "req-typed-ambiguous",
                "conversation_id": session.conversation_id,
                "action": "delete_tool",
                "speech_text": pending[0].prompt_text,
                "expires_in_seconds": 60,
            }
        )
        assert session.state is VoiceState.AWAITING_CONFIRMATION

        await session.handle_message(
            VOICE_CONFIRMATION_TEXT,
            {
                "session_id": session.session_id,
                "request_id": "req-typed-ambiguous",
                "text": "quizás",
            },
        )

        guidance = [
            event
            for event in sent
            if event["type"] == VOICE_ASSISTANT_TEXT
            and event["payload"].get("speech_text")
        ]
        assert guidance, "ambiguous typed text must return spoken guidance"
        assert session.state is VoiceState.AWAITING_CONFIRMATION
        assert len(await manager.get_pending(session.conversation_id)) == 1
        assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)
        assert not any(event == "USER_TEXT" for event, _ in bus.events)
        await session.close("test_done")

    asyncio.run(run())


def test_unrecognized_confirmation_reply_gets_conversational_guidance():
    async def run():
        session, bus, sent, _stt, _tts = make_session(tts_enabled=False)
        manager = session.confirmation_manager
        await manager.start()
        await session.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-unrecognized",
                "task_id": "task-1",
                "action": "shell_tool",
                "what_will_change": "{}",
                "why": "Approval required.",
                "level": "HIGH_RISK",
                "conversation_id": session.conversation_id,
            },
        )
        pending = await manager.get_pending(session.conversation_id)
        await session.on_confirmation_pending(
            {
                "request_id": "req-unrecognized",
                "conversation_id": session.conversation_id,
                "action": "shell_tool",
                "speech_text": pending[0].prompt_text,
                "expires_in_seconds": 60,
            }
        )

        await session.handle_message(
            VOICE_CONFIRMATION_TEXT,
            {
                "session_id": session.session_id,
                "request_id": "req-unrecognized",
                "text": "I have a question",
            },
        )

        guidance = [
            event["payload"]
            for event in sent
            if event["type"] == VOICE_ASSISTANT_TEXT
            and event["payload"].get("speech_text")
        ]
        assert guidance
        assert "comfortable" in guidance[-1]["speech_text"].lower()
        assert "yes or no" not in guidance[-1]["speech_text"].lower()
        assert len(await manager.get_pending(session.conversation_id)) == 1
        assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)
        await session.close("test_done")

    asyncio.run(run())


def test_barge_in_stops_playback_and_returns_to_listening():
    async def run():
        session, bus, sent, _stt, _tts = make_session()
        await session.start()
        await enqueue_and_wait(session, bus)
        await session.on_orchestration_completed(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "response": "This is a longer answer that would be spoken now.",
            }
        )
        await wait_for(lambda: any(event["type"] == VOICE_SPEAKING_END for event in sent))
        assert session.state is VoiceState.SPEAKING
        await session.handle_message(VOICE_INTERRUPT, {"session_id": session.session_id})
        await wait_for(lambda: session.state in {VoiceState.LISTENING, VoiceState.INTERRUPTED})
        assert any(event["type"] == VOICE_AUDIO_STOP for event in sent)
        assert any(event["type"] == VOICE_INTERRUPTED for event in sent)
        await session.close("test_done")

    asyncio.run(run())


def test_live_opening_greeting_uses_agent_without_fabricated_user_history():
    async def run():
        session, bus, _sent, _stt, _tts = make_session(opening_greeting=True)
        await session.start()

        user_events = [
            payload for event, payload in bus.events if event == "USER_TEXT"
        ]
        assert len(user_events) == 1
        assert user_events[0]["input_source"] == "voice"
        assert user_events[0]["voice_greeting"] is True
        assert session.history == []
        assert session.state is VoiceState.THINKING
        await session.close("test_done")

    asyncio.run(run())


def test_user_can_interrupt_agent_thinking_and_replace_the_pending_response():
    async def run():
        session, bus, _sent, _stt, _tts = make_session(
            stt_texts=("cambiemos de tema",)
        )
        await session.start()
        await session._submit_user_text("revisa el proyecto")
        await session.handle_message(
            VOICE_INTERRUPT, {"session_id": session.session_id}
        )
        assert session.state is VoiceState.INTERRUPTED

        await session._process_utterance(
            Utterance(
                pcm=b"\x01\x00" * 4800,
                duration_ms=300,
                reason="barge_in",
                speech_ratio=1.0,
            )
        )
        assert session._pending_interruption_texts == ["cambiemos de tema"]
        assert len(
            [event for event, _payload in bus.events if event == "USER_TEXT"]
        ) == 1

        await session.on_orchestration_completed(
            {"task_id": "original-task", "response": "resultado anterior"}
        )
        user_events = [
            payload for event, payload in bus.events if event == "USER_TEXT"
        ]
        assert [event["text"] for event in user_events] == [
            "revisa el proyecto",
            "cambiemos de tema",
        ]
        assert session.state is VoiceState.THINKING
        await session.close("test_done")

    asyncio.run(run())


def test_mute_stops_accepting_audio_and_unmute_restores_listening():
    async def run():
        session, bus, sent, _stt, _tts = make_session()
        await session.start()
        await session.handle_message(VOICE_MUTE, {"session_id": session.session_id})
        assert session.state is VoiceState.MUTED
        await session.ingest_audio(b"\x00\x00" * 4800, 16000)
        await session.handle_message(VOICE_UNMUTE, {"session_id": session.session_id})
        assert session.state is VoiceState.LISTENING
        await session.close("test_done")

    asyncio.run(run())


def test_normal_mode_records_then_speaks_and_returns_to_idle():
    async def run():
        session, bus, sent, stt, tts = make_session(mode="normal", stt_texts=("hello",))
        await session.start()
        assert session.state is VoiceState.IDLE
        await session.handle_message(VOICE_RECORDING_START, {"session_id": session.session_id})
        assert session.state is VoiceState.LISTENING
        await session.ingest_audio(b"\x00\x00" * 4800, 16000)
        await session.handle_message(VOICE_RECORDING_STOP, {"session_id": session.session_id})
        await wait_for(lambda: any(event == "USER_TEXT" for event, _ in bus.events))
        assert stt.calls
        await session.on_orchestration_completed(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "response": "Hello there.",
            }
        )
        await wait_for(lambda: any(event["type"] == VOICE_SPEAKING_END for event in sent))
        await session.handle_message(
            VOICE_PLAYBACK_DONE, {"session_id": session.session_id, "last_index": 999}
        )
        await wait_for(lambda: session.state is VoiceState.IDLE)
        assert tts.texts
        await session.close("test_done")

    asyncio.run(run())


def test_tts_failure_is_reported_without_leaking_code():
    async def run():
        session, bus, sent, _stt, _tts = make_session()
        session.tts.fail = True
        await session.start()
        await enqueue_and_wait(session, bus)
        await session.on_orchestration_completed(
            {
                "task_id": "task-1",
                "conversation_id": session.conversation_id,
                "response": "```python\nprint('secret')\n```",
            }
        )
        await wait_for(
            lambda: any(
                event["type"] == "VOICE_ERROR"
                and event["payload"].get("code") == "TTS_FAILED"
                for event in sent
            )
        )
        assert not any("print" in text for text in session.tts.texts)
        await session.close("test_done")

    asyncio.run(run())


def test_live_tts_router_is_strictly_local():
    from services.agent.voice.adapters import TTSRouter, VoiceProviderError

    class EdgeStub:
        available = True

        async def synthesize_wav(self, text, voice_id=None):
            raise AssertionError("Live Voice must never use a network TTS engine")

    class LocalStub:
        name = "local"
        available = True

        def __init__(self):
            self.calls = []

        async def synthesize_wav(self, text, voice_id=None):
            self.calls.append((text, voice_id))
            return b"RIFF"

    class UnavailableStub:
        name = "unavailable"
        available = False

    local = LocalStub()
    router = TTSRouter(
        providers=[local],
        voice_id="es-ES-ElviraNeural",
        allow_edge=False,
    )
    router._edge = EdgeStub()

    assert asyncio.run(router.synthesize_wav("hola")) == b"RIFF"
    # An Edge-style voice id must not be forwarded to a local engine.
    assert local.calls == [("hola", None)]

    missing = TTSRouter(providers=[UnavailableStub()], allow_edge=False)
    missing._edge = EdgeStub()
    with pytest.raises(VoiceProviderError):
        asyncio.run(missing.synthesize_wav("hola"))
