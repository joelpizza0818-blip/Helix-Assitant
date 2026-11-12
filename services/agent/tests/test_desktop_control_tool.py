"""Tests for on-demand ReAct integration of desktop control."""

from pathlib import Path
from typing import Any

import pytest

from services.agent.ai.google_provider import GoogleProvider
from services.agent.core.orchestrator import _should_observe_screen
from services.agent.core.tool_registry import ToolRegistry
from services.agent.desktop_control.actions.executor import ActionReceipt
from services.agent.security.permission_manager import (
    PermissionManager,
    PermissionMode,
)
from services.agent.tools.desktop_control_tool import DesktopControlTool


class FakeExecutor:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def execute(self, payload: dict[str, Any]) -> ActionReceipt:
        self.calls.append(payload)
        return ActionReceipt(
            action=payload["action"],
            result=(
                {"pid": 42}
                if payload["action"] == "open_application"
                else {"elements": [{"element_id": "ui-1", "name": "Save"}]}
                if payload["action"] == "observe_ui"
                else None
            ),
        )


def test_desktop_tool_validates_action_and_requires_a_typing_target():
    tool = DesktopControlTool(FakeExecutor())

    assert not tool.validate_params({
        "action": "type_text",
        "window_handle": 42,
        "text": "safe test",
        "target_description": "Notepad document",
    })
    assert not tool.validate_params({
        "action": "click",
        "window_handle": 42,
        "x": 10,
        "y": 10,
        "target_description": "Save button",
    })
    assert tool.validate_params({
        "action": "click_element",
        "window_handle": 42,
        "element_id": "ui-1",
        "target_description": "Save button",
    })
    assert tool.validate_params({
        "action": "type_into_element",
        "window_handle": 42,
        "element_id": "ui-2",
        "text": "safe test",
        "target_description": "Document field",
    })


def test_desktop_tool_requires_confirmation_for_sensitive_targets():
    tool = DesktopControlTool(FakeExecutor())

    assert tool.permission_level_for({
        "action": "click_element",
        "window_handle": 42,
        "element_id": "ui-1",
        "target_description": "Send email",
    }) == "SYSTEM"
    assert tool.permission_level_for({
        "action": "click_element",
        "window_handle": 42,
        "element_id": "ui-1",
        "target_description": "Enviar mensaje",
    }) == "SYSTEM"
    assert tool.permission_level_for({
        "action": "type_into_element",
        "window_handle": 42,
        "element_id": "ui-2",
        "text": "test",
        "target_description": "Bank password field",
    }) == "SYSTEM"

    manager = PermissionManager(mode=PermissionMode.AUTO_APPROVE)
    evaluation = manager.evaluate_risk(
        tool.name,
        {"action": "click_element", "target_description": "Send email"},
        tool.permission_level_for({
            "action": "click_element",
            "target_description": "Send email",
        }),
    )
    assert evaluation.requires_confirmation
    assert evaluation.level.name == "SYSTEM"


@pytest.mark.asyncio
async def test_observe_ui_returns_accessible_controls_without_screenshot():
    executor = FakeExecutor()
    tool = DesktopControlTool(executor)

    result = await tool.execute({
        "action": "observe_ui",
        "window_handle": 42,
    })

    assert result.success
    assert result.output["result"]["elements"][0]["element_id"] == "ui-1"
    assert result.output["screen_text_is_untrusted_data"] is True
    assert "screenshot_bytes" not in result.output
    assert executor.calls == [{
        "action": "observe_ui",
        "window_handle": 42,
    }]


def test_native_tool_discovery_registers_desktop_control():
    registry = ToolRegistry()

    registry.auto_discover(str(Path(__file__).resolve().parents[1] / "tools"))

    tool = registry.get_tool("computer.desktop_control")
    assert isinstance(tool, DesktopControlTool)
    assert "HELIX GUI can remain on the user's current desktop" in tool.description
    assert "initial list_windows preflight" in tool.description


def test_desktop_tool_schema_is_accepted_by_google_function_declaration():
    schema = DesktopControlTool().get_schema()

    converted = GoogleProvider._convert_tools([{
        "name": schema["name"],
        "description": schema["description"],
        "parameters": schema["parameters"],
    }])

    assert converted[0].function_declarations[0].parameters is not None
    actions = schema["parameters"]["properties"]["action"]["enum"]
    assert "click_element" in actions
    assert "click" not in actions
    assert "type_text" not in actions


@pytest.mark.parametrize(
    "description",
    [
        "Open Notepad and type a test sentence",
        "Abre el bloc de notas y escribe una prueba",
        "Launch Calculator then click its display",
        "Use desktop control to inspect the open Explorer window",
    ],
)
def test_compound_desktop_requests_enable_on_demand_observation(description):
    assert _should_observe_screen(True, description)


@pytest.mark.parametrize("description", ["Open Word", "Abre Word", "Tell me a joke"])
def test_app_mentions_alone_do_not_enable_desktop_observation(description):
    assert not _should_observe_screen(True, description)
