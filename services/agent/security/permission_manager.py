import logging
from enum import Enum, auto
from typing import Dict, List
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

class PermissionLevel(Enum):
    READ_ONLY = auto()
    LOW_RISK = auto()
    MODIFY = auto()
    EXECUTE = auto()
    SYSTEM = auto()
    CRITICAL = auto()


class PermissionMode(str, Enum):
    ALWAYS_ASK = "ALWAYS_ASK"
    AUTO_APPROVE = "AUTO_APPROVE"
    SMART_APPROVAL = "SMART_APPROVAL"


@dataclass(frozen=True)
class RiskEvaluation:
    level: PermissionLevel
    requires_confirmation: bool
    reason: str

class EventBus: # simple stub since not provided
    @staticmethod
    def emit(event_type: str, data: dict):
        logger.info(f"EventBus emit: {event_type} - {data}")

class PermissionManager:
    """Central permission policy used by settings and tool execution.

    Grants are explicit and in-memory; the selected mode and protected lists
    are supplied by the persisted desktop settings.  This keeps secrets and
    one-shot approvals out of the settings file.
    """

    def __init__(self, mode: PermissionMode | str = PermissionMode.SMART_APPROVAL):
        self.mode = mode if isinstance(mode, PermissionMode) else PermissionMode(str(mode).upper())
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

    def configure(
        self,
        mode: PermissionMode | str | None = None,
        protected_paths: List[str] | None = None,
        protected_apps: List[str] | None = None,
    ) -> None:
        if mode is not None:
            self.mode = mode if isinstance(mode, PermissionMode) else PermissionMode(str(mode).upper())
        if protected_paths is not None:
            self.protected_paths = self._merge_protected(
                self.protected_paths[:4], protected_paths
            )
        if protected_apps is not None:
            self.protected_apps = self._merge_protected(
                self.protected_apps[:6], protected_apps
            )

    @staticmethod
    def _merge_protected(defaults: List[str], configured: List[str]) -> List[str]:
        values: List[str] = []
        for value in [*defaults, *configured]:
            if isinstance(value, str) and value.strip() and value.casefold() not in {
                item.casefold() for item in values
            }:
                values.append(value.strip())
        return values

    def evaluate_risk(
        self,
        tool_name: str,
        params: dict | None = None,
        required_level: PermissionLevel | str | None = None,
    ) -> RiskEvaluation:
        params = params or {}
        level = required_level
        if isinstance(level, str):
            try:
                level = PermissionLevel[level.upper()]
            except KeyError:
                level = None
        if level is None:
            level = self._infer_level(tool_name, params)
        if not isinstance(level, PermissionLevel):
            level = PermissionLevel.SYSTEM

        protected = False
        for key in ("path", "destination", "dest"):
            value = params.get(key)
            if isinstance(value, str) and self.is_path_protected(value):
                protected = True
        app = params.get("app") or params.get("application") or params.get("process")
        if isinstance(app, str) and self.is_app_protected(app):
            protected = True
        if protected and level.value < PermissionLevel.CRITICAL.value:
            level = PermissionLevel.CRITICAL

        if self.mode is PermissionMode.ALWAYS_ASK:
            requires = True
            reason = "Always Ask mode requires approval for every tool action."
        elif self.mode is PermissionMode.AUTO_APPROVE:
            requires = level.value >= PermissionLevel.SYSTEM.value
            reason = "Auto Approve mode permits non-system actions; system and critical actions remain gated."
        else:
            requires = level.value >= PermissionLevel.MODIFY.value
            reason = "Smart Approval gates modifications, protected resources, and destructive actions."
        return RiskEvaluation(level, requires, reason)

    @staticmethod
    def _infer_level(tool_name: str, params: dict) -> PermissionLevel:
        name = tool_name.casefold()
        operation = str(params.get("operation", "")).casefold()
        if any(token in name or token in operation for token in ("delete", "kill", "format", "terminate")):
            return PermissionLevel.CRITICAL
        if any(token in name or token in operation for token in ("write", "append", "move", "copy", "create", "resize")):
            return PermissionLevel.MODIFY
        if any(token in name or token in operation for token in ("execute", "shell", "powershell", "launch", "navigate")):
            return PermissionLevel.EXECUTE
        if any(token in name or token in operation for token in ("read", "list", "search", "screenshot", "inspect")):
            return PermissionLevel.READ_ONLY
        return PermissionLevel.LOW_RISK

    def check_permission(self, tool_name: str, required_level: PermissionLevel) -> bool:
        current = self.permissions.get(tool_name, PermissionLevel.READ_ONLY)
        allowed = current.value >= required_level.value
        if not allowed:
            logger.warning(f"Permission denied for {tool_name}. Required: {required_level.name}, Current: {current.name}")
            EventBus.emit("PERMISSION_REQUIRED", {"tool_name": tool_name, "required_level": required_level.name})
        return allowed

    def is_path_protected(self, path: str) -> bool:
        norm_path = os.path.normcase(os.path.abspath(os.path.normpath(path)))
        for protected in self.protected_paths:
            protected_path = os.path.normcase(os.path.abspath(os.path.normpath(protected)))
            try:
                if norm_path == protected_path or Path(protected_path) in Path(norm_path).parents:
                    return True
            except (OSError, ValueError):
                if norm_path.startswith(protected_path.rstrip("\\/") + os.sep):
                    return True
        return False

    def is_app_protected(self, app_name: str) -> bool:
        return app_name.lower() in [app.lower() for app in self.protected_apps]

    def get_required_level(self, tool_name: str) -> PermissionLevel:
        return PermissionLevel.EXECUTE
