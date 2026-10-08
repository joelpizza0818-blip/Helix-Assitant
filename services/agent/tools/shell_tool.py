import asyncio
import logging
import os
import platform
import shutil
import time
import re
from typing import Any, Dict, Optional
from dataclasses import dataclass
from .base_tool import BaseTool, ToolResult

logger = logging.getLogger(__name__)

@dataclass
class ShellResult:
    stdout: str
    stderr: str
    exit_code: int
    execution_time_ms: float

class ShellTool(BaseTool):
    def __init__(self):
        self.default_shell_type = 'powershell' if os.name == "nt" else "bash"
        self.default_timeout = 30
        self.block_elevated_execution = True

    def configure(self, settings: Dict[str, Any]) -> None:
        shell_type = settings.get('shell_type', self.default_shell_type)
        if shell_type in {'cmd', 'powershell', 'wsl', 'bash'}:
            executable = {
                "cmd": "cmd.exe" if os.name == "nt" else None,
                "powershell": shutil.which("pwsh") or shutil.which("powershell.exe"),
                "wsl": "wsl.exe" if os.name == "nt" and shutil.which("wsl.exe") else None,
                "bash": shutil.which("bash"),
            }[shell_type]
            if executable:
                self.default_shell_type = shell_type
            else:
                logger.warning(
                    "Configured shell %s is not available on %s; keeping %s.",
                    shell_type,
                    os.name,
                    self.default_shell_type,
                )
        elif shell_type != self.default_shell_type:
            logger.warning(
                "Ignoring unsupported shell type %r; keeping %s.",
                shell_type,
                self.default_shell_type,
            )
        timeout = settings.get('shell_timeout_seconds', self.default_timeout)
        if isinstance(timeout, (int, float)) and not isinstance(timeout, bool):
            self.default_timeout = max(5, min(300, int(timeout)))
        if isinstance(settings.get('block_elevated_execution'), bool):
            self.block_elevated_execution = settings['block_elevated_execution']

    @property
    def name(self) -> str:
        return "shell_tool"

    @property
    def description(self) -> str:
        return (
            f"Execute a command using the configured {self.default_shell_type} shell "
            f"on {platform.system()}. Use syntax and paths valid for that shell and operating system."
        )

    @property
    def permission_level(self) -> str:
        return "EXECUTE"

    @property
    def requires_confirmation(self) -> bool:
        return True

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return "command" in params

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {"command": {"type": "string"}}
        }

    def validate_command(self, command: str) -> bool:
        if self.block_elevated_execution and re.search(
            r"(?:start-process\s+.*-verb\s+runas|\brunas\b|\bsudo\b|\bdoas\b)",
            command,
            re.IGNORECASE,
        ):
            return False
        return True

    async def execute_command(self, command: str, working_dir: Optional[str] = None, timeout: int = 30, shell_type: Optional[str] = None) -> ShellResult:
        start_time = time.time()
        try:
            shell_type = shell_type or self.default_shell_type
            if shell_type == 'cmd':
                if os.name != "nt":
                    raise OSError("Windows CMD is not available on this operating system.")
                cmd_args = ['cmd.exe', '/c', command]
            elif shell_type == 'powershell':
                executable = shutil.which("pwsh") or shutil.which("powershell.exe")
                if not executable:
                    raise OSError("PowerShell is not installed or not on PATH.")
                cmd_args = [executable, '-NoProfile', '-NonInteractive', '-Command', command]
            elif shell_type == 'wsl':
                executable = shutil.which("wsl.exe") if os.name == "nt" else None
                if not executable:
                    raise OSError("WSL is only available on Windows when wsl.exe is installed.")
                cmd_args = [executable, '--exec', 'bash', '-lc', command]
            elif shell_type == 'bash':
                executable = shutil.which("bash")
                if not executable:
                    raise OSError("Bash is not installed or not on PATH.")
                cmd_args = [executable, '-lc', command]
            else:
                raise ValueError(f"Unsupported shell type: {shell_type}")
                
            process = await asyncio.create_subprocess_exec(
                *cmd_args,
                cwd=working_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
                stdout = stdout_bytes.decode('utf-8', errors='replace')
                stderr = stderr_bytes.decode('utf-8', errors='replace')
                exit_code = process.returncode
            except asyncio.TimeoutError:
                process.kill()
                stdout, stderr, exit_code = "", "Command timed out", -1
                
        except Exception as e:
            stdout, stderr, exit_code = "", str(e), -1

        exec_time = (time.time() - start_time) * 1000
        return ShellResult(stdout=stdout, stderr=stderr, exit_code=exit_code, execution_time_ms=exec_time)

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        command = params["command"]
        if not self.validate_command(command):
            return ToolResult(success=False, output=None, error="Blocked dangerous command.")
        res = await self.execute_command(
            command,
            params.get("working_dir"),
            params.get("timeout", self.default_timeout),
            params.get("shell_type", self.default_shell_type),
        )
        return ToolResult(success=(res.exit_code == 0), output=res, error=res.stderr if res.exit_code != 0 else None)
