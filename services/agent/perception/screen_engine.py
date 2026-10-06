import logging
import asyncio
import io
import time

logger = logging.getLogger(__name__)

class ScreenEngine:
    def __init__(self):
        self._watch_task = None
        self._is_watching = False
        
    def capture_full(self) -> bytes:
        import mss
        from PIL import Image
        with mss.mss() as sct:
            monitor = sct.monitors[1] # Primary monitor
            sct_img = sct.grab(monitor)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

    def capture_region(self, x: int, y: int, w: int, h: int) -> bytes:
        import mss
        from PIL import Image
        with mss.mss() as sct:
            monitor = {"top": y, "left": x, "width": w, "height": h}
            sct_img = sct.grab(monitor)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

    def capture_window(self, hwnd: int) -> bytes:
        import win32gui
        try:
            rect = win32gui.GetWindowRect(hwnd)
            x = rect[0]
            y = rect[1]
            w = rect[2] - x
            h = rect[3] - y
            if w > 0 and h > 0:
                return self.capture_region(x, y, w, h)
        except Exception as e:
            logger.error(f"Error capturing window {hwnd}: {e}")
        return b""

    def get_screen_resolution(self) -> tuple[int, int]:
        import mss
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            return monitor["width"], monitor["height"]

    async def watch_for_changes(self, callback, interval_s: float = 1.0):
        if self._is_watching:
            return
        self._is_watching = True
        
        async def _loop():
            last_screen = self.capture_full()
            while self._is_watching:
                await asyncio.sleep(interval_s)
                current_screen = self.capture_full()
                if current_screen != last_screen:
                    # Could add structural similarity check here
                    await callback(last_screen, current_screen)
                    last_screen = current_screen
                    
        self._watch_task = asyncio.create_task(_loop())

    async def stop_watching(self):
        self._is_watching = False
        if self._watch_task:
            self._watch_task.cancel()

    def get_active_window_info(self) -> dict:
        import win32gui
        import win32process
        
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return {}
            
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        title = win32gui.GetWindowText(hwnd)
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

    def get_ui_tree(self, hwnd: int = None) -> dict:
        try:
            import uiautomation as auto
            if hwnd:
                root = auto.ControlFromHandle(hwnd)
            else:
                root = auto.GetRootControl()
                
            def traverse(control, depth=0):
                if depth > 3: # limit depth to prevent massive trees
                    return {"name": control.Name, "type": control.ControlTypeName}
                children = []
                for child in control.GetChildren():
                    children.append(traverse(child, depth + 1))
                return {
                    "name": control.Name,
                    "type": control.ControlTypeName,
                    "children": children
                }
            return traverse(root)
        except ImportError:
            logger.warning("uiautomation not installed. Accessibility tree not available.")
            return {}
        except Exception as e:
            logger.error(f"Error getting UI tree: {e}")
            return {}
