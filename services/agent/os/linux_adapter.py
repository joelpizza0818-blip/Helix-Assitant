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


class LinuxAdapter(BaseOSAdapter):
    """Linux OS adapter supporting X11, Wayland, standard Linux cli utilities, and bash."""

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
        xdotool = shutil.which("xdotool")
        if xdotool:
            try:
                res = subprocess.run(
                    [xdotool, "getactivewindow"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0 and res.stdout.strip():
                    win_id = int(res.stdout.strip())
                    name_res = subprocess.run(
                        [xdotool, "getwindowname", str(win_id)],
                        capture_output=True,
                        text=True,
                        timeout=2,
                    )
                    title = name_res.stdout.strip() if name_res.returncode == 0 else ""

                    pid_res = subprocess.run(
                        [xdotool, "getwindowpid", str(win_id)],
                        capture_output=True,
                        text=True,
                        timeout=2,
                    )
                    pid = (
                        int(pid_res.stdout.strip())
                        if pid_res.returncode == 0 and pid_res.stdout.strip().isdigit()
                        else 0
                    )

                    geom_res = subprocess.run(
                        [xdotool, "getwindowgeometry", "--shell", str(win_id)],
                        capture_output=True,
                        text=True,
                        timeout=2,
                    )
                    x, y, w, h = 0, 0, 0, 0
                    if geom_res.returncode == 0:
                        for line in geom_res.stdout.splitlines():
                            if line.startswith("X="):
                                x = int(line.split("=")[1])
                            elif line.startswith("Y="):
                                y = int(line.split("=")[1])
                            elif line.startswith("WIDTH="):
                                w = int(line.split("=")[1])
                            elif line.startswith("HEIGHT="):
                                h = int(line.split("=")[1])

                    return {
                        "hwnd": win_id,
                        "title": title,
                        "pid": pid,
                        "rect": {"x": x, "y": y, "width": w, "height": h},
                    }
            except Exception as e:
                logger.debug(f"xdotool active window lookup failed: {e}")

        # Wayland fallback or when xdotool is absent
        return {}

    def get_foreground_pid(self) -> int:
        win = self.get_active_window()
        return win.get("pid", 0)

    def get_clipboard(self) -> str:
        if shutil.which("wl-paste"):
            try:
                res = subprocess.run(
                    ["wl-paste", "--no-newline"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    return res.stdout
            except Exception:
                pass

        if shutil.which("xclip"):
            try:
                res = subprocess.run(
                    ["xclip", "-selection", "clipboard", "-o"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    return res.stdout
            except Exception:
                pass

        if shutil.which("xsel"):
            try:
                res = subprocess.run(
                    ["xsel", "--clipboard", "--output"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    return res.stdout
            except Exception:
                pass

        return ""

    def set_clipboard(self, text: str) -> None:
        data = text.encode("utf-8")

        if shutil.which("wl-copy"):
            try:
                subprocess.run(
                    ["wl-copy"],
                    input=data,
                    check=False,
                    timeout=2,
                )
                return
            except Exception:
                pass

        if shutil.which("xclip"):
            try:
                subprocess.run(
                    ["xclip", "-selection", "clipboard"],
                    input=data,
                    check=False,
                    timeout=2,
                )
                return
            except Exception:
                pass

        if shutil.which("xsel"):
            try:
                subprocess.run(
                    ["xsel", "--clipboard", "--input"],
                    input=data,
                    check=False,
                    timeout=2,
                )
                return
            except Exception:
                pass

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

        if shutil.which("notify-send"):
            try:
                subprocess.run(["notify-send", title, message], check=False, timeout=3)
                return
            except Exception:
                pass

        logger.warning("Notification fallback to stdout.")
        print(f"NOTIFICATION: {title} - {message}")

    def set_environment_variable(
        self, name: str, value: str, scope: str = "user"
    ) -> None:
        os.environ[name] = value
        if scope == "user":
            home = os.path.expanduser("~")
            profile_path = os.path.join(home, ".profile")
            try:
                export_line = f'export {name}="{value}"\n'
                with open(profile_path, "a", encoding="utf-8") as f:
                    f.write(export_line)
            except Exception as e:
                logger.error(f"Failed to persist env var to ~/.profile: {e}")

    def list_applications(self) -> List[Dict[str, Any]]:
        apps: List[Dict[str, Any]] = []
        window_map: Dict[int, List[str]] = {}

        if shutil.which("wmctrl"):
            try:
                res = subprocess.run(
                    ["wmctrl", "-l", "-p"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    for line in res.stdout.splitlines():
                        parts = line.split(maxsplit=4)
                        if len(parts) >= 5:
                            try:
                                pid = int(parts[2])
                                title = parts[4]
                                if pid not in window_map:
                                    window_map[pid] = []
                                window_map[pid].append(title)
                            except ValueError:
                                pass
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
        shell = shutil.which("bash") or shutil.which("sh") or "/bin/sh"
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
    def list_windows(self, visible_only: bool = True) -> List[Dict[str, Any]]:
        windows = []
        if shutil.which("wmctrl"):
            try:
                res = subprocess.run(
                    ["wmctrl", "-l", "-p", "-G"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if res.returncode == 0:
                    for line in res.stdout.splitlines():
                        # format: <win_id> <desktop> <pid> <x> <y> <w> <h> <client> <title...>
                        parts = line.split(maxsplit=8)
                        if len(parts) >= 9:
                            try:
                                win_id = int(parts[0], 16)
                                pid = int(parts[2])
                                x, y, w, h = (
                                    int(parts[3]),
                                    int(parts[4]),
                                    int(parts[5]),
                                    int(parts[6]),
                                )
                                title = parts[8]
                                if visible_only and not title:
                                    continue
                                windows.append({
                                    "hwnd": win_id,
                                    "title": title,
                                    "pid": pid,
                                    "rect": {"x": x, "y": y, "width": w, "height": h},
                                })
                            except ValueError:
                                pass
            except Exception:
                pass
        return windows

    def get_window(self, hwnd_or_title: Union[int, str]) -> Optional[Dict[str, Any]]:
        windows = self.list_windows(visible_only=False)
        if isinstance(hwnd_or_title, int):
            for w in windows:
                if w["hwnd"] == hwnd_or_title:
                    return w
        else:
            pat = re.compile(str(hwnd_or_title), re.IGNORECASE)
            for w in windows:
                if pat.search(w["title"]):
                    return w
        return None

    def focus_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if shutil.which("wmctrl"):
            flag = "-ia" if isinstance(hwnd_or_title, int) else "-a"
            target = hex(hwnd_or_title) if isinstance(hwnd_or_title, int) else str(hwnd_or_title)
            res = subprocess.run(["wmctrl", flag, target], capture_output=True)
            return res.returncode == 0
        return False

    def minimize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if shutil.which("xdotool"):
            win = self.get_window(hwnd_or_title)
            if win:
                res = subprocess.run(["xdotool", "windowminimize", str(win["hwnd"])], capture_output=True)
                return res.returncode == 0
        return False

    def maximize_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if shutil.which("wmctrl"):
            win = self.get_window(hwnd_or_title)
            if win:
                res = subprocess.run(["wmctrl", "-ir", hex(win["hwnd"]), "-b", "add,maximized_vert,maximized_horz"], capture_output=True)
                return res.returncode == 0
        return False

    def restore_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if shutil.which("wmctrl"):
            win = self.get_window(hwnd_or_title)
            if win:
                res = subprocess.run(["wmctrl", "-ir", hex(win["hwnd"]), "-b", "remove,maximized_vert,maximized_horz"], capture_output=True)
                return res.returncode == 0
        return False

    def close_window(self, hwnd_or_title: Union[int, str]) -> bool:
        if shutil.which("wmctrl"):
            flag = "-ic" if isinstance(hwnd_or_title, int) else "-c"
            target = hex(hwnd_or_title) if isinstance(hwnd_or_title, int) else str(hwnd_or_title)
            res = subprocess.run(["wmctrl", flag, target], capture_output=True)
            return res.returncode == 0
        return False

    def resize_window(
        self, hwnd_or_title: Union[int, str], width: int, height: int
    ) -> bool:
        if shutil.which("wmctrl"):
            win = self.get_window(hwnd_or_title)
            if win:
                res = subprocess.run(
                    ["wmctrl", "-ir", hex(win["hwnd"]), "-e", f"0,-1,-1,{width},{height}"],
                    capture_output=True,
                )
                return res.returncode == 0
        return False

    def move_window(
        self, hwnd_or_title: Union[int, str], x: int, y: int
    ) -> bool:
        if shutil.which("wmctrl"):
            win = self.get_window(hwnd_or_title)
            if win:
                res = subprocess.run(
                    ["wmctrl", "-ir", hex(win["hwnd"]), "-e", f"0,{x},{y},-1,-1"],
                    capture_output=True,
                )
                return res.returncode == 0
        return False

    def get_window_rect(self, hwnd_or_title: Union[int, str]) -> Dict[str, int]:
        win = self.get_window(hwnd_or_title)
        return win.get("rect", {"x": 0, "y": 0, "width": 0, "height": 0}) if win else {"x": 0, "y": 0, "width": 0, "height": 0}
