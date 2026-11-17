from types import SimpleNamespace

from services.agent.core.react_loop import ReActLoop
from services.agent.security.permission_manager import PermissionManager


def _loop(mode, ceiling="LOW_RISK"):
    loop = ReActLoop.__new__(ReActLoop)
    loop.permissions_mode = mode
    loop.auto_approve_up_to = ceiling
    loop.permission_manager = PermissionManager(
        mode=mode,
        auto_approve_up_to=ceiling,
    )
    return loop


def _tool(name="shell_tool", level="EXECUTE", requires_confirmation=True):
    return SimpleNamespace(
        name=name,
        permission_level=level,
        requires_confirmation=requires_confirmation,
    )


def test_auto_approve_ignores_tool_level_confirmation_flags():
    level, requires_confirmation = _loop("AUTO_APPROVE")._tool_confirmation_decision(
        _tool(), {"command": "git status"}
    )

    assert level == "EXECUTE"
    assert requires_confirmation is False


def test_auto_approve_still_gates_system_actions():
    level, requires_confirmation = _loop("AUTO_APPROVE")._tool_confirmation_decision(
        _tool(name="system_tool", level="SYSTEM", requires_confirmation=True),
        {"action": "change_setting"},
    )

    assert level == "SYSTEM"
    assert requires_confirmation is True


def test_allow_all_ignores_confirmation_flags_and_risk_levels():
    level, requires_confirmation = _loop("ALLOW_ALL")._tool_confirmation_decision(
        _tool(),
        {"command": "git status"},
    )
    critical_level, critical_requires_confirmation = _loop(
        "ALLOW_ALL"
    )._tool_confirmation_decision(
        _tool(),
        {"command": "Remove-Item -Recurse C:\\secret"},
    )

    assert level == "EXECUTE"
    assert requires_confirmation is False
    assert critical_level == "CRITICAL"
    assert critical_requires_confirmation is False


def test_smart_approval_still_uses_the_configured_ceiling():
    level, requires_confirmation = _loop(
        "SMART_APPROVAL", ceiling="MODIFY"
    )._tool_confirmation_decision(
        _tool(name="filesystem_tool", level="MODIFY", requires_confirmation=False),
        {"path": "C:\\Temp\\file.txt"},
    )
    _, execute_requires_confirmation = _loop(
        "SMART_APPROVAL", ceiling="MODIFY"
    )._tool_confirmation_decision(
        _tool(),
        {"command": "git status"},
    )

    assert level == "MODIFY"
    assert requires_confirmation is False
    assert execute_requires_confirmation is True
