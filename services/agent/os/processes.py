import psutil
import logging
from dataclasses import dataclass
from typing import List, Optional
import subprocess

logger = logging.getLogger(__name__)

@dataclass
class ProcessInfo:
    pid: int
    name: str
    path: str
    cpu_percent: float
    memory_mb: float
    status: str
    create_time: float

def list_processes() -> List[dict]:
    processes = []
    for p in psutil.process_iter(['pid', 'name', 'exe', 'cpu_percent', 'memory_info', 'status', 'create_time']):
        try:
            mem_mb = p.info['memory_info'].rss / (1024 * 1024) if p.info['memory_info'] else 0
            processes.append({
                "pid": p.info['pid'],
                "name": p.info['name'],
                "path": p.info['exe'],
                "cpu_percent": p.info['cpu_percent'],
                "memory_mb": round(mem_mb, 2),
                "status": p.info['status'],
                "create_time": p.info['create_time']
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return processes

def get_process(pid_or_name: str | int) -> Optional[dict]:
    if isinstance(pid_or_name, int) or pid_or_name.isdigit():
        pid = int(pid_or_name)
        try:
            p = psutil.Process(pid)
            mem_mb = p.memory_info().rss / (1024 * 1024)
            return {
                "pid": p.pid,
                "name": p.name(),
                "path": p.exe(),
                "cpu_percent": p.cpu_percent(),
                "memory_mb": round(mem_mb, 2),
                "status": p.status(),
                "create_time": p.create_time()
            }
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None
    else:
        for p in psutil.process_iter(['pid', 'name']):
            try:
                if p.info['name'] and pid_or_name.lower() in p.info['name'].lower():
                    return get_process(p.info['pid'])
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    return None

def kill_process(pid: int, force: bool = False):
    try:
        p = psutil.Process(pid)
        if force:
            p.kill()
        else:
            p.terminate()
        p.wait(timeout=3)
        logger.info(f"Killed process {pid}")
    except psutil.NoSuchProcess:
        pass
    except Exception as e:
        logger.error(f"Failed to kill process {pid}: {e}")

def start_process(path: str, args: List[str] = None, working_dir: str = None) -> int:
    try:
        cmd = [path] + (args or [])
        p = subprocess.Popen(cmd, cwd=working_dir, close_fds=True, shell=False)
        return p.pid
    except Exception as e:
        logger.error(f"Failed to start process {path}: {e}")
        return 0

def is_running(name_or_pid: str | int) -> bool:
    return get_process(name_or_pid) is not None

def get_process_windows(pid: int) -> List[int]:
    try:
        import win32gui
        import win32process
        
        hwnds = []
        def callback(hwnd, hwnds_list):
            _, found_pid = win32process.GetWindowThreadProcessId(hwnd)
            if found_pid == pid and win32gui.IsWindowVisible(hwnd):
                hwnds_list.append(hwnd)
            return True
            
        win32gui.EnumWindows(callback, hwnds)
        return hwnds
    except ImportError:
        return []
