from unittest.mock import AsyncMock

import pytest

from services.agent.tools.computer_tool import ComputerTool, TypeInFieldTool


class FakeScreen:
    def __init__(self, ui_click=False):
        self.ui_click = ui_click

    def capture_full(self):
        return b"screen"

    def get_active_window_info(self):
        return {"hwnd": 123}

    def click_ui_element(self, _name, _hwnd):
        return self.ui_click


class FakeOCR:
    def find_text(self, _image, _text):
        return 20, 30


@pytest.mark.asyncio
async def test_computer_click_falls_back_from_ui_automation_to_ocr():
    computer = ComputerTool()
    computer.screen_engine = FakeScreen()
    computer._ocr_engine = FakeOCR()
    computer._click = AsyncMock()

    assert await computer.click_on_element("Save")
    computer._click.assert_awaited_once_with(20, 30)


@pytest.mark.asyncio
async def test_type_in_field_retries_keyboard_and_requires_verification(monkeypatch):
    calls = []

    class FakeKeyboard:
        async def paste_text(self, _text):
            calls.append("paste")

        async def type_text(self, _text):
            calls.append("keyboard")

        async def hotkey(self, *keys):
            calls.append(("hotkey", keys))

    monkeypatch.setattr(
        "services.agent.tools.keyboard_tool.KeyboardTool",
        FakeKeyboard,
    )
    tool = TypeInFieldTool()
    tool.screen_engine = FakeScreen(ui_click=True)
    checks = iter((False, True))
    tool._wait_for_text = AsyncMock(side_effect=lambda _text: next(checks))

    assert await tool.type_in_field("Document", "HELIX verification")
    assert calls == ["paste", ("hotkey", ("ctrl", "a")), "keyboard"]


def test_desktop_tool_schemas_require_nonempty_and_bounded_input():
    click_tool = ComputerTool()
    type_tool = TypeInFieldTool()

    assert click_tool.validate_params({"description": "Save"})
    assert not click_tool.validate_params({"description": " "})
    assert type_tool.validate_params(
        {"field_description": "Document", "text": "HELIX"}
    )
    assert not type_tool.validate_params(
        {"field_description": "Document", "text": ""}
    )
