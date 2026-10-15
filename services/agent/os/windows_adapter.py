import logging
import os
import platform
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional, Union

import psutil

from .base import BaseOSAdapter

logger = logging.getLogger(__name__)

# Protected native imports
try:
    import win32clipboard
    import win32con
    import win32gui
    import win32process

    _WIN32_AVAILABLE = True
except ImportError:
    win32clipboard = None
    win32con = None
    win32gui = None
    win32process = None
    _WIN32_AVAILABLE = False

try:
    import winreg

    _WINREG_AVAILABLE = True
except ImportError:
    winreg = None
    _WINREG_AVAILABLE = False


class WindowsAdapter(BaseOSAdapter):
    """Windows-specific OS adapter implementing win32, winreg, and PowerShell APIs."""

    def get_system_info(self) -> Dict[str, Any]:
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        return {
            "os_version": platform.version(),
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "ram_total_gb": round(mem.total / (1024**3), 2),
            "ram_used_gb": round(mem.used / (1024**3), 2),
            "disk_info": {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent,
            },
        }

    def get_active_window(self) -> Dict[str, Any]:
        if not _WIN32_AVAILABLE or win32gui is None or win32process is None:
            return {}
        try:
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
                    "height": rect[3] - rect[1],
                },
            }
        except Exception as e:
            logger.error(f"Failed to get active window: {e}")
            return {}

    def get_foreground_pid(self) -> int:
        if not _WIN32_AVAILABLE or win32gui is None or win32process is None:
            return 0
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return 0
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            return pid
        except Exception:
            return 0

    def get_clipboard(self) -> str:
        if not _WIN32_AVAILABLE or win32clipboard is None or win32con is None:
            return ""
        try:
            win32clipboard.OpenClipboard()
            try:
                data = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
            except TypeError:
                data = ""
            win32clipboard.CloseClipboard()
            return data or ""
        except Exception as e:
            logger.error(f"Clipboard read error: {e}")
            return ""

    def set_clipboard(self, text: str) -> None:
        if not _WIN32_AVAILABLE or win32clipboard is None or win32con is None:
            return
        try:
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
            win32clipboard.CloseClipboard()
        except Exception as e:
            logger.error(f"Clipboard write error: {e}")

    def show_notification(self, title: str, message: str) -> None:
        try:
            from plyer import notification

            notification.notify(
                title=title,
                message=message,
                app_name="HELIX",
                timeout=5,
            )
        except Exception:
            logger.warning(
                "plyer notification failed or not installed. Falling back to print notification."
            )
            print(f"NOTIFICATION: {title} - {message}")

    def set_environment_variable(
        self, name: str, value: str, scope: str = "user"
    ) -> None:
        os.environ[name] = value
        if not _WINREG_AVAILABLE or winreg is None:
            return
        try:
            if scope == "user":
                key = winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_SET_VALUE
                )
            else:
                key = winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                    0,
                    winreg.KEY_SET_VALUE,
                )

            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
            winreg.CloseKey(key)

            if _WIN32_AVAILABLE and win32gui is not None and win32con is not None:
                win32gui.SendMessageTimeout(
                    win32con.HWND_BROADCAST,
                    win32con.WM_SETTINGCHANGE,
                    0,
                    "Environment",
                    win32con.SMTO_ABORTIFHUNG,
                    5000,
                )
        except Exception as e:
            logger.error(f"Failed to set env var {name}: {e}")

    def list_applications(self) -> List[Dict[str, Any]]:
        apps: List[Dict[str, Any]] = []
        window_map: Dict[int, List[str]] = {}

        if _WIN32_AVAILABLE and win32gui is not None and win32process is not None:
            try:
                def enum_cb(hwnd, results):
                    try:
                        if win32gui.IsWindowVisible(hwnd):
                            txt = win32gui.GetWindowText(hwnd)
                            if txt:
                                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                                if pid not in results:
                                    results[pid] = []
                                results[pid].append(txt)
                    except Exception:
                        pass
                    return True

                win32gui.EnumWindows(enum_cb, window_map)
            except Exception:
                pass

        for p in psutil.process_iter(["pid", "name", "exe", "memory_info"]):
            try:
                pid = p.info["pid"]
                mem_mb = (
                    round(p.info["memory_info"].rss / (1024 * 1024), 2)
                    if p.info.get("memory_info")
                    else 0.0
                )
                apps.append({
                    "name": p.info.get("name") or "",
                    "pid": pid,
                    "exe_path": p.info.get("exe") or "",
                    "window_titles": window_map.get(pid, []),
                    "memory_mb": mem_mb,
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return apps

    def execute_command(self, command: str) -> Dict[str, Any]:
        executable = (
            shutil.which("pwsh") or shutil.which("powershell.exe") or "powershell"
        )
        try:
            res = subprocess.run(
                [executable, "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "stdout": res.stdout,
                "stderr": res.stderr,
                "exit_code": res.returncode,
                "returncode": res.returncode,
                "success": res.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Command timed out",
                "exit_code": -1,
                "returncode": -1,
                "success": False,
            }
        except Exception as e:
            return {
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "returncode": -1,
                "success": False,
            }

    # Window management implementations
    def _get_hwnd(self, hwnd_or_title: Union[int, str]) -> Optional[int]:
        if isinstance(hwnd_or_title, int):
            return hwnd_or_title
        return self.find_window_by_title(str(hwnd_or_title))

    def list_windows(self, visible_only: bool = True) -> List[Dict[str, Any]]:
        if not _WIN32_AVAILABLE or win32gui is None or win32process is None:
            return []
        windows = []

        def callback(hwnd, _):
            try:
                if visible_only and not win32gui.IsWindowVisible(hwnd):
                    return True
                title = win32gui.GetWindowText(hwnd)
                if visible_only and not title:
                    return True
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                rect = win32gui.GetWindowRect(hwnd)
                windows.append({
                    "hwnd": hwnd,
                    "title": title,
                    "pid": pid,
                    "rect": {
                        "x": rect[0],
                        "y": rect[1],
                        "width": rect[2] - rect[0],
                        "height": rect[3] - rect[1],
                    },
                })
            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(callback, None)
        except Exception:
            pass
        return windows

    def get_window(self, hwnd_or_title: Union[int, str]) -> Optional[Dict[str, Any]]:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32process is None:
            return None
        try:
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
                    "height": rect[3] - rect[1],
                },
            }
        except Exception:
            return None

    def focus_window(self, hwnd_or_title: Union[int, str]) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32con is None:
            return False
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            return True
        except Exception as e:
            logger.error(f"Error focusing window: {e}")
            return False

    def minimize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32con is None:
            return False
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
            return True
        except Exception as e:
            logger.error(f"Error minimizing window: {e}")
            return False

    def maximize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32con is None:
            return False
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
            return True
        except Exception as e:
            logger.error(f"Error maximizing window: {e}")
            return False

    def restore_window(self, hwnd_or_title: Union[int, str]) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32con is None:
            return False
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            return True
        except Exception as e:
            logger.error(f"Error restoring window: {e}")
            return False

    def close_window(self, hwnd_or_title: Union[int, str]) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None or win32con is None:
            return False
        try:
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            return True
        except Exception as e:
            logger.error(f"Error closing window: {e}")
            return False

    def resize_window(
        self, hwnd_or_title: Union[int, str], width: int, height: int
    ) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None:
            return False
        try:
            rect = win32gui.GetWindowRect(hwnd)
            win32gui.MoveWindow(hwnd, rect[0], rect[1], width, height, True)
            return True
        except Exception as e:
            logger.error(f"Error resizing window: {e}")
            return False

    def move_window(
        self, hwnd_or_title: Union[int, str], x: int, y: int
    ) -> bool:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None:
            return False
        try:
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            win32gui.MoveWindow(hwnd, x, y, w, h, True)
            return True
        except Exception as e:
            logger.error(f"Error moving window: {e}")
            return False

    def get_window_rect(self, hwnd_or_title: Union[int, str]) -> Dict[str, int]:
        hwnd = self._get_hwnd(hwnd_or_title)
        if hwnd is None or not _WIN32_AVAILABLE or win32gui is None:
            return {"x": 0, "y": 0, "width": 0, "height": 0}
        try:
            rect = win32gui.GetWindowRect(hwnd)
            return {
                "x": rect[0],
                "y": rect[1],
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1],
            }
        except Exception:
            return {"x": 0, "y": 0, "width": 0, "height": 0}

    def get_window_text(self, hwnd: int) -> str:
        if not _WIN32_AVAILABLE or win32gui is None:
            return ""
        try:
            return win32gui.GetWindowText(hwnd)
        except Exception:
            return ""

    def find_window_by_title(self, title_pattern: str) -> Optional[int]:
        if not _WIN32_AVAILABLE or win32gui is None:
            return None
        found_hwnd = None
        pattern = re.compile(title_pattern, re.IGNORECASE)

        def callback(hwnd, _):
            nonlocal found_hwnd
            try:
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd)
                    if pattern.search(title):
                        found_hwnd = hwnd
                        return False
            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(callback, None)
        except Exception:
            pass
        return found_hwnd
