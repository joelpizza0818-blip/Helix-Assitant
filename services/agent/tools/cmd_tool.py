import re
from typing import Optional
from .shell_tool import ShellTool, ShellResult

class CmdTool(ShellTool):
    DANGEROUS_PATTERNS = [
        r'\bdel\b', r'\brmdir\s+/s\b', r'\bformat\b', r'\bshutdown\b',
        r'\breg\s+delete\b', r'\bnetsh\b', r'\btaskkill\b', r'\bbcdedit\b', r'\bdiskpart\b'
    ]

    @property
    def name(self) -> str:
        return "cmd_tool"

    @property
    def description(self) -> str:
        return "Execute Windows CMD commands only; use CMD syntax, not PowerShell or Bash."

    def validate_command(self, command: str) -> bool:
        cmd_lower = command.lower()
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, cmd_lower):
                return False
        return True

    async def execute_command(self, command: str, working_dir: Optional[str] = None, timeout: int = 30, shell_type: str = 'cmd') -> ShellResult:
        return await super().execute_command(command, working_dir, timeout, shell_type='cmd')
