"""Windows virtual-desktop operations used to isolate desktop control."""

import importlib
import json
import os
from pathlib import Path
from typing import Any


class VirtualDesktopIsolationError(RuntimeError):
    """A dedicated Windows virtual desktop could not be prepared safely."""


class WindowsVirtualDesktop:
    """Create and reuse a HELIX-only virtual desktop through pyvda."""

    def __init__(
        self,
        state_path: Path | None = None,
        api: Any | None = None,
    ) -> None:
        self._state_path = state_path or self._default_state_path()
        self._api = api

    def ensure_dedicated(self) -> Any:
        """Return the persisted HELIX desktop or create one if it no longer exists."""
        api = self._module()
        desktops = api.get_virtual_desktops()
        desktop_id = self._read_desktop_id()
        if desktop_id is not None:
            for desktop in desktops:
                if str(desktop.id).casefold() == desktop_id.casefold():
                    return desktop

        try:
            desktop = api.VirtualDesktop.create()
        except Exception as error:
            raise VirtualDesktopIsolationError(
                "Windows could not create the dedicated HELIX virtual desktop."
            ) from error
        self._write_desktop_id(str(desktop.id))
        return desktop

    def move_window(self, window_handle: int) -> str:
        """Move one newly created HELIX window and verify its desktop ID."""
        if isinstance(window_handle, bool) or window_handle <= 0:
            raise ValueError("A positive target window handle is required.")
        api = self._module()
        desktop = self.ensure_dedicated()
        try:
            view = api.AppView(hwnd=window_handle)
            if str(view.desktop_id).casefold() != str(desktop.id).casefold():
                view.move(desktop)
            if str(view.desktop_id).casefold() != str(desktop.id).casefold():
                raise VirtualDesktopIsolationError(
                    f"Window {window_handle} did not move to the HELIX desktop."
                )
        except VirtualDesktopIsolationError:
            raise
        except Exception as error:
            raise VirtualDesktopIsolationError(
                f"Could not isolate window {window_handle} on the HELIX desktop."
            ) from error
        return str(desktop.id)

    def window_desktop_id(self, window_handle: int) -> str:
        """Return the virtual desktop containing a window without moving it."""
        if isinstance(window_handle, bool) or window_handle <= 0:
            raise ValueError("A positive target window handle is required.")
        try:
            return str(self._module().AppView(hwnd=window_handle).desktop_id)
        except Exception as error:
            raise VirtualDesktopIsolationError(
                f"Could not determine the virtual desktop for window {window_handle}."
            ) from error

    def enter_window_desktop(self, window_handle: int) -> str:
        """Activate HELIX's desktop only when the target already belongs to it."""
        dedicated = self.ensure_dedicated()
        if (
            self.window_desktop_id(window_handle).casefold()
            != str(dedicated.id).casefold()
        ):
            raise VirtualDesktopIsolationError(
                f"Window {window_handle} is not on the HELIX virtual desktop."
            )
        return self.enter_dedicated()

    def enter_dedicated(self) -> str:
        """Switch to HELIX's desktop and return the previous desktop ID."""
        api = self._module()
        previous = api.VirtualDesktop.current()
        try:
            self.ensure_dedicated().go()
        except Exception as error:
            raise VirtualDesktopIsolationError(
                "Could not activate the dedicated HELIX desktop."
            ) from error
        return str(previous.id)

    def restore_desktop(self, desktop_id: str) -> None:
        """Return to the desktop that was active before a fallback action."""
        if not isinstance(desktop_id, str) or not desktop_id:
            raise ValueError("The previous virtual desktop ID is invalid.")
        api = self._module()
        for desktop in api.get_virtual_desktops():
            if str(desktop.id).casefold() == desktop_id.casefold():
                try:
                    desktop.go()
                except Exception as error:
                    raise VirtualDesktopIsolationError(
                        "Could not restore the previously active virtual desktop."
                    ) from error
                return
        raise VirtualDesktopIsolationError(
            "The previously active virtual desktop no longer exists."
        )

    def _module(self) -> Any:
        if self._api is None:
            if os.name != "nt":
                raise VirtualDesktopIsolationError(
                    "Dedicated virtual desktops are only supported on Windows."
                )
            try:
                self._api = importlib.import_module("pyvda")
            except ImportError as error:
                raise VirtualDesktopIsolationError(
                    "The pyvda Windows virtual-desktop dependency is unavailable."
                ) from error
        return self._api

    def _read_desktop_id(self) -> str | None:
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError) as error:
            raise VirtualDesktopIsolationError(
                "Could not read the saved HELIX virtual-desktop identity."
            ) from error
        desktop_id = data.get("desktop_id") if isinstance(data, dict) else None
        if not isinstance(desktop_id, str) or not desktop_id:
            raise VirtualDesktopIsolationError(
                "The saved HELIX virtual-desktop identity is invalid."
            )
        return desktop_id

    def _write_desktop_id(self, desktop_id: str) -> None:
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(
                json.dumps({"desktop_id": desktop_id}, indent=2),
                encoding="utf-8",
            )
        except OSError as error:
            raise VirtualDesktopIsolationError(
                "Could not persist the HELIX virtual-desktop identity."
            ) from error

    @staticmethod
    def _default_state_path() -> Path:
        settings_path = os.environ.get("HELIX_SETTINGS_PATH")
        if settings_path:
            return Path(settings_path).with_name("desktop_control_state.json")
        app_data = Path(os.environ.get("APPDATA", Path.home()))
        return app_data / "HELIX" / "desktop_control_state.json"
