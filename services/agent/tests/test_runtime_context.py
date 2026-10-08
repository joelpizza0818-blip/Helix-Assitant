from types import SimpleNamespace

from services.agent.core import runtime_context


def test_runtime_context_identifies_windows_11_by_build(monkeypatch):
    monkeypatch.setattr(runtime_context.platform, "system", lambda: "Windows")
    monkeypatch.setattr(runtime_context.platform, "release", lambda: "10")
    monkeypatch.setattr(runtime_context.platform, "version", lambda: "10.0.26100")

    assert runtime_context.describe_runtime_os() == "Windows 11 (build 26100)"


def test_windows_context_includes_configured_shell_and_specific_tool_syntax(monkeypatch):
    monkeypatch.setattr(runtime_context.platform, "system", lambda: "Windows")
    monkeypatch.setattr(runtime_context.platform, "release", lambda: "10")
    monkeypatch.setattr(runtime_context.platform, "version", lambda: "10.0.19045")
    monkeypatch.setattr(runtime_context.platform, "machine", lambda: "AMD64")
    registry = SimpleNamespace(
        get_tool=lambda name: SimpleNamespace(default_shell_type="powershell")
        if name == "shell_tool"
        else None
    )

    context = runtime_context.get_runtime_command_context(registry)

    assert "Windows 10 (build 19045)" in context
    assert "PowerShell syntax" in context
    assert "Windows CMD syntax" in context
    assert "never send Bash/Linux commands" in context


def test_wsl_context_uses_linux_command_and_path_guidance(monkeypatch):
    monkeypatch.setattr(runtime_context.platform, "system", lambda: "Windows")
    monkeypatch.setattr(runtime_context.platform, "release", lambda: "10")
    monkeypatch.setattr(runtime_context.platform, "version", lambda: "10.0.26100")
    monkeypatch.setattr(runtime_context.platform, "machine", lambda: "AMD64")
    registry = SimpleNamespace(
        get_tool=lambda name: SimpleNamespace(default_shell_type="wsl")
        if name == "shell_tool"
        else None
    )

    context = runtime_context.get_runtime_command_context(registry)

    assert "WSL Bash" in context
    assert "Linux commands and paths" in context
