from services.agent.core.conversation_execution import (
    _screen_observation_instruction,
)


def test_on_demand_capture_does_not_invite_unsolicited_inspection():
    instruction = _screen_observation_instruction(
        screen_request_active=False,
        on_demand_enabled=True,
        continuous_enabled=False,
        model_decides_enabled=False,
        desktop_control_tool_required=False,
    )

    assert instruction is not None
    assert "only for requests that explicitly ask" in instruction
    assert "do not call screen capture" in instruction
    assert "Otherwise, call" not in instruction


def test_model_decision_option_allows_model_selected_observation():
    instruction = _screen_observation_instruction(
        screen_request_active=False,
        on_demand_enabled=True,
        continuous_enabled=False,
        model_decides_enabled=True,
        desktop_control_tool_required=False,
    )

    assert instruction is not None
    assert "call computer.observe_screen only when useful" in instruction


def test_desktop_control_uses_its_dedicated_instructions():
    instruction = _screen_observation_instruction(
        screen_request_active=True,
        on_demand_enabled=True,
        continuous_enabled=True,
        model_decides_enabled=True,
        desktop_control_tool_required=True,
    )

    assert instruction is None
