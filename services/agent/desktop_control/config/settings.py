"""Configuration loading and validation for desktop control."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class DesktopControlConfigError(ValueError):
    """Desktop-control configuration is missing or invalid."""


@dataclass(frozen=True)
class DesktopControlConfig:
    monitor_index: int
    max_wait_seconds: float
    max_text_characters: int
    max_scroll_steps: int
    mouse_move_duration_ms: int
    allowed_hotkeys: tuple[str, ...]
    max_accessibility_elements: int = 100
    max_accessibility_depth: int = 5
    accessibility_cache_ttl_ms: int = 30000

    @classmethod
    def load(cls, path: Path | None = None) -> "DesktopControlConfig":
        """Load configuration from an explicit path, environment, or bundled JSON."""
        config_path = path or _configured_path()
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise DesktopControlConfigError(
                f"Desktop-control config file not found: {config_path}"
            ) from error
        except json.JSONDecodeError as error:
            raise DesktopControlConfigError(
                f"Desktop-control config is not valid JSON: {config_path}"
            ) from error

        if not isinstance(data, dict):
            raise DesktopControlConfigError(
                "Desktop-control config must contain a JSON object."
            )
        expected = {
            "monitor_index",
            "max_wait_seconds",
            "max_text_characters",
            "max_scroll_steps",
            "mouse_move_duration_ms",
            "allowed_hotkeys",
        }
        optional = {
            "max_accessibility_elements",
            "max_accessibility_depth",
            "accessibility_cache_ttl_ms",
        }
        missing = expected - data.keys()
        extra = data.keys() - expected - optional
        if missing or extra:
            raise DesktopControlConfigError(
                f"Invalid desktop-control config keys; missing={sorted(missing)}, "
                f"unknown={sorted(extra)}."
            )
        return cls(
            monitor_index=_integer(data, "monitor_index", minimum=0),
            max_wait_seconds=_number(data, "max_wait_seconds", minimum=0),
            max_text_characters=_integer(data, "max_text_characters", minimum=1),
            max_scroll_steps=_integer(data, "max_scroll_steps", minimum=1),
            mouse_move_duration_ms=_integer(
                data,
                "mouse_move_duration_ms",
                minimum=0,
            ),
            max_accessibility_elements=_optional_integer(
                data,
                "max_accessibility_elements",
                default=100,
                minimum=1,
            ),
            max_accessibility_depth=_optional_integer(
                data,
                "max_accessibility_depth",
                default=5,
                minimum=0,
            ),
            accessibility_cache_ttl_ms=_optional_integer(
                data,
                "accessibility_cache_ttl_ms",
                default=30000,
                minimum=0,
            ),
            allowed_hotkeys=_string_tuple(data, "allowed_hotkeys"),
        )


def _configured_path() -> Path:
    environment_path = os.environ.get("HELIX_DESKTOP_CONTROL_CONFIG")
    if environment_path:
        return Path(environment_path)
    return Path(__file__).with_name("defaults.json")


def _integer(data: dict[str, Any], name: str, *, minimum: int) -> int:
    value = data[name]
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise DesktopControlConfigError(
            f"Config value '{name}' must be an integer >= {minimum}."
        )
    return value


def _number(data: dict[str, Any], name: str, *, minimum: float) -> float:
    value = data[name]
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or value < minimum
    ):
        raise DesktopControlConfigError(
            f"Config value '{name}' must be a number >= {minimum}."
        )
    return float(value)


def _optional_integer(
    data: dict[str, Any],
    name: str,
    *,
    default: int,
    minimum: int,
) -> int:
    if name not in data:
        return default
    return _integer(data, name, minimum=minimum)


def _string_tuple(data: dict[str, Any], name: str) -> tuple[str, ...]:
    value = data[name]
    if (
        not isinstance(value, list)
        or any(not isinstance(item, str) or not item.strip() for item in value)
    ):
        raise DesktopControlConfigError(
            f"Config value '{name}' must be a list of non-empty strings."
        )
    return tuple(item.casefold() for item in value)
