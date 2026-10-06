import asyncio
import time
from typing import Any, Dict, Optional
from dataclasses import dataclass
from .base_tool import BaseTool, ToolResult

@dataclass
class ShellResult:
    stdout: str
    stderr: str
    exit_code: int
    execution_time_ms: float

class ShellTool(BaseTool):
    @property
    def name(self) -> str:
        return "shell_tool"

    @property
    def description(self) -> str:
        return "Base tool for executing shell commands."

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
        return True

    async def execute_command(self, command: str, working_dir: Optional[str] = None, timeout: int = 30, shell_type: str = 'cmd') -> ShellResult:
        start_time = time.time()
        try:
            if shell_type == 'cmd':
                cmd_args = ['cmd.exe', '/c', command]
            elif shell_type == 'powershell':
                cmd_args = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command]
            else:
                cmd_args = command.split()
                
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
        res = await self.execute_command(command, params.get("working_dir"), params.get("timeout", 30), params.get("shell_type", "cmd"))
        return ToolResult(success=(res.exit_code == 0), output=res, error=res.stderr if res.exit_code != 0 else None)
