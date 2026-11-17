import asyncio
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from services.agent.voice.adapters import local_provider_summary
from services.agent.voice.confirmations import (
    ConfirmationOutcome,
    ConversationConfirmationManager,
)
from services.agent.voice.protocol import (
    VOICE_SESSION_START,
    VOICE_SESSION_STOP,
    VOICE_AUDIO_CHUNK,
    VOICE_INTERRUPT,
    VOICE_CONFIRMATION,
    VOICE_MUTE,
    VOICE_UNMUTE,
    parse_session_start,
    parse_confirmation_decision,
)
from services.agent.voice.response_filter import filter_for_speech, contains_code
from services.agent.voice.states import VoiceMode, VoiceState, VoiceStateMachine
from services.agent.voice.manager import VoiceSessionManager
from services.agent.voice.session import VoiceSession


class FakeEventBus:
    def __init__(self):
        self.subscribers = {}
        self.published = []

    async def subscribe(self, event_name, handler):
        self.subscribers.setdefault(event_name, []).append(handler)

    async def unsubscribe(self, event_name, handler):
        if event_name in self.subscribers:
            self.subscribers[event_name] = [h for h in self.subscribers[event_name] if h != handler]

    async def publish(self, event_name, payload):
        self.published.append((event_name, payload))
        for handler in self.subscribers.get(event_name, []):
            await handler(event_name, payload)


class MockSTT:
    def __init__(self, transcript="Hola Helix"):
        self.transcript = transcript
        self.available = True
        self.name = "mock-stt"

    async def warmup(self):
        pass

    async def transcribe_pcm16(self, pcm, sample_rate=16000, language=None):
        return self.transcript


class MockTTS:
    def __init__(self):
        self.available = True
        self.name = "mock-tts"
        self.synthesized = []

    async def synthesize_wav(self, text, voice_id=None):
        self.synthesized.append(text)
        return b"RIFF____WAVEfmt " + b"\x00" * 32


# ── 1. Code-free Speech Policy Tests ──────────────────────────────────────────

def test_code_filter_removes_fenced_blocks():
    text = "He generado el componente:\n```jsx\nexport default function App() { return <div>Hola</div>; }\n```\nPuedes revisarlo."
    result = filter_for_speech(text)
    assert result.had_code is True
    assert "export default" not in result.text
    assert "<div>" not in result.text
    assert "pantalla" in result.text.lower() or "screen" in result.text.lower()


def test_code_filter_removes_inline_code_and_commands():
    text = "Ejecuta `npm install axios` en la terminal para continuar."
    result = filter_for_speech(text)
    assert "npm install" not in result.text
    assert result.had_code is True


def test_code_filter_removes_sql_queries():
    text = "SELECT id, name FROM users WHERE active = 1;\nAquí tienes la lista."
    result = filter_for_speech(text)
    assert "SELECT id, name FROM users" not in result.text
    assert result.had_code is True


def test_code_filter_pure_code_notice():
    text = "```python\ndef test():\n    pass\n```"
    result = filter_for_speech(text)
    assert result.had_code is True
    assert "pantalla" in result.text.lower() or "screen" in result.text.lower()
    assert "def test" not in result.text


# ── 2. Universal Confirmation Natural Language Tests ─────────────────────────

@pytest.mark.asyncio
async def test_confirmation_affirmatives_resolve():
    bus = FakeEventBus()
    mgr = ConversationConfirmationManager(bus, ttl_seconds=60)
    await mgr.start()

    # Post pending confirmation
    await bus.publish(
        "WAIT_CONFIRMATION",
        {
            "id": "req-1234-5678",
            "action": "delete_temp_file",
            "what_will_change": "Eliminar cache",
            "why": "Liberar espacio",
            "conversation_id": "conv-1",
        },
    )

    pending = await mgr.get_pending("conv-1")
    assert len(pending) == 1

    # Affirmative response
    outcome = await mgr.try_resolve_text("sí, dale, hazlo", conversation_id="conv-1")
    assert outcome.decision == "approve"
    assert outcome.resolved is True

    # Check published resolution
    assert any(
        name == "CONFIRMATION_GRANTED" and p["request_id"] == "req-1234-5678"
        for name, p in bus.published
    )
    await mgr.stop()


@pytest.mark.asyncio
async def test_confirmation_rejection_resolves():
    bus = FakeEventBus()
    mgr = ConversationConfirmationManager(bus, ttl_seconds=60)
    await mgr.start()

    await bus.publish(
        "WAIT_CONFIRMATION",
        {
            "id": "req-9999",
            "action": "shell_tool",
            "what_will_change": "rm -rf /",
            "why": "test",
            "conversation_id": "conv-2",
        },
    )

    outcome = await mgr.try_resolve_text("no, cancela eso por favor", conversation_id="conv-2")
    assert outcome.decision == "reject"
    assert outcome.resolved is True

    assert any(
        name == "CONFIRMATION_REJECTED" and p["request_id"] == "req-9999"
        for name, p in bus.published
    )
    await mgr.stop()


@pytest.mark.asyncio
async def test_confirmation_ambiguity_never_approves():
    bus = FakeEventBus()
    mgr = ConversationConfirmationManager(bus, ttl_seconds=60)
    await mgr.start()

    await bus.publish(
        "WAIT_CONFIRMATION",
        {
            "id": "req-ambig",
            "action": "delete_db",
            "conversation_id": "conv-3",
        },
    )

    # Ambiguous reply
    outcome = await mgr.try_resolve_text("tal vez mañana o quizás la próxima semana", conversation_id="conv-3")
    assert outcome.decision not in {"approve", "reject"}
    assert outcome.resolved is False

    # Pending confirmation MUST still exist
    pending = await mgr.get_pending("conv-3")
    assert len(pending) == 1
    await mgr.stop()


