import re

DANGEROUS_CMD_PATTERNS = [
    re.compile(r'(?i)\bformat\b'),
    re.compile(r'(?i)\bdel\s+/f\b'),
    re.compile(r'(?i)\brmdir\s+/s\b'),
    re.compile(r'(?i)\bdiskpart\b'),
]

DANGEROUS_PS_PATTERNS = [
    re.compile(r'(?i)Remove-Item\s+-Recurse\s+-Force'),
    re.compile(r'(?i)Stop-Process'),
    re.compile(r'(?i)Set-ExecutionPolicy'),
    re.compile(r'(?i)Invoke-WebRequest'),
]

PROTECTED_SYSTEM_PATHS = [
    r'C:\Windows',
    r'C:\Windows\System32',
    r'C:\Windows\SysWOW64',
    r'C:\Program Files\Windows',
]

PROTECTED_PROCESSES = [
    'explorer.exe',
    'lsass.exe',
    'winlogon.exe',
    'csrss.exe',
    'smss.exe',
    'svchost.exe',
]

PROTECTED_REGISTRY_KEYS = [
    r'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    r'HKLM\SYSTEM\CurrentControlSet\Services',
]

FINANCIAL_ACTION_PATTERNS = [
    re.compile(r'(?i)\btransfer\b'),
    re.compile(r'(?i)\bpay\b'),
    re.compile(r'(?i)\bbuy\b'),
    re.compile(r'(?i)\bsell\b'),
]

CONFIRMATION_REQUIRED_TOOLS = [
    'execute_command',
    'delete_file',
    'write_to_file',
    'replace_file_content',
]
