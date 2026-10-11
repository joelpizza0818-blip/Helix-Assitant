"""Dependency-injected, bounded sampling primitives for continuous screen vision."""

import asyncio
import inspect
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

DEFAULT_SCREEN_VISION_INTERVAL_MS = 10_000
MIN_SCREEN_VISION_INTERVAL_MS = 10_000
MAX_SCREEN_VISION_INTERVAL_MS = 60_000
IDLE_TASK_CHECK_INTERVAL_SECONDS = 1
logger = logging.getLogger(__name__)


def validate_screen_vision_interval_ms(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("continuous_screen_vision_interval_ms must be an integer")
    if not MIN_SCREEN_VISION_INTERVAL_MS <= value <= MAX_SCREEN_VISION_INTERVAL_MS:
        raise ValueError(
            "continuous_screen_vision_interval_ms must be between "
            f"{MIN_SCREEN_VISION_INTERVAL_MS} and {MAX_SCREEN_VISION_INTERVAL_MS}"
        )
    return value


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


async def capture_in_thread_and_discard_on_cancel(
    capture: Callable[[], bytes | None],
) -> bytes | None:
    capture_task = asyncio.create_task(asyncio.to_thread(capture))
    try:
        return await asyncio.shield(capture_task)
    except asyncio.CancelledError:
        try:
            await asyncio.shield(capture_task)
        except Exception:
            logger.exception("Screen capture failed while continuous vision stopped.")
        raise


class ScreenVisionSampler:
    """Samples serially at a fixed interval and discards each frame after use."""

    def __init__(
        self,
        *,
        interval_ms: int,
        enabled: Callable[[], bool],
        task_active: Callable[[], bool | Awaitable[bool]],
        has_vision_capability: Callable[[], bool | Awaitable[bool]],
        has_provider_credential: Callable[[], bool | Awaitable[bool]],
        capture_frame: Callable[[], bytes | None | Awaitable[bytes | None]],
        analyze_frame: Callable[[bytes], Any | Awaitable[Any]],
        report: Callable[[dict], Any | Awaitable[Any]],
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ):
        self.interval_ms = validate_screen_vision_interval_ms(interval_ms)
        self._enabled = enabled
        self._task_active = task_active
        self._has_vision_capability = has_vision_capability
        self._has_provider_credential = has_provider_credential
        self._capture_frame = capture_frame
        self._analyze_frame = analyze_frame
        self._report_callback = report
        self._clock = clock
        self._sleep = sleep
        self._worker: asyncio.Task | None = None
        self._paused_until_idle = False

    def start(self) -> bool:
        if self._worker is not None and not self._worker.done():
            return False
        if not self._enabled():
            return False
        self._worker = asyncio.create_task(self._run())
        return True

    async def stop(self) -> None:
        worker = self._worker
        self._worker = None
        if worker is None or worker.done():
            return
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

    async def _emit(self, status: str, reason: str | None = None) -> None:
        event = {"status": status}
        if reason:
            event["reason"] = reason
        await _resolve(self._report_callback(event))

    async def _run(self) -> None:
        interval = self.interval_ms / 1000
        next_sample = self._clock()
        try:
            while self._enabled():
                task_active = await _resolve(self._task_active())
                if not task_active:
                    self._paused_until_idle = False
                    await self._sleep(
                        min(interval, IDLE_TASK_CHECK_INTERVAL_SECONDS)
                    )
                    continue
                if self._paused_until_idle:
                    await self._sleep(
                        min(interval, IDLE_TASK_CHECK_INTERVAL_SECONDS)
                    )
                    continue
                now = self._clock()
                if now < next_sample:
                    await self._sleep(next_sample - now)
                    continue
                await self._sample_once()
                next_sample = self._clock() + interval
        except asyncio.CancelledError:
            raise

    async def _sample_once(self) -> None:
        if not self._enabled():
            return
        if not await _resolve(self._task_active()):
            self._paused_until_idle = False
            return
        if self._paused_until_idle:
            return
        try:
            if not await _resolve(self._has_vision_capability()):
                await self._emit("skipped", "no_vision_capability")
                return
            if not await _resolve(self._has_provider_credential()):
                await self._emit("skipped", "no_provider_credential")
                return
            frame = await _resolve(self._capture_frame())
            if not frame:
                await self._emit("skipped", "no_frame")
                return
            await _resolve(self._analyze_frame(frame))
            await self._emit("analyzed")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._paused_until_idle = True
            await self._emit("error", type(error).__name__)
        finally:
            # Do not retain captured image bytes in sampler state or results.
            frame = None
