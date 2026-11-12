"""Tests for persisted virtual-desktop isolation without Windows COM."""

from dataclasses import dataclass

import pytest

from ..platform.windows_virtual_desktop import (
    VirtualDesktopIsolationError,
    WindowsVirtualDesktop,
)


@dataclass
class FakeDesktop:
    id: str
    go_count: int = 0

    def go(self) -> None:
        self.go_count += 1


class FakeDesktopAPI:
    def __init__(self) -> None:
        self.desktops = [FakeDesktop("user-desktop")]
        self.current = self.desktops[0]
        self.views: dict[int, FakeAppView] = {}

        class DesktopFactory:
            @staticmethod
            def create():
                desktop = FakeDesktop("helix-desktop")
                self.desktops.append(desktop)
                return desktop

            @staticmethod
            def current():
                return self.current

            @staticmethod
            def __new__(cls, desktop_id=None):
                return next(
                    desktop
                    for desktop in self.desktops
                    if desktop.id == desktop_id
                )

        self.VirtualDesktop = DesktopFactory

    def get_virtual_desktops(self):
        return list(self.desktops)

    def AppView(self, hwnd: int):
        return self.views.setdefault(hwnd, FakeAppView(hwnd))


class FakeAppView:
    def __init__(self, hwnd: int) -> None:
        self.hwnd = hwnd
        self.desktop_id = "user-desktop"

    def move(self, desktop: FakeDesktop) -> None:
        self.desktop_id = desktop.id


def test_creates_persists_and_reuses_the_dedicated_desktop(tmp_path):
    api = FakeDesktopAPI()
    manager = WindowsVirtualDesktop(tmp_path / "state.json", api=api)

    first = manager.ensure_dedicated()
    second = manager.ensure_dedicated()

    assert first is second
    assert len(api.desktops) == 2
    assert '"desktop_id": "helix-desktop"' in (
        tmp_path / "state.json"
    ).read_text(encoding="utf-8")


def test_moves_and_verifies_a_window_on_the_dedicated_desktop(tmp_path):
    api = FakeDesktopAPI()
    manager = WindowsVirtualDesktop(tmp_path / "state.json", api=api)

    desktop_id = manager.move_window(123)

    assert desktop_id == "helix-desktop"
    assert api.views[123].desktop_id == desktop_id


def test_enter_window_desktop_refuses_to_move_existing_user_windows(tmp_path):
    api = FakeDesktopAPI()
    manager = WindowsVirtualDesktop(tmp_path / "state.json", api=api)

    with pytest.raises(VirtualDesktopIsolationError, match="not on the HELIX"):
        manager.enter_window_desktop(123)

    assert api.views[123].desktop_id == "user-desktop"


def test_enter_window_desktop_uses_only_a_window_already_on_helix(tmp_path):
    api = FakeDesktopAPI()
    manager = WindowsVirtualDesktop(tmp_path / "state.json", api=api)
    manager.move_window(123)
    previous_desktop = manager.enter_window_desktop(123)

    assert previous_desktop == "user-desktop"
    assert api.views[123].desktop_id == "helix-desktop"
    assert api.desktops[1].go_count == 1


def test_fails_when_the_saved_desktop_state_is_invalid(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text('{"desktop_id": ""}', encoding="utf-8")
    manager = WindowsVirtualDesktop(state_path, api=FakeDesktopAPI())

    with pytest.raises(VirtualDesktopIsolationError, match="identity is invalid"):
        manager.ensure_dedicated()