# ── 3. VoiceSession Lifecycle & State Machine Tests ──────────────────────────

@pytest.mark.asyncio
async def test_voice_session_lifecycle():
    bus = FakeEventBus()
    confirmation_mgr = ConversationConfirmationManager(bus)
    await confirmation_mgr.start()

    sent_events = []

    async def fake_send(event):
        sent_events.append(event)

    config = parse_session_start({"session_id": "test_session_1234", "mode": "live"})
    session = VoiceSession(
        session_id="test_session_1234",
        event_bus=bus,
        send=fake_send,
        stt=MockSTT("Abre el editor"),
        tts=MockTTS(),
        confirmation_manager=confirmation_mgr,
        config=config,
    )

    await session.start()
    assert session.state == VoiceState.LISTENING

    # Test Mute / Unmute
    await session.mute()
    assert session.state == VoiceState.MUTED

    await session.unmute()
    assert session.state == VoiceState.LISTENING

    # Transition properly through the state machine: LISTENING -> PROCESSING -> THINKING -> SPEAKING
    await session.state_machine.transition(VoiceState.PROCESSING, "user_transcribing")
    await session.state_machine.transition(VoiceState.THINKING, "agent_thinking")
    await session.state_machine.transition(VoiceState.SPEAKING, "assistant_speaking")
    assert session.state == VoiceState.SPEAKING

    await session.interrupt(reason="test_barge_in")
    # After interrupt, it immediately stops speech and returns to LISTENING for next turn
    assert session.state == VoiceState.LISTENING
    assert any(e["type"] == "VOICE_AUDIO_STOP" for e in sent_events)

    # Close session
    await session.close(reason="test_done")
    assert session.state == VoiceState.CLOSED

    await confirmation_mgr.stop()


# ── 4. VoiceSessionManager Routing Tests ─────────────────────────────────────

@pytest.mark.asyncio
async def test_voice_session_manager_message_dispatch():
    bus = FakeEventBus()
    confirmation_mgr = ConversationConfirmationManager(bus)
    await confirmation_mgr.start()

    mgr = VoiceSessionManager(
        event_bus=bus,
        confirmation_manager=confirmation_mgr,
        stt_factory=lambda: MockSTT(),
        tts_factory=lambda voice_id: MockTTS(),
    )
    await mgr.start()

    client_events = []

    async def fake_client_send(event):
        client_events.append(event)

    # Start a live session
    await mgr.handle_message(
        VOICE_SESSION_START,
        {"session_id": "sess_unit_test_99", "mode": "live"},
        fake_client_send,
    )

    status = mgr.status()
    assert status["active_sessions"] == 1

    # Check session ready was sent to client
    assert any(
        e["type"] == "VOICE_SESSION_READY" and e["payload"]["session_id"] == "sess_unit_test_99"
        for e in client_events
    )

    # Stop session
    await mgr.handle_message(
        VOICE_SESSION_STOP,
        {"session_id": "sess_unit_test_99"},
        fake_client_send,
    )

    status = mgr.status()
    assert status["active_sessions"] == 0

    await mgr.shutdown()
    await confirmation_mgr.stop()


@pytest.mark.asyncio
async def test_voice_stt_profile_selects_and_reuses_local_whisper_models(monkeypatch):
    models = []

    class FakeLocalWhisperSTT:
        def __init__(self, model):
            self.model = model
            self.name = f"whisper-{model}"
            self.available = True
            models.append(model)

        async def warmup(self):
            return None

    monkeypatch.setattr(
        "services.agent.voice.manager.LocalWhisperSTT", FakeLocalWhisperSTT
    )
    settings = {"voice_stt_mode": "speed"}
    mgr = VoiceSessionManager(
        event_bus=FakeEventBus(),
        confirmation_manager=ConversationConfirmationManager(FakeEventBus()),
        settings_provider=lambda: settings,
        tts_factory=lambda _voice_id: None,
    )

    fast, _tts = await mgr._get_providers(None)
    assert fast.model == "tiny"

    settings["voice_stt_mode"] = "accuracy"
    accurate, _tts = await mgr._get_providers(None)
    assert accurate.model == "base"

    settings["voice_stt_mode"] = "speed"
    reused_fast, _tts = await mgr._get_providers(None)
    assert reused_fast is fast
    assert models == ["tiny", "base"]


@pytest.mark.asyncio
async def test_selected_whisper_model_is_warmed_before_session_ready(monkeypatch):
    class ColdLocalWhisperSTT:
        def __init__(self, model):
            self.model = model
            self.name = f"faster-whisper:{model}:loading"
            self.available = False
            self.warmups = 0

        async def warmup(self):
            self.warmups += 1
            self.available = True

    providers = []

    def create_stt(model):
        provider = ColdLocalWhisperSTT(model)
        providers.append(provider)
        return provider

    monkeypatch.setattr(
        "services.agent.voice.manager.LocalWhisperSTT", create_stt
    )
    bus = FakeEventBus()
    confirmation_mgr = ConversationConfirmationManager(bus)
    mgr = VoiceSessionManager(
        event_bus=bus,
        confirmation_manager=confirmation_mgr,
        settings_provider=lambda: {"voice_stt_mode": "speed"},
        tts_factory=lambda _voice_id: MockTTS(),
    )
    client_events = []

    async def send(event):
        client_events.append(event)

    await mgr.handle_message(
        VOICE_SESSION_START,
        {"session_id": "sess_cold_model_01", "mode": "live"},
        send,
    )

    assert providers[0].model == "tiny"
    assert providers[0].warmups >= 1
    assert any(event["type"] == "VOICE_SESSION_READY" for event in client_events)
    await mgr.close_session("sess_cold_model_01")
