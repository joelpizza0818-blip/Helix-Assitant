"""Tests for capture policy enforcement and monitor selection."""

from pathlib import Path

import pytest

from ..config.settings import DesktopControlConfig
from ..perception.capture import (
    DesktopScreenCapture,
    ScreenCaptureDenied,
)
from services.agent.perception.screen_observation_policy import (
    screen_observation_scope,
)


@pytest.fixture
def config() -> DesktopControlConfig:
    config_path = Path(__file__).parents[1] / "config" / "defaults.json"
    return DesktopControlConfig.load(config_path)


@pytest.mark.asyncio
async def test_capture_requires_existing_screen_observation_permission(config):
    capture = DesktopScreenCapture(config)

    with screen_observation_scope(False):
        with pytest.raises(ScreenCaptureDenied, match="disabled"):
            await capture.capture_monitor(0)


@pytest.mark.asyncio
async def test_capture_selects_requested_monitor_only_when_allowed(
    config,
    monkeypatch,
):
    class FakeScreenEngine:
        def __init__(self) -> None:
            self.settings = None

        def configure(self, settings: dict) -> None:
            self.settings = settings

        def capture_full(self) -> bytes:
            return b"monitor image"

    engine = FakeScreenEngine()
    capture = DesktopScreenCapture(config, screen_engine=engine)
    monkeypatch.setattr(
        capture,
        "_list_monitors_sync",
        lambda: [
            {"index": 0, "left": 0, "top": 0, "width": 100, "height": 80},
            {"index": 1, "left": 100, "top": 0, "width": 100, "height": 80},
        ],
    )

    with screen_observation_scope(True):
        result = await capture.capture_monitor(1)

    assert result.image == b"monitor image"
    assert result.bounds["index"] == 1
    assert engine.settings == {"display_index": 1}


@pytest.mark.asyncio
async def test_capture_rejects_unknown_monitor(config, monkeypatch):
    capture = DesktopScreenCapture(config)
    monkeypatch.setattr(capture, "_list_monitors_sync", lambda: [])

    with screen_observation_scope(True):
        with pytest.raises(ValueError, match="invalid"):
            await capture.capture_monitor(0)
