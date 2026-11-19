import pytest

from services.agent.voice.states import (
    InvalidVoiceTransition,
    VoiceState,
    VoiceStateMachine,
)


def test_full_live_turn_uses_the_declared_states():
    async def run():
        changes = []

        async def on_change(previous, current, reason):
            changes.append((previous, current, reason))

        machine = VoiceStateMachine(VoiceState.INITIALIZING, on_change=on_change)
        await machine.transition(VoiceState.LISTENING, "started")
        await machine.transition(VoiceState.PROCESSING, "transcribing")
        await machine.transition(VoiceState.THINKING, "agent")
        await machine.transition(VoiceState.SPEAKING, "tts")
        await machine.transition(VoiceState.LISTENING, "turn_done")
        return machine, changes

    import asyncio

    machine, changes = asyncio.run(run())
    assert machine.state is VoiceState.LISTENING
    assert [current for _previous, current, _reason in changes] == [
        VoiceState.LISTENING,
        VoiceState.PROCESSING,
        VoiceState.THINKING,
        VoiceState.SPEAKING,
        VoiceState.LISTENING,
    ]


def test_invalid_transition_is_rejected():
    async def run():
        machine = VoiceStateMachine(VoiceState.IDLE)
        with pytest.raises(InvalidVoiceTransition):
            await machine.transition(VoiceState.SPEAKING, "skip")

    import asyncio

    asyncio.run(run())


def test_force_is_available_for_cleanup_and_error_paths():
    async def run():
        machine = VoiceStateMachine(VoiceState.ERROR)
        await machine.force(VoiceState.CLOSED, "shutdown")
        return machine.state

    import asyncio

    assert asyncio.run(run()) is VoiceState.CLOSED


def test_same_state_is_idempotent():
    async def run():
        machine = VoiceStateMachine(VoiceState.LISTENING)
        await machine.transition(VoiceState.LISTENING, "already")
        return machine.state

    import asyncio

    assert asyncio.run(run()) is VoiceState.LISTENING
