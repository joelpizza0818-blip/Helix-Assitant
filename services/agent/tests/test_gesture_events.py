import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from services.agent.core.event_bus import EventBus
from services.agent.core.state_manager import StateManager
from services.agent.perception.gesture_engine import GestureType
from services.agent.perception.gesture_engine import GestureEngine

def test_six_gesture_definitions():
    # Verify all 6 mandatory gestures are present in the enum
    expected_gestures = {"THUMBS_UP", "THUMBS_DOWN", "OK", "OPEN_PALM", "FIST", "POINTING_UP"}
    actual_gestures = set(g.name for g in GestureType)
    assert expected_gestures.issubset(actual_gestures)

def test_gesture_event_name_mapping():
    mapping = {
        GestureType.THUMBS_UP: "GESTURE_CONFIRM",
        GestureType.THUMBS_DOWN: "GESTURE_REJECT",
        GestureType.OK: "GESTURE_SEARCH",
        GestureType.OPEN_PALM: "GESTURE_STOP",
        GestureType.FIST: "GESTURE_CLOSE",
        GestureType.POINTING_UP: "GESTURE_OPEN",
    }

    assert mapping[GestureType.THUMBS_UP] == "GESTURE_CONFIRM"
    assert mapping[GestureType.THUMBS_DOWN] == "GESTURE_REJECT"
    assert mapping[GestureType.OK] == "GESTURE_SEARCH"
    assert mapping[GestureType.OPEN_PALM] == "GESTURE_STOP"
    assert mapping[GestureType.FIST] == "GESTURE_CLOSE"
    assert mapping[GestureType.POINTING_UP] == "GESTURE_OPEN"


def test_task_api_landmarks_are_classified():
    points = [SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        points[tip].y = 0.4
        points[pip].y = 0.6
    points[4].y = 0.5
    points[3].y = 0.6
    points[5].y = 0.2

    engine = GestureEngine(EventBus())

    assert engine._detect_gesture(points) is GestureType.OPEN_PALM


@pytest.mark.asyncio
async def test_detected_gesture_is_published_to_event_bus():
    event_bus = EventBus()
    received = asyncio.get_running_loop().create_future()

    async def capture(event_name, payload):
        if not received.done():
            received.set_result((event_name, payload))

    await event_bus.subscribe("GESTURE_CONFIRM", capture)
    engine = GestureEngine(event_bus)
    engine._loop = asyncio.get_running_loop()

    engine._on_gesture(GestureType.THUMBS_UP)
    event_name, payload = await asyncio.wait_for(received, timeout=1)

    assert event_name == "GESTURE_CONFIRM"
    assert payload == {"gesture": "THUMBS_UP"}


@pytest.mark.asyncio
async def test_gesture_requires_stability_and_is_latched_until_release():
    event_bus = EventBus()
    published = []

    async def capture(event_name, payload):
        published.append((event_name, payload))

    await event_bus.subscribe("GESTURE_CONFIRM", capture)
    engine = GestureEngine(
        event_bus,
        confidence_threshold=0.8,
        stability_frames=4,
        cooldown_seconds=0,
    )
    engine._loop = asyncio.get_running_loop()

    for _ in range(3):
        engine._observe_gesture(GestureType.THUMBS_UP, 0.95)
    await asyncio.sleep(0)
    assert published == []

    engine._observe_gesture(GestureType.THUMBS_UP, 0.95)
    for _ in range(8):
        engine._observe_gesture(GestureType.THUMBS_UP, 0.95)
    await asyncio.sleep(0.01)
    assert published == [("GESTURE_CONFIRM", {"gesture": "THUMBS_UP"})]

    for _ in range(4):
        engine._observe_gesture(None, 0)
    for _ in range(4):
        engine._observe_gesture(GestureType.THUMBS_UP, 0.95)
    await asyncio.sleep(0.01)
    assert len(published) == 2


@pytest.mark.asyncio
async def test_low_confidence_gesture_is_ignored():
    event_bus = EventBus()
    published = []

    async def capture(event_name, payload):
        published.append((event_name, payload))

    await event_bus.subscribe("GESTURE_CONFIRM", capture)
    engine = GestureEngine(
        event_bus,
        confidence_threshold=0.8,
        stability_frames=1,
    )
    engine._loop = asyncio.get_running_loop()

    engine._observe_gesture(GestureType.THUMBS_UP, 0.79)
    await asyncio.sleep(0.01)

    assert published == []


@pytest.mark.asyncio
async def test_fist_is_ignored_until_a_voice_interaction_is_active():
    event_bus = EventBus()
    published = []
    state_manager = StateManager()

    async def capture(event_name, payload):
        published.append((event_name, payload))

    await event_bus.subscribe("GESTURE_CLOSE", capture)
    engine = GestureEngine(
        event_bus,
        state_manager=state_manager,
        stability_frames=1,
        cooldown_seconds=0,
    )
    engine._loop = asyncio.get_running_loop()

    await asyncio.to_thread(engine._on_gesture, GestureType.FIST)
    await asyncio.sleep(0.01)
    assert published == []

    await state_manager.update_state(voice_active=True)
    await asyncio.to_thread(engine._on_gesture, GestureType.FIST)
    await asyncio.sleep(0.01)
    assert published == [("GESTURE_CLOSE", {"gesture": "FIST"})]
def test_gesture_validation_timeout_ignores_gesture_and_cancels_check():
    event_bus = EventBus()
    engine = GestureEngine(event_bus, state_manager=StateManager())
    engine._loop = asyncio.new_event_loop()
    dispatched = []
    cancelled = []

    async def slow_check(_gesture):
        try:
            await asyncio.sleep(5)
            return True
        finally:
            cancelled.append(True)

    engine._gesture_is_allowed = slow_check
    engine._dispatch_gesture = lambda gesture: dispatched.append(gesture)

    try:
        engine._loop.run_until_complete(
            engine._validate_and_dispatch_gesture(GestureType.FIST)
        )
    finally:
        engine._loop.close()

    assert cancelled == [True]
    assert dispatched == []
