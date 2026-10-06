import asyncio
import logging
import psutil
from dataclasses import dataclass
from typing import List, Optional, Union
import win32process
import win32gui

logger = logging.getLogger(__name__)

@dataclass
class AppInfo:
    name: str
    pid: int
    path: str
    memory_mb: float
    cpu_percent: float

@dataclass
class AppLaunchResult:
    pid: Optional[int]
    success: bool
    error: Optional[str]

class ApplicationTool:
    """Tool for controlling and monitoring applications."""
    
    async def open_application(self, app_name_or_path: str, args: List[str] = None) -> AppLaunchResult:
        """Launches an application."""
        logger.info(f"Opening application: {app_name_or_path} with args {args}")
        try:
            cmd = [app_name_or_path]
            if args:
                cmd.extend(args)
            proc = await asyncio.create_subprocess_exec(*cmd)
            return AppLaunchResult(pid=proc.pid, success=True, error=None)
        except Exception as e:
            logger.error(f"Failed to open application: {e}")
            return AppLaunchResult(pid=None, success=False, error=str(e))

    async def _get_process(self, app_name_or_pid: Union[str, int]) -> Optional[psutil.Process]:
        if isinstance(app_name_or_pid, int):
            try:
                return psutil.Process(app_name_or_pid)
            except psutil.NoSuchProcess:
                return None
        
        for p in psutil.process_iter(['name', 'pid']):
            if p.info['name'].lower() == app_name_or_pid.lower():
                return p
        return None

    async def close_application(self, app_name_or_pid: Union[str, int]) -> None:
        """Gracefully closes an application."""
        logger.info(f"Closing application: {app_name_or_pid}")
        proc = await self._get_process(app_name_or_pid)
        if proc:
            await asyncio.to_thread(proc.terminate)
            
    async def is_running(self, app_name: str) -> bool:
        """Checks if an application is running."""
        return await self._get_process(app_name) is not None

    async def get_running_applications(self) -> List[AppInfo]:
        """Gets a list of running applications."""
        logger.info("Getting running applications")
        apps = []
        for p in psutil.process_iter(['name', 'pid', 'exe', 'memory_info', 'cpu_percent']):
            try:
                mem = p.info['memory_info'].rss / (1024 * 1024) if p.info['memory_info'] else 0
                apps.append(AppInfo(
                    name=p.info['name'],
                    pid=p.info['pid'],
                    path=p.info['exe'] or "",
                    memory_mb=mem,
                    cpu_percent=p.info['cpu_percent'] or 0.0
                ))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return apps

    async def bring_to_front(self, app_name: str) -> None:
        """Brings an application's windows to the front."""
        logger.info(f"Bringing to front: {app_name}")
        proc = await self._get_process(app_name)
        if not proc:
            return
            
        def enum_windows_proc(hwnd, _):
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid == proc.pid and win32gui.IsWindowVisible(hwnd):
                win32gui.SetForegroundWindow(hwnd)
            return True
            
        await asyncio.to_thread(win32gui.EnumWindows, enum_windows_proc, None)

    async def kill_application(self, app_name_or_pid: Union[str, int]) -> None:
        """Force kills an application."""
        logger.info(f"Killing application: {app_name_or_pid}")
        proc = await self._get_process(app_name_or_pid)
        if proc:
            await asyncio.to_thread(proc.kill)
