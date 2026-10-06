import logging
from typing import List, Optional
import re

logger = logging.getLogger(__name__)

def _get_win32():
    import win32gui
    import win32con
    return win32gui, win32con

def list_windows(visible_only: bool = True) -> List[dict]:
    win32gui, _ = _get_win32()
    windows = []
    
    def callback(hwnd, _):
        if visible_only and not win32gui.IsWindowVisible(hwnd):
            return True
            
        title = win32gui.GetWindowText(hwnd)
        if visible_only and not title:
            return True
            
        import win32process
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
                "height": rect[3] - rect[1]
            }
        })
        return True
        
    win32gui.EnumWindows(callback, None)
    return windows

def get_window(hwnd_or_title: int | str) -> Optional[dict]:
    if isinstance(hwnd_or_title, int):
        win32gui, _ = _get_win32()
        try:
            title = win32gui.GetWindowText(hwnd_or_title)
            import win32process
            _, pid = win32process.GetWindowThreadProcessId(hwnd_or_title)
            rect = win32gui.GetWindowRect(hwnd_or_title)
            return {
                "hwnd": hwnd_or_title,
                "title": title,
                "pid": pid,
                "rect": {
                    "x": rect[0], "y": rect[1],
                    "width": rect[2]-rect[0], "height": rect[3]-rect[1]
                }
            }
        except:
            return None
    else:
        hwnd = find_window_by_title(hwnd_or_title)
        return get_window(hwnd) if hwnd else None

def focus_window(hwnd: int):
    win32gui, win32con = _get_win32()
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    except Exception as e:
        logger.error(f"Error focusing window: {e}")

def minimize_window(hwnd: int):
    win32gui, win32con = _get_win32()
    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)

def maximize_window(hwnd: int):
    win32gui, win32con = _get_win32()
    win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)

def restore_window(hwnd: int):
    win32gui, win32con = _get_win32()
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

def close_window(hwnd: int):
    win32gui, win32con = _get_win32()
    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)

def resize_window(hwnd: int, width: int, height: int):
    win32gui, win32con = _get_win32()
    rect = win32gui.GetWindowRect(hwnd)
    win32gui.MoveWindow(hwnd, rect[0], rect[1], width, height, True)

def move_window(hwnd: int, x: int, y: int):
    win32gui, win32con = _get_win32()
    rect = win32gui.GetWindowRect(hwnd)
    w = rect[2] - rect[0]
    h = rect[3] - rect[1]
    win32gui.MoveWindow(hwnd, x, y, w, h, True)

def get_window_rect(hwnd: int) -> dict:
    win32gui, _ = _get_win32()
    rect = win32gui.GetWindowRect(hwnd)
    return {"x": rect[0], "y": rect[1], "width": rect[2]-rect[0], "height": rect[3]-rect[1]}

def get_window_text(hwnd: int) -> str:
    win32gui, _ = _get_win32()
    return win32gui.GetWindowText(hwnd)

def enumerate_child_windows(hwnd: int) -> List[int]:
    win32gui, _ = _get_win32()
    children = []
    try:
        def callback(child, _):
            children.append(child)
            return True
        win32gui.EnumChildWindows(hwnd, callback, None)
    except:
        pass
    return children

def find_window_by_title(title_pattern: str) -> Optional[int]:
    win32gui, _ = _get_win32()
    found_hwnd = None
    pattern = re.compile(title_pattern, re.IGNORECASE)
    
    def callback(hwnd, _):
        nonlocal found_hwnd
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if pattern.search(title):
                found_hwnd = hwnd
                return False # Stop enumerating
        return True
        
    try:
        win32gui.EnumWindows(callback, None)
    except:
        pass
    return found_hwnd
