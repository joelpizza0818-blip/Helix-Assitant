import asyncio
import os
import platform
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.agent.tools import shell_tool as shell_tool_module
from services.agent.tools.shell_tool import ShellTool


def test_shell_tool_defaults_to_a_shell_for_the_current_os():
    tool = ShellTool()

    expected_shell = "powershell" if os.name == "nt" else "bash"
    assert tool.default_shell_type == expected_shell
    assert platform.system() in tool.description


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"command": ""},
        {"command": "   "},
        {"command": 42},
        {"command": "echo ok", "timeout": True},
        {"command": "echo ok", "timeout": 1.5},
        {"command": "echo ok", "timeout": 301},
        {"command": "echo ok", "shell_type": "fish"},
        {"command": "echo ok", "shell_type": []},
        {"command": "echo ok", "working_dir": ""},
        {"command": "echo ok", "unexpected": "value"},
        {"command": "sudo rm -rf /"},
    ],
)
def test_shell_tool_rejects_invalid_commands_and_execution_options(params):
    assert not ShellTool().validate_params(params)


def test_shell_tool_schema_describes_validated_command_options():
    schema = ShellTool().get_schema()

    assert schema["required"] == ["command"]
    assert schema["additionalProperties"] is False
    assert schema["properties"]["command"]["maxLength"] == 32_000
    assert schema["properties"]["timeout"]["maximum"] == 300
    assert schema["properties"]["shell_type"]["enum"] == [
        "cmd",
        "powershell",
        "wsl",
        "bash",
    ]


@pytest.mark.asyncio
async def test_shell_tool_does_not_start_process_for_invalid_parameters(monkeypatch):
    create_process = AsyncMock()
    monkeypatch.setattr(
        shell_tool_module.asyncio,
        "create_subprocess_exec",
        create_process,
    )

    result = await ShellTool().execute({
        "command": "echo should not run",
        "timeout": "300",
    })

    assert not result.success
    assert "Invalid shell parameters" in result.error
    create_process.assert_not_awaited()


@pytest.mark.asyncio
async def test_bash_command_uses_bash_command_interpreter(monkeypatch):
    process = SimpleNamespace(
        communicate=AsyncMock(return_value=(b"ok", b"")),
        returncode=0,
    )
    create_process = AsyncMock(return_value=process)
    monkeypatch.setattr(
        shell_tool_module.shutil,
        "which",
        lambda name: "/usr/bin/bash" if name == "bash" else None,
    )
    monkeypatch.setattr(
        shell_tool_module.asyncio,
        "create_subprocess_exec",
        create_process,
    )

    result = await ShellTool().execute_command("pwd", shell_type="bash")

    assert result.stdout == "ok"
    assert result.exit_code == 0
    assert create_process.await_args.args == ("/usr/bin/bash", "-lc", "pwd")


@pytest.mark.asyncio
async def test_windows_cmd_is_not_run_on_non_windows_os(monkeypatch):
    if os.name == "nt":
        pytest.skip("This check applies only to non-Windows hosts.")

    create_process = AsyncMock()
    monkeypatch.setattr(
        shell_tool_module.asyncio,
        "create_subprocess_exec",
        create_process,
    )

    result = await ShellTool().execute_command("dir", shell_type="cmd")

    assert result.exit_code == -1
    assert "not available on this operating system" in result.stderr
    create_process.assert_not_awaited()
