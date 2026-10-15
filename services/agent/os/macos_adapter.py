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


class MacOSAdapter(BaseOSAdapter):
    """macOS OS adapter using AppleScript (osascript), pbcopy/pbpaste, and zsh."""

    def get_system_info(self) -> Dict[str, Any]:
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        mac_ver = platform.mac_ver()[0] or platform.version()

        return {
            "os_version": mac_ver,
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "ram_total_gb": round(mem.total / (1024**3), 2),
            "ram_used_gb": round(mem.used / (1024**3), 2),
            "disk_info": {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent,
            },
        }

    def _run_osascript(self, script: str) -> str:
        if not shutil.which("osascript"):
            return ""
        try:
            res = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=3,
            )
            return res.stdout.strip() if res.returncode == 0 else ""
        except Exception as e:
            logger.debug(f"osascript error: {e}")
            return ""

    def get_active_window(self) -> Dict[str, Any]:
        script = """
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set appName to name of frontApp
            set appPid to unix id of frontApp
            set winTitle to ""
            set winX to 0
            set winY to 0
            set winW to 0
            set winH to 0
            try
                tell frontApp
                    if (count of windows) > 0 then
                        set winTitle to name of front window
                        set winPos to position of front window
                        set winSize to size of front window
                        set winX to item 1 of winPos
                        set winY to item 2 of winPos
                        set winW to item 1 of winSize
                        set winH to item 2 of winSize
                    end if
                end tell
            end try
            return (appPid as text) & "::" & appName & "::" & winTitle & "::" & (winX as text) & "::" & (winY as text) & "::" & (winW as text) & "::" & (winH as text)
        end tell
        """
        output = self._run_osascript(script)
        if not output:
            return {}

        parts = output.split("::")
        if len(parts) >= 7:
            try:
                pid = int(parts[0])
                app_name = parts[1]
                title = parts[2] or app_name
                x = int(parts[3])
                y = int(parts[4])
                w = int(parts[5])
                h = int(parts[6])
                return {
                    "hwnd": pid,
                    "title": title,
                    "pid": pid,
                    "rect": {"x": x, "y": y, "width": w, "height": h},
                }
            except (ValueError, IndexError):
                pass
        return {}

    def get_foreground_pid(self) -> int:
        script = 'tell application "System Events" to get unix id of first application process whose frontmost is true'
        out = self._run_osascript(script)
        try:
            return int(out)
        except (ValueError, TypeError):
            return 0

    def get_clipboard(self) -> str:
        if shutil.which("pbpaste"):
            try:
                res = subprocess.run(
                    ["pbpaste"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    return res.stdout
            except Exception as e:
                logger.debug(f"pbpaste error: {e}")
        return ""

    def set_clipboard(self, text: str) -> None:
        if shutil.which("pbcopy"):
            try:
                subprocess.run(
                    ["pbcopy"],
                    input=text.encode("utf-8"),
                    check=False,
                    timeout=2,
                )
            except Exception as e:
                logger.debug(f"pbcopy error: {e}")

    def show_notification(self, title: str, message: str) -> None:
        try:
            from plyer import notification

            notification.notify(
                title=title,
                message=message,
                app_name="HELIX",
                timeout=5,
            )
            return
        except Exception:
            pass

        safe_title = title.replace('"', '\\"')
        safe_msg = message.replace('"', '\\"')
        script = f'display notification "{safe_msg}" with title "{safe_title}"'
        if self._run_osascript(script):
            return

        logger.warning("Notification fallback to stdout.")
        print(f"NOTIFICATION: {title} - {message}")

    def set_environment_variable(
        self, name: str, value: str, scope: str = "user"
    ) -> None:
        os.environ[name] = value
        if scope == "user":
            home = os.path.expanduser("~")
            profile_path = os.path.join(home, ".zshrc")
            try:
                export_line = f'export {name}="{value}"\n'
                with open(profile_path, "a", encoding="utf-8") as f:
                    f.write(export_line)
            except Exception as e:
                logger.error(f"Failed to persist env var to ~/.zshrc: {e}")

    def list_applications(self) -> List[Dict[str, Any]]:
        apps: List[Dict[str, Any]] = []
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
                    "window_titles": [],
                    "memory_mb": mem_mb,
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return apps

    def execute_command(self, command: str) -> Dict[str, Any]:
        shell = shutil.which("zsh") or shutil.which("bash") or "/bin/sh"
        try:
            res = subprocess.run(
                [shell, "-c", command],
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
    def focus_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if isinstance(hwnd_or_title, str):
            safe_name = hwnd_or_title.replace('"', '\\"')
            script = f'tell application "{safe_name}" to activate'
            self._run_osascript(script)
            return True
        return False

    def close_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if isinstance(hwnd_or_title, str):
            safe_name = hwnd_or_title.replace('"', '\\"')
            script = f'tell application "{safe_name}" to close front window'
            self._run_osascript(script)
            return True
        return False

    def minimize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if isinstance(hwnd_or_title, str):
            safe_name = hwnd_or_title.replace('"', '\\"')
            script = f'tell application "System Events" to tell process "{safe_name}" to set miniaturized of front window to true'
            self._run_osascript(script)
            return True
        return False

    def maximize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if isinstance(hwnd_or_title, str):
            safe_name = hwnd_or_title.replace('"', '\\"')
            script = f'tell application "System Events" to tell process "{safe_name}" to set zoomed of front window to true'
            self._run_osascript(script)
            return True
        return False
