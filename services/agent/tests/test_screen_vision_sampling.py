import asyncio
import threading
import time

import pytest

from services.agent.perception.screen_vision_sampling import (
    DEFAULT_SCREEN_VISION_INTERVAL_MS,
    ScreenVisionSampler,
    capture_in_thread_and_discard_on_cancel,
)


def _sampler(
    *,
    enabled=lambda: True,
    task_active=lambda: True,
    capability=lambda: True,
    credential=lambda: True,
    capture=None,
    analyze=None,
    report=None,
    interval_ms=DEFAULT_SCREEN_VISION_INTERVAL_MS,
    clock=None,
    sleep=None,
):
    return ScreenVisionSampler(
        interval_ms=interval_ms,
        enabled=enabled,
        task_active=task_active,
        has_vision_capability=capability,
        has_provider_credential=credential,
        capture_frame=capture or (lambda: b"mock-frame"),
        analyze_frame=analyze or (lambda _frame: "mock-analysis"),
        report=report or (lambda _event: None),
        clock=clock or (lambda: 0),
        sleep=sleep or asyncio.sleep,
    )


def test_default_interval_is_ten_seconds_and_sampling_uses_fixed_cadence():
    async def run():
        now = [0.0]
        active = [True]
        enabled = [True]
        sample_times = []
        sleeps = []

        def capture():
            sample_times.append(now[0])
            return b"mock-frame"

        async def sleep(delay):
            sleeps.append(delay)
            now[0] += delay
            if len(sleeps) == 3:
                active[0] = False
                enabled[0] = False
            await asyncio.sleep(0)

        sampler = _sampler(
            enabled=lambda: enabled[0],
            task_active=lambda: active[0],
            capture=capture,
            interval_ms=DEFAULT_SCREEN_VISION_INTERVAL_MS,
            clock=lambda: now[0],
            sleep=sleep,
        )
        assert sampler.start()
        await sampler._worker
        assert sample_times == [0.0, 10.0, 20.0]
        assert sleeps == [10.0, 10.0, 10.0]

    assert DEFAULT_SCREEN_VISION_INTERVAL_MS == 10_000
    asyncio.run(run())


@pytest.mark.parametrize(
    ("capability", "credential", "frame", "reason"),
    [
        (False, True, b"mock-frame", "no_vision_capability"),
        (True, False, b"mock-frame", "no_provider_credential"),
        (True, True, None, "no_frame"),
    ],
)
def test_sampler_never_calls_model_without_capability_key_and_frame(
    capability, credential, frame, reason
):
    async def run():
        captures = []
        analyses = []
        events = []
        sampler = _sampler(
            capability=lambda: capability,
            credential=lambda: credential,
            capture=lambda: captures.append(True) or frame,
            analyze=lambda image: analyses.append(image),
            report=events.append,
        )

        await sampler._sample_once()

        assert analyses == []
        assert events == [{"status": "skipped", "reason": reason}]
        if not capability or not credential:
            assert captures == []
        else:
            assert captures == [True]

    asyncio.run(run())


def test_sampler_waits_without_sampling_until_a_task_is_active():
    async def run():
        active = [False]
        enabled = [True]
        now = [0.0]
        captures = []
        sleeps = []

        async def sleep(delay):
            sleeps.append(delay)
            now[0] += delay
            if len(sleeps) == 2:
                active[0] = True
            elif len(sleeps) == 3:
                enabled[0] = False
            await asyncio.sleep(0)

        sampler = _sampler(
            enabled=lambda: enabled[0],
            task_active=lambda: active[0],
            capture=lambda: captures.append(now[0]) or b"mock-frame",
            clock=lambda: now[0],
            sleep=sleep,
        )
        assert sampler.start()
        await sampler._worker
        assert captures == [2.0]
        assert sleeps == [1.0, 1.0, 10.0]

    asyncio.run(run())


def test_stop_cancels_active_analysis_and_prevents_later_samples():
    async def run():
        started = asyncio.Event()
        never_finishes = asyncio.Event()
        captures = []

        async def analyze(_frame):
            started.set()
            await never_finishes.wait()

        sampler = _sampler(
            capture=lambda: captures.append(True) or b"mock-frame",
            analyze=analyze,
        )
        assert sampler.start()
        await started.wait()
        await sampler.stop()
        assert sampler._worker is None
        assert captures == [True]
        assert not any(isinstance(value, bytes) for value in vars(sampler).values())

    asyncio.run(run())


def test_stop_waits_for_in_flight_threaded_capture_and_discards_its_frame():
    async def run():
        started = threading.Event()
        release = threading.Event()
        analyzed = []

        def capture():
            started.set()
            release.wait(timeout=5)
            return b"captured-after-disable"

        sampler = _sampler(
            capture=lambda: b"unused",
            analyze=analyzed.append,
        )
        sampler._capture_frame = lambda: capture_in_thread_and_discard_on_cancel(
            capture
        )
        assert sampler.start()
        await asyncio.to_thread(started.wait, 2)

        stop_task = asyncio.create_task(sampler.stop())
        await asyncio.sleep(0.02)
        assert not stop_task.done()
        release.set()
        await stop_task

        assert analyzed == []

    asyncio.run(run())


def test_model_errors_are_reported_as_errors_not_success():
    async def run():
        events = []

        async def fail(_frame):
            raise RuntimeError("mock model failure")

        sampler = _sampler(analyze=fail, report=events.append)
        await sampler._sample_once()
        assert events == [{
            "status": "error",
            "reason": "RuntimeError",
        }]

    asyncio.run(run())


def test_failed_vision_analysis_waits_for_next_request_before_retrying():
    async def run():
        active = [True]
        attempts = []

        async def fail_analysis(_frame):
            attempts.append(True)
            raise RuntimeError("mock provider failure")

        sampler = _sampler(
            task_active=lambda: active[0],
            analyze=fail_analysis,
        )
        await sampler._sample_once()
        await sampler._sample_once()
        assert len(attempts) == 1

        active[0] = False
        await sampler._sample_once()
        active[0] = True
        await sampler._sample_once()

        assert len(attempts) == 2

    asyncio.run(run())
