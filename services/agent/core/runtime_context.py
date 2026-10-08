import platform


def describe_runtime_os() -> str:
    operating_system = platform.system()
    if operating_system == "Windows":
        version = platform.version()
        try:
            build = int(version.rsplit(".", 1)[-1])
        except ValueError:
            return f"Windows {platform.release()}"
        product = (
            "Windows 11"
            if platform.release() == "10" and build >= 22000
            else f"Windows {platform.release()}"
        )
        return f"{product} (build {build})"
    if operating_system == "Darwin":
        return f"macOS {platform.mac_ver()[0] or platform.release()}"
    if operating_system == "Linux":
        try:
            distribution = platform.freedesktop_os_release().get("PRETTY_NAME")
        except (OSError, AttributeError):
            distribution = None
        return distribution or f"Linux {platform.release()}"
    return f"{operating_system} {platform.release()}"


def get_runtime_command_context(tool_registry=None) -> str:
    operating_system = platform.system()
    operating_system_name = describe_runtime_os()
    architecture = platform.machine()
    shell_tool = tool_registry.get_tool("shell_tool") if tool_registry else None
    configured_shell = getattr(shell_tool, "default_shell_type", None)

    if operating_system == "Windows":
        shell = configured_shell or "powershell"
        if shell == "wsl":
            return (
                f"Runtime OS: {operating_system_name} ({architecture}); the configured "
                "generic shell is WSL Bash, so use Linux commands and paths with "
                "shell_tool. powershell_tool uses PowerShell syntax and cmd_tool "
                "uses Windows CMD syntax."
            )
        if shell == "bash":
            return (
                f"Runtime OS: {operating_system_name} ({architecture}); the configured "
                "generic shell is Bash. Use Bash syntax and paths supported by that "
                "Bash installation; powershell_tool and cmd_tool use Windows syntax."
            )
        if shell == "cmd":
            return (
                f"Runtime OS: {operating_system_name} ({architecture}); the configured "
                "generic shell is Windows CMD. Use CMD syntax with shell_tool; "
                "powershell_tool uses PowerShell syntax."
            )
        return (
            f"Runtime OS: {operating_system_name} ({architecture}). The configured "
            f"generic shell is {shell}; powershell_tool uses PowerShell syntax "
            "and cmd_tool uses Windows CMD syntax. Prefer PowerShell for shell "
            "commands; never send Bash/Linux commands or Unix paths on Windows."
        )

    shell = configured_shell or "bash"
    if shell == "powershell":
        return (
            f"Runtime OS: {operating_system_name} ({architecture}); the configured shell is "
            "PowerShell Core. Use PowerShell syntax and POSIX paths."
        )
    return (
        f"Runtime OS: {operating_system_name} ({architecture}); generic shell: {shell}. "
        "Use POSIX commands and paths. Do not call Windows CMD tools."
    )
