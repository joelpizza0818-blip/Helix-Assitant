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
        self.sandbox_enabled = False
        self.sandbox_mode = 'restricted'

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
        if isinstance(settings.get('sandbox_enabled'), bool):
            self.sandbox_enabled = settings['sandbox_enabled']
        if settings.get('sandbox_mode') in {'restricted', 'isolated', 'windows_sandbox', 'docker'}:
            self.sandbox_mode = settings['sandbox_mode']

    def _create_sandboxed_env(self) -> Dict[str, str]:
        safe_keys = {
            'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT',
            'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LANG', 'LC_ALL'
        }
        clean_env = {
            k: v for k, v in os.environ.items()
            if k.upper() in safe_keys and not any(
                secret in k.upper() for secret in ('KEY', 'TOKEN', 'SECRET', 'PASS', 'AUTH')
            )
        }
        clean_env['HELIX_SANDBOX'] = '1'
        clean_env['HELIX_SANDBOX_MODE'] = self.sandbox_mode
        return clean_env

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
        if not isinstance(params, dict):
            return False
        if not set(params).issubset(
            {"command", "working_dir", "timeout", "shell_type"}
        ):
            return False
        command = params.get("command")
        if not isinstance(command, str) or not command.strip() or len(command) > 32_000:
            return False
        working_dir = params.get("working_dir")
        if working_dir is not None and (
            not isinstance(working_dir, str) or not working_dir.strip()
        ):
            return False
        timeout = params.get("timeout", self.default_timeout)
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, int)
            or not 1 <= timeout <= 300
        ):
            return False
        shell_type = params.get("shell_type", self.default_shell_type)
        if not isinstance(shell_type, str) or shell_type not in {
            "cmd",
            "powershell",
            "wsl",
            "bash",
        }:
            return False
        return self.validate_command(command)

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 32000,
                    "description": (
                        "A command for the configured shell and current OS. "
                        "Use the runtime command guidance from the system context, "
                        "quote paths and user-provided values, and prefer one "
                        "focused command with explicit error handling."
                    ),
                },
                "working_dir": {
                    "type": "string",
                    "description": (
                        "Optional existing working directory. Use an absolute path "
                        "valid for the selected shell and OS."
                    ),
                },
                "timeout": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 300,
                    "description": "Optional execution timeout in seconds.",
                },
                "shell_type": {
                    "type": "string",
                    "enum": ["cmd", "powershell", "wsl", "bash"],
                    "description": (
                        "Optional shell override. Prefer the configured shell unless "
                        "the task explicitly requires another installed shell."
                    ),
                },
            },
            "required": ["command"],
            "additionalProperties": False,
        }

    def validate_command(self, command: str) -> bool:
        cmd_lower = command.lower()
        if self.block_elevated_execution and re.search(
            r"(?:start-process\s+.*-verb\s+runas|\brunas\b|\bsudo\b|\bdoas\b)",
            cmd_lower,
        ):
            return False
        # Block encoded command execution vectors (-enc, -encodedcommand, etc.)
        if re.search(r'(?:-|/)(?:e|enc|encodedcommand)\b', cmd_lower):
            return False
        # Block dynamic evaluation
        if re.search(r'\b(?:iex|invoke-expression)\b', cmd_lower):
            return False
        return True

    async def execute_command(self, command: str, working_dir: Optional[str] = None, timeout: int = 30, shell_type: Optional[str] = None) -> ShellResult:
        start_time = time.time()
        try:
            if not self.validate_command(command):
                return ShellResult(
                    stdout="",
                    stderr="Execution blocked: Command rejected by security policy (prohibited elevated, encoded, or dynamic execution).",
                    exit_code=-1,
                    execution_time_ms=0.0
                )

            shell_type = shell_type or self.default_shell_type
            if shell_type == 'cmd':
                if os.name != "nt":
                    raise OSError("Windows CMD is not available on this operating system.")
                cmd_args = ['cmd.exe', '/c', command]
            elif shell_type == 'powershell':
                executable = shutil.which("pwsh") or shutil.which("powershell.exe")
                if not executable:
                    raise OSError("PowerShell is not installed or not on PATH.")
                if self.sandbox_enabled:
                    cmd_args = [executable, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Restricted', '-Command', command]
                else:
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
                
            env = self._create_sandboxed_env() if self.sandbox_enabled else None

            process = await asyncio.create_subprocess_exec(
                *cmd_args,
                cwd=working_dir,
                env=env,
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
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="Invalid shell parameters. Check command, working directory, shell, and timeout.",
            )
        command = params["command"]
        res = await self.execute_command(
            command,
            params.get("working_dir"),
            params.get("timeout", self.default_timeout),
            params.get("shell_type", self.default_shell_type),
        )
        return ToolResult(success=(res.exit_code == 0), output=res, error=res.stderr if res.exit_code != 0 else None)
