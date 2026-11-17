import logging
import asyncio
import io
import time

logger = logging.getLogger(__name__)

_MAX_WINDOW_CAPTURE_PIXELS = 40_000_000
_PW_RENDERFULLCONTENT = 2


class ScreenEngine:
    def __init__(self):
        self._watch_task = None
        self._is_watching = False
        self.display_index = 0
        self.capture_interval_ms = 1000

    def configure(self, settings: dict) -> None:
        value = settings.get('display_index', 0)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            self.display_index = value
        interval = settings.get('screen_capture_interval_ms', self.capture_interval_ms)
        if isinstance(interval, (int, float)) and not isinstance(interval, bool):
            self.capture_interval_ms = max(100, min(60000, int(interval)))

    def capture_full(self) -> bytes:
        import mss
        from PIL import Image
        with mss.mss() as sct:
            monitor = sct.monitors[min(self.display_index + 1, len(sct.monitors) - 1)]
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

    def list_windows(self) -> list[dict]:
        """List visible application windows, excluding HELIX's own interface."""
        try:
            import win32gui
            import win32process
        except ImportError as error:
            raise RuntimeError("Window discovery requires pywin32.") from error

        foreground = int(win32gui.GetForegroundWindow())
        windows = []

        def collect(hwnd, _extra):
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = str(win32gui.GetWindowText(hwnd) or "").strip()
            if not title or title.casefold().startswith("helix"):
                return True
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            width, height = int(right - left), int(bottom - top)
            if width <= 0 or height <= 0:
                return True
            windows.append({
                "window_handle": int(hwnd),
                "title": title[:200],
                "pid": int(pid),
                "bounds": {
                    "x": int(left),
                    "y": int(top),
                    "width": width,
                    "height": height,
                },
                "is_foreground": int(hwnd) == foreground,
                "is_minimized": bool(win32gui.IsIconic(hwnd)),
            })
            return True

        win32gui.EnumWindows(collect, None)
        return windows[:80]

    def get_window_info(self, hwnd: int) -> dict:
        """Return title and screen bounds for a selected native window."""
        try:
            import win32gui
            import win32process
        except ImportError as error:
            raise RuntimeError("Window inspection requires pywin32.") from error
        if (
            isinstance(hwnd, bool)
            or not isinstance(hwnd, int)
            or hwnd <= 0
            or not win32gui.IsWindow(hwnd)
        ):
            raise ValueError("The target window handle is invalid or no longer exists.")
        title = str(win32gui.GetWindowText(hwnd) or "").strip()
        if title.casefold().startswith("helix"):
            raise ValueError("HELIX interface windows are excluded from observation.")
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return {
            "hwnd": hwnd,
            "title": title,
            "pid": int(pid),
            "rect": {
                "x": int(left),
                "y": int(top),
                "width": max(0, int(right - left)),
                "height": max(0, int(bottom - top)),
            },
        }

    def capture_window(self, hwnd: int) -> bytes:
        """Render one native window without including windows layered above it."""
        try:
            import win32gui
            import win32ui
            from PIL import Image
        except ImportError as error:
            raise RuntimeError(
                "Window capture requires pywin32 and Pillow."
            ) from error
        if (
            isinstance(hwnd, bool)
            or not isinstance(hwnd, int)
            or hwnd <= 0
            or not win32gui.IsWindow(hwnd)
        ):
            raise ValueError("The target window handle is invalid or no longer exists.")
        title = str(win32gui.GetWindowText(hwnd) or "").strip()
        if title.casefold().startswith("helix"):
            raise ValueError("HELIX interface windows are excluded from capture.")
        if win32gui.IsIconic(hwnd):
            raise RuntimeError("The target window is minimized and cannot be captured.")
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width, height = int(right - left), int(bottom - top)
        if (
            width <= 0
            or height <= 0
            or width * height > _MAX_WINDOW_CAPTURE_PIXELS
        ):
            raise RuntimeError(
                "The target window has no capturable area or exceeds the capture size limit."
            )

        window_dc = win32gui.GetWindowDC(hwnd)
        source_dc = None
        memory_dc = None
        bitmap = None
        try:
            source_dc = win32ui.CreateDCFromHandle(window_dc)
            memory_dc = source_dc.CreateCompatibleDC()
            bitmap = win32ui.CreateBitmap()
            bitmap.CreateCompatibleBitmap(source_dc, width, height)
            memory_dc.SelectObject(bitmap)
            if not win32gui.PrintWindow(
                hwnd,
                memory_dc.GetSafeHdc(),
                _PW_RENDERFULLCONTENT,
            ):
                raise RuntimeError(
                    "Windows could not render this window. No monitor screenshot "
                    "was substituted."
                )
            pixels = bitmap.GetBitmapBits(True)
            image = Image.frombytes(
                "RGB",
                (width, height),
                pixels,
                "raw",
                "BGRX",
            )
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()
        finally:
            if memory_dc is not None:
                memory_dc.DeleteDC()
            if bitmap is not None:
                win32gui.DeleteObject(bitmap.GetHandle())
            if source_dc is not None:
                source_dc.DeleteDC()
            win32gui.ReleaseDC(hwnd, window_dc)

    def capture_context(
        self,
        ocr_engine=None,
        ocr_error=None,
        window_handle: int | None = None,
    ) -> dict:
        image = (
            self.capture_full()
            if window_handle is None
            else self.capture_window(window_handle)
        )
        from PIL import Image

        screenshot = Image.open(io.BytesIO(image))
        screenshot.thumbnail((1600, 1600))
        screenshot_buffer = io.BytesIO()
        screenshot.save(screenshot_buffer, format="JPEG", quality=75, optimize=True)
        context = {
            "screenshot_bytes": screenshot_buffer.getvalue(),
            "active_window": (
                self.get_active_window_info()
                if window_handle is None
                else self.get_window_info(window_handle)
            ),
            "capture_scope": "monitor" if window_handle is None else "window",
            "ui_tree": {},
            "ocr_text": None,
            "ocr_error": ocr_error,
        }
        window = context["active_window"]
        if window:
            context["ui_tree"] = self.get_ui_tree(window["hwnd"])
        if ocr_engine is not None:
            try:
                context["ocr_text"] = ocr_engine.extract_text(image)[:6000]
            except Exception as error:
                logger.exception("OCR failed while building screen context")
                context["ocr_error"] = str(error)
        return context

    def get_screen_resolution(self) -> tuple[int, int]:
        import mss
        with mss.mss() as sct:
            monitor = sct.monitors[min(self.display_index + 1, len(sct.monitors) - 1)]
            return monitor["width"], monitor["height"]

    async def watch_for_changes(self, callback, interval_s: float | None = None):
        if self._is_watching:
            return
        self._is_watching = True
        interval_s = self.capture_interval_ms / 1000 if interval_s is None else max(0.1, interval_s)
        
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
                nonlocal visited
                if visited >= 100:
                    return None
                visited += 1
                rect = control.BoundingRectangle
                bounds = {
                    "x": rect.left,
                    "y": rect.top,
                    "width": rect.right - rect.left,
                    "height": rect.bottom - rect.top,
                }
                if depth > 3:
                    return {
                        "name": (control.Name or "")[:200],
                        "type": control.ControlTypeName,
                        "bounds": bounds,
                    }
                children = []
                for child in control.GetChildren():
                    child_node = traverse(child, depth + 1)
                    if child_node is not None:
                        children.append(child_node)
                    if visited >= 100:
                        break
                return {
                    "name": (control.Name or "")[:200],
                    "type": control.ControlTypeName,
                    "bounds": bounds,
                    "children": children
                }
            visited = 0
            return traverse(root) or {}
        except ImportError:
            logger.warning("uiautomation not installed. Accessibility tree not available.")
            return {}
        except Exception as e:
            logger.error(f"Error getting UI tree: {e}")
            return {}

    def click_ui_element(self, name: str, hwnd: int = None) -> bool:
        import uiautomation as auto

        root = auto.ControlFromHandle(hwnd) if hwnd else auto.GetRootControl()
        pending = [root]
        target = name.casefold()
        while pending:
            control = pending.pop()
            if target in (control.Name or "").casefold():
                try:
                    control.GetInvokePattern().Invoke()
                except Exception:
                    control.Click()
                return True
            pending.extend(control.GetChildren())
        return False
