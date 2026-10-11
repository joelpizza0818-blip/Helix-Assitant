import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.agent.tools import mouse_tool as mouse_tool_module
from services.agent.tools.mouse_tool import MouseTool


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
async def test_mouse_tool_unknown_operation_is_never_reported_as_success():
    result = await MouseTool().execute({"operation": "unknown"})

    assert not result.success
    assert "Invalid mouse operation" in result.error
