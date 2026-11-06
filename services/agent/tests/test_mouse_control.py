import asyncio
import io
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from services.agent.tools import mouse_tool as mouse_tool_module
from services.agent.tools.mouse_tool import MouseTool
from services.agent.perception.screen_observation_policy import (
    screen_observation_scope,
)


def _valid_screenshot_bytes():
    image_buffer = io.BytesIO()
    Image.new("RGB", (1, 1)).save(image_buffer, format="PNG")
    return image_buffer.getvalue()


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"operation": "unknown"},
        {"operation": "get_position", "x": 10},
        {"operation": "click", "x": True, "y": 10},
        {"operation": "click", "x": 10, "y": 10, "button": []},
        {"operation": "drag", "from_x": 1, "from_y": 2, "to_x": 3, "to_y": 4, "duration": 4},
        {"operation": "scroll", "x": 1, "y": 2, "amount": 0},
        {"operation": "scroll", "x": 1, "y": 2, "amount": 100},
        {"operation": "move", "x": 1, "y": 2, "command": "extra"},
    ],
)
def test_mouse_tool_rejects_invalid_operations_and_arguments(params):
    assert not MouseTool().validate_params(params)


def test_mouse_tool_bounds_optional_target_description():
    tool = MouseTool()

    assert tool.validate_params({
        "operation": "click",
        "x": 10,
        "y": 20,
        "target_description": "Delete workspace",
    })
    assert not tool.validate_params({
        "operation": "click",
        "x": 10,
        "y": 20,
        "target_description": "x" * 301,
    })
    assert not tool.validate_params({
        "operation": "move",
        "x": 10,
        "y": 20,
        "target_description": "Delete workspace",
    })


def test_mouse_tool_schema_documents_operations_and_safe_bounds():
    properties = MouseTool().get_schema()["parameters"]["properties"]

    assert set(properties["operation"]["enum"]) == {
        "move",
        "click",
        "double_click",
        "right_click",
        "drag",
        "scroll",
        "get_position",
    }
    assert properties["duration"]["maximum"] == 3.0
    assert properties["amount"]["minimum"] == -10
    assert properties["amount"]["maximum"] == 10
    assert "not" not in properties["amount"]
    assert "target_description" in properties


def test_mouse_tool_escalates_consequential_coordinate_targets():
    tool = MouseTool()

    assert tool.permission_level_for({
        "operation": "click",
        "x": 20,
        "y": 30,
        "target_description": "Delete account",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "operation": "drag",
        "from_x": 20,
        "from_y": 30,
        "to_x": 40,
        "to_y": 50,
        "target_description": "Move to trash",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "operation": "click",
        "x": 20,
        "y": 30,
        "target_description": "Open settings",
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "operation": "move",
        "x": 20,
        "y": 30,
        "target_description": "Delete account",
    }) == "LOW_RISK"


@pytest.mark.asyncio
async def test_mouse_tool_rejects_out_of_screen_coordinates_before_click(monkeypatch):
    click = Mock()
    monkeypatch.setattr(mouse_tool_module.pyautogui, "size", lambda: (100, 80))
    monkeypatch.setattr(mouse_tool_module.pyautogui, "click", click)

    result = await MouseTool().execute({
        "operation": "click",
        "x": 100,
        "y": 20,
    })

    assert not result.success
    assert "within the current screen" in result.error
    click.assert_not_called()


@pytest.mark.asyncio
async def test_mouse_tool_runs_click_off_event_loop_with_validated_coordinates(
    monkeypatch,
):
    click = Mock()
    monkeypatch.setattr(mouse_tool_module.pyautogui, "size", lambda: (100, 80))
    monkeypatch.setattr(mouse_tool_module.pyautogui, "click", click)

    result = await MouseTool().execute({
        "operation": "click",
        "x": 99,
        "y": 79,
        "button": "right",
    })

    assert result.success
    assert result.output == {"operation": "click"}
    click.assert_called_once_with(x=99, y=79, button="right")


@pytest.mark.asyncio
async def test_mouse_action_returns_post_action_screenshot_when_allowed(monkeypatch):
    click = Mock()
    screenshot = _valid_screenshot_bytes()
    monkeypatch.setattr(mouse_tool_module.pyautogui, "size", lambda: (100, 80))
    monkeypatch.setattr(mouse_tool_module.pyautogui, "click", click)
    monkeypatch.setattr(
        mouse_tool_module,
        "ScreenEngine",
        lambda: SimpleNamespace(
            capture_context=lambda: {"screenshot_bytes": screenshot}
        ),
    )

    with screen_observation_scope(True):
        result = await MouseTool().execute({
            "operation": "click",
            "x": 20,
            "y": 30,
        })

    assert result.success
    assert result.output == {
        "operation": "click",
        "screenshot_bytes": screenshot,
    }


@pytest.mark.asyncio
async def test_mouse_action_rejects_invalid_post_action_image(monkeypatch):
    monkeypatch.setattr(mouse_tool_module.pyautogui, "size", lambda: (100, 80))
    monkeypatch.setattr(mouse_tool_module.pyautogui, "click", Mock())
    monkeypatch.setattr(
        mouse_tool_module,
        "ScreenEngine",
        lambda: SimpleNamespace(
            capture_context=lambda: {"screenshot_bytes": b"not-an-image"}
        ),
    )

    with screen_observation_scope(True):
        result = await MouseTool().execute({
            "operation": "click",
            "x": 20,
            "y": 30,
        })

    assert not result.success
    assert result.output["action_may_have_succeeded"] is True
    assert "screenshot" in result.error
    assert "before retrying" in result.error


@pytest.mark.asyncio
async def test_mouse_action_reports_uncertain_effect_when_capture_fails(monkeypatch):
    monkeypatch.setattr(mouse_tool_module.pyautogui, "size", lambda: (100, 80))
    monkeypatch.setattr(mouse_tool_module.pyautogui, "click", Mock())

    def fail_capture():
        raise OSError("capture unavailable")

    monkeypatch.setattr(
        mouse_tool_module,
        "ScreenEngine",
        lambda: SimpleNamespace(capture_context=fail_capture),
    )

    with screen_observation_scope(True):
        result = await MouseTool().execute({
            "operation": "click",
            "x": 20,
            "y": 30,
        })

    assert not result.success
    assert result.output["action_may_have_succeeded"] is True
    assert "before retrying" in result.error


@pytest.mark.asyncio
async def test_mouse_tool_unknown_operation_is_never_reported_as_success():
    result = await MouseTool().execute({"operation": "unknown"})

    assert not result.success
    assert "Invalid mouse operation" in result.error
