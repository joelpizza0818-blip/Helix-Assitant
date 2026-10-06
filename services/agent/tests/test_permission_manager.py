import pytest
from services.agent.security.permission_manager import PermissionManager, PermissionLevel

def test_read_only_allowed_by_default(permission_manager):
    assert permission_manager.check_permission("filesystem_tool.read_file", PermissionLevel.READ_ONLY) is True

def test_critical_requires_explicit_grant(permission_manager):
    # CRITICAL should not be granted automatically
    assert permission_manager.check_permission("filesystem_tool.delete_file", PermissionLevel.CRITICAL) is False

    # Grant permission and re-verify
    permission_manager.grant_permission("filesystem_tool.delete_file", PermissionLevel.CRITICAL)
    assert permission_manager.check_permission("filesystem_tool.delete_file", PermissionLevel.CRITICAL) is True

def test_protected_paths_detected(permission_manager):
    assert permission_manager.is_path_protected("C:\\Windows\\System32\\cmd.exe") is True
    assert permission_manager.is_path_protected("C:\\Windows\\explorer.exe") is True
    assert permission_manager.is_path_protected("C:\\Users\\User\\Documents\\file.txt") is False

def test_protected_processes_detected(permission_manager):
    assert permission_manager.is_app_protected("lsass.exe") is True
    assert permission_manager.is_app_protected("winlogon.exe") is True
    assert permission_manager.is_app_protected("notepad.exe") is False
