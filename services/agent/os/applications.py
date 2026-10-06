import logging
import asyncio
from typing import List, Optional
from dataclasses import dataclass
from services.agent.os.processes import start_process, get_process, kill_process

logger = logging.getLogger(__name__)

@dataclass
class AppInfo:
    name: str
    pid: int
    exe_path: str
    window_titles: List[str]
    memory_mb: float

async def open_application(name_or_path: str, args: List[str] = None) -> dict:
    import os
    if not os.path.exists(name_or_path):
        # Attempt to resolve common paths or rely on system PATH
        pass
        
    pid = start_process(name_or_path, args)
    if pid > 0:
        return {"pid": pid, "success": True, "error": None}
    else:
        return {"pid": 0, "success": False, "error": "Failed to launch process"}

async def close_application(name_or_pid: str | int):
    # This requires confirmation logically, but at OS level it's a kill call
    p_info = get_process(name_or_pid)
    if p_info:
        kill_process(p_info['pid'])

async def get_running_applications() -> List[dict]:
    import psutil
    apps = []
    try:
        import win32gui
        import win32process
        
        def enum_cb(hwnd, results):
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                if pid not in results:
                    results[pid] = []
                results[pid].append(win32gui.GetWindowText(hwnd))
            return True
            
        window_map = {}
        win32gui.EnumWindows(enum_cb, window_map)
        
        for pid, titles in window_map.items():
            p_info = get_process(pid)
            if p_info:
                apps.append({
                    "name": p_info['name'],
                    "pid": pid,
                    "exe_path": p_info['path'],
                    "window_titles": titles,
                    "memory_mb": p_info['memory_mb']
                })
    except ImportError:
        pass
    return apps

async def find_application(name: str) -> Optional[dict]:
    apps = await get_running_applications()
    for app in apps:
        if name.lower() in app['name'].lower() or any(name.lower() in t.lower() for t in app['window_titles']):
            return app
    return None

def get_default_app_for_file(file_path: str) -> str:
    import os
    import winreg
    ext = os.path.splitext(file_path)[1].lower()
    if not ext:
        return ""
        
    try:
        # Get ProgID
        key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, ext)
        prog_id, _ = winreg.QueryValueEx(key, "")
        winreg.CloseKey(key)
        
        # Get command
        cmd_key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"{prog_id}\shell\open\command")
        cmd, _ = winreg.QueryValueEx(cmd_key, "")
        winreg.CloseKey(cmd_key)
        return cmd
    except Exception:
        return ""
