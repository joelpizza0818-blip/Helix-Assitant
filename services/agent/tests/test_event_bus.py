import asyncio
import logging

from services.agent.core import event_bus as event_bus_module
from services.agent.core.event_bus import EventBus


def test_hand_landmarks_logs_at_most_every_three_minutes(monkeypatch, caplog):
    current_time = [100.0]
    monkeypatch.setattr(event_bus_module.time, "monotonic", lambda: current_time[0])
    bus = EventBus()

    async def publish_events():
        await bus.publish("HAND_LANDMARKS", {})
        current_time[0] += 179
        await bus.publish("HAND_LANDMARKS", {})
        current_time[0] += 1
        await bus.publish("HAND_LANDMARKS", {})

    with caplog.at_level(logging.INFO, logger="services.agent.core.event_bus"):
        asyncio.run(publish_events())

    assert [
        record.message
        for record in caplog.records
        if record.message == "Event published: HAND_LANDMARKS"
    ] == [
        "Event published: HAND_LANDMARKS",
        "Event published: HAND_LANDMARKS",
    ]


def test_other_events_are_still_logged_every_time(caplog):
    bus = EventBus()

    async def publish_events():
        await bus.publish("VOICE_WAKE", {})
        await bus.publish("VOICE_WAKE", {})

    with caplog.at_level(logging.INFO, logger="services.agent.core.event_bus"):
        asyncio.run(publish_events())

    assert sum(record.message == "Event published: VOICE_WAKE" for record in caplog.records) == 2
