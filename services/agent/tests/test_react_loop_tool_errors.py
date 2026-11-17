from types import SimpleNamespace

from services.agent.core.react_loop import _tool_failure_output


def test_browser_page_failure_explains_missing_managed_page():
    message = _tool_failure_output(
        "read_active_browser_page",
        (
            "No recent browser page is available. Install and pair the HELIX "
            "extension, then open or refresh a supported Chrome/Edge page."
        ),
        None,
    )

    assert "Install and pair the HELIX extension" in message


def test_shell_failure_reports_exit_code_without_forwarding_stderr():
    message = _tool_failure_output(
        "powershell_tool",
        "Sensitive command output",
        SimpleNamespace(exit_code=1, stderr="Sensitive command output"),
    )

    assert "exit code 1" in message
    assert "Sensitive command output" not in message
