import winreg
import logging
import os

logger = logging.getLogger(__name__)

REGISTRY_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'

def enable_startup(app_path: str, app_name: str = 'HELIX') -> bool:
    if not os.path.exists(app_path):
        logger.error(f"Cannot enable startup. Path does not exist: {app_path}")
        return False
        
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY, 0, winreg.KEY_SET_VALUE)
        # Ensure path is quoted to handle spaces
        winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, f'"{app_path}"')
        winreg.CloseKey(key)
        logger.info(f"Enabled startup for {app_name}")
        return True
    except Exception as e:
        logger.error(f"Failed to enable startup: {e}")
        return False

def disable_startup(app_name: str = 'HELIX') -> bool:
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY, 0, winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE)
        winreg.DeleteValue(key, app_name)
        winreg.CloseKey(key)
        logger.info(f"Disabled startup for {app_name}")
        return True
    except FileNotFoundError:
        return True # Already disabled
    except Exception as e:
        logger.error(f"Failed to disable startup: {e}")
        return False

def is_startup_enabled(app_name: str = 'HELIX') -> bool:
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY, 0, winreg.KEY_QUERY_VALUE)
        winreg.QueryValueEx(key, app_name)
        winreg.CloseKey(key)
        return True
    except FileNotFoundError:
        return False
    except Exception as e:
        logger.error(f"Error checking startup status: {e}")
        return False

def get_startup_entries() -> list[dict]:
    entries = []
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY, 0, winreg.KEY_READ)
        for i in range(1000): # max likely entries
            try:
                name, path, _ = winreg.EnumValue(key, i)
                entries.append({"name": name, "path": path})
            except OSError:
                break # No more values
        winreg.CloseKey(key)
    except Exception as e:
        logger.error(f"Error reading startup entries: {e}")
    return entries
