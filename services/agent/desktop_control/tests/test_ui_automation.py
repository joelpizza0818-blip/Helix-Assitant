"""Tests for bounded UI Automation snapshots and element actions."""

from dataclasses import dataclass
from typing import Any

import pytest

from ..perception import ui_automation
from ..perception.ui_automation import (
    UIAutomationError,
    UIAutomationUnavailable,
    WindowsUIAutomation,
)


@dataclass
class FakeRectangle:
    left: int
    top: int
    right: int
    bottom: int


class FakeControl:
    def __init__(
        self,
        name: str,
        role: str,
        *,
        children: list["FakeControl"] | None = None,
        enabled: bool = True,
        offscreen: bool = False,
        value_pattern: Any | None = None,
    ) -> None:
        self.Name = name
        self.ControlTypeName = role
        self.BoundingRectangle = FakeRectangle(10, 20, 110, 50)
        self.IsEnabled = enabled
        self.IsOffscreen = offscreen
        self._children = children or []
        self._value_pattern = value_pattern
        self.invocations = 0
        self.clicks = 0

    def GetChildren(self) -> list["FakeControl"]:
        return self._children

    def GetInvokePattern(self):
        return self

    def Invoke(self) -> None:
        self.invocations += 1

    def Click(self) -> None:
        self.clicks += 1

    def GetValuePattern(self):
        if self._value_pattern is None:
            raise RuntimeError("Value pattern unavailable")
        return self._value_pattern


class FakeAutomationModule:
    def __init__(self, root: FakeControl) -> None:
        self.root = root

    def ControlFromHandle(self, hwnd: int) -> FakeControl:
        assert hwnd == 42
        return self.root


def make_automation(root: FakeControl, **settings: Any) -> WindowsUIAutomation:
    defaults = {
        "max_elements": 100,
        "max_depth": 5,
        "cache_ttl_ms": 500,
    }
    defaults.update(settings)
    return WindowsUIAutomation(
        **defaults,
        automation_module=FakeAutomationModule(root),
    )


def test_observe_returns_bounded_elements_with_accessible_properties():
    button = FakeControl("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root, max_elements=2)

    snapshot = automation.observe(42, "Editor")

    assert snapshot["window"] == {"hwnd": 42, "title": "Editor"}
    assert snapshot["elements"] == [
        {
            "element_id": "ui-1-1",
            "name": "Editor",
            "role": "WindowControl",
            "state": "enabled",
            "bounding_box": {"x": 10, "y": 20, "width": 100, "height": 30},
        },
        {
            "element_id": "ui-1-2",
            "name": "Save",
            "role": "ButtonControl",
            "state": "enabled",
            "bounding_box": {"x": 10, "y": 20, "width": 100, "height": 30},
        },
    ]


def test_click_element_uses_invoke_pattern_and_expires_element_ids():
    button = FakeControl("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root)
    automation.observe(42, "Editor")

    assert automation.click_element(42, "ui-1-2") == "invoke"
    assert button.invocations == 1
    with pytest.raises(UIAutomationError, match="stale"):
        automation.click_element(42, "ui-1-2")


def test_fresh_observation_assigns_new_ids_and_rejects_old_ids():
    button = FakeControl("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root)
    previous_id = automation.observe(42, "Editor")["elements"][1]["element_id"]
    automation.invalidate()
    current_id = automation.observe(42, "Editor")["elements"][1]["element_id"]

    assert previous_id != current_id
    with pytest.raises(UIAutomationError, match="stale"):
        automation.click_element(42, previous_id)


def test_element_ids_expire_after_configured_cache_ttl(monkeypatch):
    button = FakeControl("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root, cache_ttl_ms=100)
    automation.observe(42, "Editor")
    observed_at = ui_automation.time.monotonic()
    monkeypatch.setattr(
        ui_automation.time,
        "monotonic",
        lambda: observed_at + 0.2,
    )

    with pytest.raises(UIAutomationError, match="stale"):
        automation.click_element(42, "ui-1-2")


def test_value_pattern_is_set_without_focusing_or_typing():
    class ValuePattern:
        def __init__(self) -> None:
            self.value = None

        def SetValue(self, value: str) -> None:
            self.value = value

    pattern = ValuePattern()
    field = FakeControl("Name", "EditControl", value_pattern=pattern)
    root = FakeControl("Editor", "WindowControl", children=[field])
    automation = make_automation(root)
    automation.observe(42, "Editor")

    automation.set_value(42, "ui-1-2", "Hello")
    assert pattern.value == "Hello"

    field._value_pattern = None
    automation.observe(42, "Editor")
    with pytest.raises(UIAutomationError, match="safe Value pattern"):
        automation.set_value(42, "ui-2-2", "fallback")
    assert field.clicks == 0


def test_click_element_does_not_fall_back_to_synthetic_click():
    class NoInvokePattern(FakeControl):
        def GetInvokePattern(self):
            raise RuntimeError("Invoke pattern unavailable")

    button = NoInvokePattern("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root)
    automation.observe(42, "Editor")

    with pytest.raises(UIAutomationError, match="safe Invoke pattern"):
        automation.click_element(42, "ui-1-2")
    assert button.clicks == 0


def test_element_resolution_rejects_changed_control_identity():
    button = FakeControl("Save", "ButtonControl")
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root)
    automation.observe(42, "Editor")
    button.Name = "Delete"

    with pytest.raises(UIAutomationError, match="changed"):
        automation.click_element(42, "ui-1-2")


def test_disabled_and_offscreen_controls_are_not_activated():
    button = FakeControl("Save", "ButtonControl", enabled=False)
    root = FakeControl("Editor", "WindowControl", children=[button])
    automation = make_automation(root)
    automation.observe(42, "Editor")

    with pytest.raises(UIAutomationError, match="disabled"):
        automation.click_element(42, "ui-1-2")


def test_unavailable_uia_dependency_is_reported_explicitly(monkeypatch):
    import importlib

    def missing_module(name: str):
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", missing_module)
    automation = WindowsUIAutomation(10, 2, 0)

    with pytest.raises(UIAutomationUnavailable, match="uiautomation"):
        automation.observe(42, "Editor")
