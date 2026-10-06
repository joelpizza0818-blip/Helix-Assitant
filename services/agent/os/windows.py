import platform
import psutil
import logging
import winreg

logger = logging.getLogger(__name__)

def get_windows_version() -> str:
    return platform.version()

def get_system_info() -> dict:
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    
    return {
        "os_version": platform.version(),
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "ram_total_gb": round(mem.total / (1024**3), 2),
        "ram_used_gb": round(mem.used / (1024**3), 2),
        "disk_info": {
            "total_gb": round(disk.total / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent
        }
    }

def get_active_window() -> dict:
    try:
        import win32gui
        import win32process
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return {}
        title = win32gui.GetWindowText(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        
        return {
            "hwnd": hwnd,
            "title": title,
            "pid": pid,
            "rect": {
                "x": rect[0],
                "y": rect[1],
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1]
            }
        }
    except Exception as e:
        logger.error(f"Failed to get active window: {e}")
        return {}

def get_foreground_pid() -> int:
    try:
        import win32gui
        import win32process
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return pid
    except:
        return 0

def set_environment_variable(name: str, value: str, scope: str = 'user'):
    try:
        if scope == 'user':
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Environment', 0, winreg.KEY_SET_VALUE)
        else:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 0, winreg.KEY_SET_VALUE)
        
        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        winreg.CloseKey(key)
        
        # Broadcast change message
        import win32gui
        import win32con
        win32gui.SendMessageTimeout(win32con.HWND_BROADCAST, win32con.WM_SETTINGCHANGE, 0, 'Environment', win32con.SMTO_ABORTIFHUNG, 5000)
    except Exception as e:
        logger.error(f"Failed to set env var {name}: {e}")

def show_notification(title: str, message: str):
    try:
        from plyer import notification
        notification.notify(
            title=title,
            message=message,
            app_name='HELIX',
            timeout=5
        )
    except ImportError:
        logger.warning("plyer not installed. Falling back to print notification.")
        print(f"NOTIFICATION: {title} - {message}")

def get_clipboard() -> str:
    try:
        import win32clipboard
        import win32con
        win32clipboard.OpenClipboard()
        try:
            data = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        except TypeError:
            data = ""
        win32clipboard.CloseClipboard()
        return data
    except Exception as e:
        logger.error(f"Clipboard read error: {e}")
        return ""

def set_clipboard(text: str):
    try:
        import win32clipboard
        import win32con
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
        win32clipboard.CloseClipboard()
    except Exception as e:
        logger.error(f"Clipboard write error: {e}")
