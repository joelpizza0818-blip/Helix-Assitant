import asyncio

import pytest

from services.agent.voice.confirmations import (
    ConversationConfirmationManager,
    describe_action,
)


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


def publish_confirmation(bus, *, request_id="req-1", conversation_id="voice_session_1"):
    return bus.publish(
        "WAIT_CONFIRMATION",
        {
            "id": request_id,
            "task_id": "task-1",
            "action": "shell_tool",
            "what_will_change": '{"command": "rm -rf build"}',
            "why": "This tool requires explicit approval.",
            "level": "HIGH_RISK",
            "conversation_id": conversation_id,
        },
    )


def test_pending_confirmation_is_bound_to_its_conversation_and_prompted():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        pending = await manager.get_pending("voice_session_1")
        assert len(pending) == 1
        assert pending[0].request_id == "req-1"
        assert "does that work for you" in pending[0].prompt_text.lower()
        assert "say yes" not in pending[0].prompt_text.lower()
        assert await manager.get_pending("voice_other") == []
        return bus

    bus = asyncio.run(run())
    assert any(event == "CONVERSATION_CONFIRMATION_PENDING" for event, _ in bus.events)


def test_confirmation_prompt_uses_the_users_language_and_natural_wording():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-es",
                "task_id": "task-1",
                "action": "shell_tool",
                "what_will_change": "Borrar el archivo temporal",
                "why": "Se necesita autorización.",
                "level": "HIGH_RISK",
                "conversation_id": "voice_session_es",
            },
        )
        return (await manager.get_pending("voice_session_es"))[0].prompt_text

    prompt = asyncio.run(run())
    assert "¿Te parece bien?" in prompt
    assert "Di sí" not in prompt


def test_yes_approves_once_and_cannot_be_reused():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        first = await manager.try_resolve_text(
            "yes, go ahead", conversation_id="voice_session_1"
        )
        second = await manager.try_resolve_text(
            "yes", conversation_id="voice_session_1"
        )
        return first, second, bus

    first, second, bus = asyncio.run(run())
    assert first.decision == "approve"
    assert first.request_id == "req-1"
    assert second.decision == "none"
    assert [event for event, _ in bus.events].count("CONFIRMATION_GRANTED") == 1
    granted = [payload for event, payload in bus.events if event == "CONFIRMATION_GRANTED"][0]
    assert granted["request_id"] == "req-1"
    assert granted["conversation_id"] == "voice_session_1"


def test_no_rejects_the_exact_pending_action():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus, request_id="req-2")
        return await manager.try_resolve_text("no", conversation_id="voice_session_1"), bus

    outcome, bus = asyncio.run(run())
    assert outcome.decision == "reject"
    rejected = [payload for event, payload in bus.events if event == "CONFIRMATION_REJECTED"]
    assert rejected[0]["request_id"] == "req-2"
    assert rejected[0]["reason"] == "conversation_rejection"


def test_ambiguous_reply_does_not_resolve_or_approve():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        outcome = await manager.try_resolve_text(
            "maybe later", conversation_id="voice_session_1"
        )
        return outcome, await manager.get_pending("voice_session_1"), bus

    outcome, pending, bus = asyncio.run(run())
    assert outcome.decision == "ambiguous"
    assert outcome.handled is True
    assert len(pending) == 1
    assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)


def test_wrong_conversation_cannot_resolve_the_confirmation():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        outcome = await manager.try_resolve_text(
            "yes", conversation_id="voice_someone_else"
        )
        return outcome, await manager.get_pending("voice_session_1"), bus

    outcome, pending, bus = asyncio.run(run())
    assert outcome.decision == "none"
    assert len(pending) == 1
    assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)


def test_modification_rejects_the_old_action_and_requests_a_new_plan():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        outcome = await manager.try_resolve_text(
            "change the folder to Documents", conversation_id="voice_session_1"
        )
        return outcome, await manager.get_pending("voice_session_1"), bus

    outcome, pending, bus = asyncio.run(run())
    assert outcome.decision == "modify"
    assert "Documents" in outcome.instructions
    assert "a new confirmation is required" in outcome.followup_text
    assert pending == []
    rejected = [payload for event, payload in bus.events if event == "CONFIRMATION_REJECTED"]
    assert rejected[0]["reason"] == "conversation_modification"
    assert rejected[0]["decision"] == "modify"


def test_explicit_ui_resolution_is_single_use():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus)
        first = await manager.resolve_explicit("req-1", "approve", source="voice_ui")
        second = await manager.resolve_explicit("req-1", "approve", source="voice_ui")
        return first, second, bus

    first, second, bus = asyncio.run(run())
    assert first.decision == "approve"
    assert second.decision == "expired"
    assert [event for event, _ in bus.events].count("CONFIRMATION_GRANTED") == 1


def test_confirmation_expires_and_silence_never_approves():
    async def run():
        bus = EventBusStub()
        now = [1000.0]
        manager = ConversationConfirmationManager(bus, ttl_seconds=10, clock=lambda: now[0])
        await manager.start()
        await publish_confirmation(bus)
        now[0] += 11
        outcome = await manager.try_resolve_text("yes", conversation_id="voice_session_1")
        return outcome, await manager.get_pending("voice_session_1"), bus

    outcome, pending, bus = asyncio.run(run())
    assert outcome.decision == "none"
    assert pending == []
    assert not any(event == "CONFIRMATION_GRANTED" for event, _ in bus.events)


def test_multiple_pending_without_conversation_is_ambiguous():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await publish_confirmation(bus, request_id="req-a", conversation_id="voice_a")
        await publish_confirmation(bus, request_id="req-b", conversation_id="voice_b")
        return await manager.try_resolve_text("yes")

    outcome = asyncio.run(run())
    assert outcome.decision == "ambiguous"
    assert "several actions" in outcome.message.lower()


def test_action_description_never_exposes_arguments():
    assert "terminal" in describe_action("shell_tool")
    assert "{" not in describe_action("shell_tool")


def test_source_device_is_preserved_for_the_react_loop_future():
    async def run():
        bus = EventBusStub()
        manager = ConversationConfirmationManager(bus)
        await manager.start()
        await bus.publish(
            "WAIT_CONFIRMATION",
            {
                "id": "req-device",
                "task_id": "task-1",
                "action": "shell_tool",
                "what_will_change": "{}",
                "why": "Approval required.",
                "level": "HIGH_RISK",
                "conversation_id": "conv-desktop",
                "source_device_id": "device-7",
            },
        )
        outcome = await manager.try_resolve_text(
            "yes", conversation_id="conv-desktop"
        )
        return outcome, bus

    outcome, bus = asyncio.run(run())
    assert outcome.decision == "approve"
    granted = [payload for event, payload in bus.events if event == "CONFIRMATION_GRANTED"]
    assert granted[0]["source_device_id"] == "device-7"
    assert granted[0]["conversation_id"] == "conv-desktop"
