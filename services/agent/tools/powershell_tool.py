import re
from typing import Dict, Optional
from .shell_tool import ShellTool, ShellResult

class PowerShellTool(ShellTool):
    DANGEROUS_PATTERNS = [
        r'Remove-Item\s+-Recurse', r'Format-Volume', r'Stop-Process',
        r'Set-ExecutionPolicy', r'Invoke-Expression'
    ]

    @property
    def name(self) -> str:
        return "powershell_tool"

    @property
    def description(self) -> str:
        return "Tool for executing PowerShell commands and scripts."

    def validate_command(self, command: str) -> bool:
        cmd_lower = command.lower()
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern.lower(), cmd_lower):
                return False
        return True

    async def execute_command(self, command: str, working_dir: Optional[str] = None, timeout: int = 30, shell_type: str = 'powershell') -> ShellResult:
        return await super().execute_command(command, working_dir, timeout, shell_type='powershell')

    async def execute_script(self, script_path: str, params: Optional[Dict[str, str]] = None, timeout: int = 60) -> ShellResult:
        cmd = f"& '{script_path}'"
        if params:
            for k, v in params.items():
                cmd += f" -{k} '{v}'"
        return await self.execute_command(cmd, timeout=timeout)
