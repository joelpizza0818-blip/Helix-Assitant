"""Tests for desktop-control configuration parsing."""

import json

import pytest

from ..config.settings import DesktopControlConfig, DesktopControlConfigError


def test_loads_desktop_control_defaults():
    config = DesktopControlConfig.load()

    assert config.monitor_index == 0
    assert config.max_wait_seconds == 30
    assert "ctrl+a" in config.allowed_hotkeys
    assert config.max_accessibility_elements == 100


def test_legacy_config_uses_accessibility_defaults(tmp_path):
    config_path = tmp_path / "desktop-control.json"
    config_path.write_text(
        json.dumps({
            "monitor_index": 0,
            "max_wait_seconds": 30,
            "max_text_characters": 100,
            "max_scroll_steps": 10,
            "mouse_move_duration_ms": 200,
            "allowed_hotkeys": ["ctrl+a"],
        }),
        encoding="utf-8",
    )

    config = DesktopControlConfig.load(config_path)

    assert config.max_accessibility_elements == 100
    assert config.max_accessibility_depth == 5
    assert config.accessibility_cache_ttl_ms == 30000


def test_config_rejects_boolean_for_integer_setting(tmp_path):
    config_path = tmp_path / "desktop-control.json"
    data = {
        "monitor_index": True,
        "max_wait_seconds": 30,
        "max_text_characters": 100,
        "max_scroll_steps": 10,
        "mouse_move_duration_ms": 200,
        "allowed_hotkeys": ["ctrl+a"],
    }
    config_path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(DesktopControlConfigError, match="integer"):
        DesktopControlConfig.load(config_path)
