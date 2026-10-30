"""Desktop screen streamer for mobile remote-control sessions.

Captures the host screen at a configurable frame-rate and publishes
``DESKTOP_FRAME`` events so that authenticated mobile clients can render a
live view and send back mouse/keyboard commands.

Security notes
--------------
* Only clients whose ``source_device_id`` has been registered via
  ``DESKTOP_STREAM_START`` receive frames.
* The ``source_device_id`` must match the device that sent the start request;
  it is never inferred from the frame payload itself.
* Frame size is hard-limited to ~560 KB (same ceiling as browser frames) to
  prevent saturating the WebSocket bus.
"""

import asyncio
import base64
import io
import logging
import time
from typing import Callable, Coroutine, Dict, Optional, Set

logger = logging.getLogger(__name__)

_MAX_FRAME_BYTES = 560_000
_TARGET_WIDTH = 960
_TARGET_HEIGHT = 540
_DEFAULT_FPS = 10
_MIN_FPS = 1
_MAX_FPS = 30
_JPEG_QUALITY = 60


class DesktopStreamer:
    """Manages per-device streaming tasks for the remote-desktop feature.

    Parameters
    ----------
    publish_event:
        Async callable ``(event_name: str, payload: dict) -> None`` used to
        emit ``DESKTOP_FRAME`` events into the desktop_bridge event bus.
    screen_engine:
        Instance of :class:`~services.agent.perception.screen_engine.ScreenEngine`.
    fps:
        Target frame-rate.  Clamped to ``[_MIN_FPS, _MAX_FPS]``.
    """

    def __init__(
        self,
        publish_event: Callable[[str, dict], Coroutine],
        screen_engine,
        fps: int = _DEFAULT_FPS,
    ) -> None:
        self._publish = publish_event
        self._screen_engine = screen_engine
        self._fps: int = max(_MIN_FPS, min(_MAX_FPS, int(fps)))
        # device_id -> asyncio.Task
        self._tasks: Dict[str, asyncio.Task] = {}
        # device_ids currently streaming
        self._active: Set[str] = set()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self, source_device_id: str) -> None:
        """Begin streaming to *source_device_id* if not already active."""
        if source_device_id in self._active:
            return
        self._active.add(source_device_id)
        task = asyncio.create_task(
            self._stream_loop(source_device_id),
            name=f"desktop_stream:{source_device_id}",
        )
        self._tasks[source_device_id] = task
        task.add_done_callback(lambda t: self._tasks.pop(source_device_id, None))
        logger.info("Desktop stream started for device %s", source_device_id)

    def stop(self, source_device_id: str) -> None:
        """Stop streaming to *source_device_id*."""
        self._active.discard(source_device_id)
        task = self._tasks.pop(source_device_id, None)
        if task and not task.done():
            task.cancel()
        logger.info("Desktop stream stopped for device %s", source_device_id)

    def stop_all(self) -> None:
        """Stop every active streaming task (e.g. on shutdown)."""
        for device_id in list(self._active):
            self.stop(device_id)

    @property
    def active_devices(self) -> Set[str]:
        return set(self._active)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _stream_loop(self, source_device_id: str) -> None:
        interval = 1.0 / self._fps
        consecutive_errors = 0
        while source_device_id in self._active:
            start = time.monotonic()
            try:
                frame_b64 = await asyncio.to_thread(self._capture_frame)
                if frame_b64:
                    await self._publish(
                        "DESKTOP_FRAME",
                        {
                            "source_device_id": source_device_id,
                            "image_base64": frame_b64,
                            "mime_type": "image/jpeg",
                        },
                    )
                consecutive_errors = 0
            except asyncio.CancelledError:
                break
            except Exception as exc:
                consecutive_errors += 1
                logger.warning(
                    "Desktop frame capture error (attempt %d): %s",
                    consecutive_errors,
                    exc,
                )
                if consecutive_errors >= 10:
                    logger.error(
                        "Too many consecutive desktop capture errors; "
                        "stopping stream for device %s",
                        source_device_id,
                    )
                    break
            elapsed = time.monotonic() - start
            await asyncio.sleep(max(0.0, interval - elapsed))
        self._active.discard(source_device_id)

    def _capture_frame(self) -> Optional[str]:
        """Capture → resize → JPEG-encode → base64.  Returns None on error."""
        try:
            from PIL import Image

            raw_png = self._screen_engine.capture_full()
            if not raw_png:
                return None
            img = Image.open(io.BytesIO(raw_png)).convert("RGB")
            img.thumbnail((_TARGET_WIDTH, _TARGET_HEIGHT), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
            data = buf.getvalue()
            if len(data) > _MAX_FRAME_BYTES:
                # Re-compress at lower quality if still too large
                buf2 = io.BytesIO()
                img.save(buf2, format="JPEG", quality=40, optimize=True)
                data = buf2.getvalue()
            if len(data) > _MAX_FRAME_BYTES:
                return None
            return base64.b64encode(data).decode()
        except Exception as exc:
            logger.debug("_capture_frame failed: %s", exc)
            return None
