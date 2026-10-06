import logging
from enum import Enum, auto
from typing import Dict, List
import os

logger = logging.getLogger(__name__)

class PermissionLevel(Enum):
    READ_ONLY = auto()
    LOW_RISK = auto()
    MODIFY = auto()
    EXECUTE = auto()
    SYSTEM = auto()
    CRITICAL = auto()

class EventBus: # simple stub since not provided
    @staticmethod
    def emit(event_type: str, data: dict):
        logger.info(f"EventBus emit: {event_type} - {data}")

class PermissionManager:
    def __init__(self):
        self.permissions: Dict[str, PermissionLevel] = {}
        self.protected_paths: List[str] = [
            r'C:\Windows',
            r'C:\Windows\System32',
            r'C:\Windows\SysWOW64',
            r'C:\Program Files\Windows',
        ]
        self.protected_apps: List[str] = [
            'explorer.exe',
            'lsass.exe',
            'winlogon.exe',
            'csrss.exe',
            'smss.exe',
            'svchost.exe',
        ]
        
    def grant_permission(self, tool_name: str, level: PermissionLevel) -> None:
        self.permissions[tool_name] = level
        logger.info(f"Granted {level.name} permission to {tool_name}")

    def revoke_permission(self, tool_name: str, level: PermissionLevel) -> None:
        if tool_name in self.permissions and self.permissions[tool_name] == level:
            del self.permissions[tool_name]
            logger.info(f"Revoked {level.name} permission from {tool_name}")

    def check_permission(self, tool_name: str, required_level: PermissionLevel) -> bool:
        current = self.permissions.get(tool_name, PermissionLevel.READ_ONLY)
        allowed = current.value >= required_level.value
        if not allowed:
            logger.warning(f"Permission denied for {tool_name}. Required: {required_level.name}, Current: {current.name}")
            EventBus.emit("PERMISSION_REQUIRED", {"tool_name": tool_name, "required_level": required_level.name})
        return allowed

    def is_path_protected(self, path: str) -> bool:
        norm_path = os.path.normpath(path).lower()
        for protected in self.protected_paths:
            if norm_path.startswith(protected.lower()):
                return True
        return False

    def is_app_protected(self, app_name: str) -> bool:
        return app_name.lower() in [app.lower() for app in self.protected_apps]

    def get_required_level(self, tool_name: str) -> PermissionLevel:
        return PermissionLevel.EXECUTE
