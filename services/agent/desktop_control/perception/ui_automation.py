"""Windows UI Automation snapshots and safe element resolution."""

import importlib
import logging
import threading
import time
from copy import deepcopy
from typing import Any


logger = logging.getLogger(__name__)


class UIAutomationError(RuntimeError):
    """A UI Automation query or element action failed."""


class UIAutomationUnavailable(UIAutomationError):
    """Windows UI Automation is unavailable in the current environment."""


class WindowsUIAutomation:
    """Expose a bounded active-window tree and short-lived element IDs."""

    def __init__(
        self,
        max_elements: int,
        max_depth: int,
        cache_ttl_ms: int,
        automation_module: Any | None = None,
    ) -> None:
        self._max_elements = max_elements
        self._max_depth = max_depth
        self._cache_ttl_seconds = cache_ttl_ms / 1000
        self._automation_module = automation_module
        self._lock = threading.RLock()
        self._cached_hwnd: int | None = None
        self._cached_at = 0.0
        self._cached_elements: list[dict[str, Any]] = []
        self._element_paths: dict[str, tuple[int, ...]] = {}
        self._generation = 0

    def observe(self, hwnd: int, title: str) -> dict[str, Any]:
        """Return a compact, bounded accessibility snapshot for one window."""
        with self._lock:
            now = time.monotonic()
            if (
                self._cache_ttl_seconds > 0
                and hwnd == self._cached_hwnd
                and now - self._cached_at <= self._cache_ttl_seconds
            ):
                return {
                    "window": {"hwnd": hwnd, "title": title},
                    "elements": deepcopy(self._cached_elements),
                }

            try:
                root = self._module().ControlFromHandle(hwnd)
                elements: list[dict[str, Any]] = []
                paths: dict[str, tuple[int, ...]] = {}
                self._generation += 1
                self._visit(root, (), 0, elements, paths, self._generation)
            except UIAutomationError:
                raise
            except Exception as error:
                raise UIAutomationError(
                    f"Could not inspect UI Automation elements for window {hwnd}."
                ) from error

            self._cached_hwnd = hwnd
            self._cached_at = now
            self._cached_elements = elements
            self._element_paths = paths
            return {
                "window": {"hwnd": hwnd, "title": title},
                "elements": deepcopy(elements),
            }

    def click_element(self, hwnd: int, element_id: str) -> str:
        """Invoke a current enabled element without synthesizing user input."""
        with self._lock:
            try:
                control = self._resolve(hwnd, element_id)
                self._require_enabled(control, element_id)
                try:
                    control.GetInvokePattern().Invoke()
                    return "invoke"
                except Exception as error:
                    raise UIAutomationError(
                        f"Element {element_id} does not expose a safe Invoke pattern."
                    ) from error
            finally:
                self._invalidate()

    def set_value(self, hwnd: int, element_id: str, text: str) -> None:
        """Set an accessible value without focusing the control or typing."""
        with self._lock:
            try:
                control = self._resolve(hwnd, element_id)
                self._require_enabled(control, element_id)
                try:
                    control.GetValuePattern().SetValue(text)
                except Exception as error:
                    raise UIAutomationError(
                        f"Element {element_id} does not expose a safe Value pattern."
                    ) from error
            finally:
                self._invalidate()

    def invalidate(self) -> None:
        """Discard the snapshot before an unrelated desktop action."""
        with self._lock:
            self._invalidate()

    def _visit(
        self,
        control: Any,
        path: tuple[int, ...],
        depth: int,
        elements: list[dict[str, Any]],
        paths: dict[str, tuple[int, ...]],
        generation: int,
    ) -> None:
        if len(elements) >= self._max_elements:
            return
        element_id = f"ui-{generation:x}-{len(elements) + 1}"
        name = str(control.Name or "")[:200]
        role = str(control.ControlTypeName or "")[:80]
        rectangle = control.BoundingRectangle
        bounds = {
            "x": int(rectangle.left),
            "y": int(rectangle.top),
            "width": max(0, int(rectangle.right - rectangle.left)),
            "height": max(0, int(rectangle.bottom - rectangle.top)),
        }
        enabled = bool(control.IsEnabled)
        offscreen = bool(control.IsOffscreen)
        state = "enabled" if enabled else "disabled"
        if offscreen:
            state = f"{state},offscreen"

        elements.append({
            "element_id": element_id,
            "name": name,
            "role": role,
            "state": state,
            "bounding_box": bounds,
        })
        paths[element_id] = path
        if depth >= self._max_depth or len(elements) >= self._max_elements:
            return
        for index, child in enumerate(control.GetChildren()):
            if len(elements) >= self._max_elements:
                break
            self._visit(
                child,
                path + (index,),
                depth + 1,
                elements,
                paths,
                generation,
            )

    def _resolve(self, hwnd: int, element_id: str) -> Any:
        if (
            hwnd != self._cached_hwnd
            or element_id not in self._element_paths
            or time.monotonic() - self._cached_at > self._cache_ttl_seconds
        ):
            raise UIAutomationError(
                "The UI Automation element ID is stale; observe the active window again."
            )
        path = self._element_paths[element_id]
        root = self._module().ControlFromHandle(hwnd)
        control = root
        try:
            for child_index in path:
                control = control.GetChildren()[child_index]
            expected = next(
                item for item in self._cached_elements
                if item["element_id"] == element_id
            )
            if self._identity(control) != (
                expected["name"],
                expected["role"],
                expected["bounding_box"],
            ):
                raise UIAutomationError(
                    "The UI Automation element changed; observe the active window again."
                )
        except UIAutomationError:
            raise
        except Exception as error:
            raise UIAutomationError(
                f"Could not resolve UI Automation element {element_id}."
            ) from error
        return control

    @staticmethod
    def _identity(control: Any) -> tuple[str, str, dict[str, int]]:
        rectangle = control.BoundingRectangle
        return (
            str(control.Name or "")[:200],
            str(control.ControlTypeName or "")[:80],
            {
                "x": int(rectangle.left),
                "y": int(rectangle.top),
                "width": max(0, int(rectangle.right - rectangle.left)),
                "height": max(0, int(rectangle.bottom - rectangle.top)),
            },
        )

    @staticmethod
    def _require_enabled(control: Any, element_id: str) -> None:
        if not bool(control.IsEnabled):
            raise UIAutomationError(
                f"UI Automation element {element_id} is disabled."
            )
        if bool(control.IsOffscreen):
            raise UIAutomationError(
                f"UI Automation element {element_id} is not visible."
            )

    def _module(self) -> Any:
        if self._automation_module is None:
            try:
                self._automation_module = importlib.import_module("uiautomation")
            except ImportError as error:
                raise UIAutomationUnavailable(
                    "Windows UI Automation requires the 'uiautomation' package."
                ) from error
        return self._automation_module

    def _invalidate(self) -> None:
        self._cached_hwnd = None
        self._cached_at = 0.0
        self._cached_elements = []
        self._element_paths = {}
