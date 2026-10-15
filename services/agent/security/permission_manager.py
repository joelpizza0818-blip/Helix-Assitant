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
        path_keys = {"path", "destination", "dest", "working_dir", "file_path"}
        app_keys = {
            "app",
            "app_name",
            "application",
            "application_name",
            "process",
            "process_name",
            "executable",
        }
        values = [params]
        while values:
            value = values.pop()
            if isinstance(value, dict):
                for key, item in value.items():
                    normalized_key = str(key).casefold()
                    if (
                        normalized_key in path_keys
                        and isinstance(item, str)
                        and self.is_path_protected(item)
                    ):
                        protected = True
                    elif (
                        normalized_key in app_keys
                        and isinstance(item, str)
                        and self.is_app_protected(item)
                    ):
                        protected = True
                    if isinstance(item, (dict, list, tuple)):
                        values.append(item)
            elif isinstance(value, (list, tuple)):
                values.extend(value)
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
        if not path or not isinstance(path, str):
            return True
        clean_path = path.strip()
        # Fast cross-platform check for Windows-style paths (e.g. C:\Windows on Linux)
        if "\\" in clean_path or (len(clean_path) > 1 and clean_path[1] == ":"):
            norm_target = clean_path.replace("\\", "/").casefold().rstrip("/")
            for protected in self.protected_paths:
                norm_prot = protected.replace("\\", "/").casefold().rstrip("/")
                if norm_target == norm_prot or norm_target.startswith(norm_prot + "/"):
                    return True

        try:
            resolved_path = Path(path).expanduser().resolve(strict=False)
            protected_paths = [
                Path(protected).expanduser().resolve(strict=False)
                for protected in self.protected_paths
            ]
        except (OSError, RuntimeError, TypeError, ValueError):
            return True
        norm_path = os.path.normcase(str(resolved_path))
        for protected_path in protected_paths:
            normalized_protected = os.path.normcase(str(protected_path))
            if (
                norm_path == normalized_protected
                or protected_path in resolved_path.parents
            ):
                return True
        return False

    def is_app_protected(self, app_name: str) -> bool:
        normalized_app = app_name.replace("\\", "/").rstrip("/").split("/")[-1].casefold()
        return normalized_app in {
            app.replace("\\", "/").rstrip("/").split("/")[-1].casefold()
            for app in self.protected_apps
        }

    def get_required_level(self, tool_name: str) -> PermissionLevel:
        return PermissionLevel.EXECUTE
