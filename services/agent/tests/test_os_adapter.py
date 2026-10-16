import os
import platform
import subprocess
from unittest.mock import MagicMock, patch

import keyring
import pytest

from services.agent.os import (
    BaseOSAdapter,
    LinuxAdapter,
    MacOSAdapter,
    WindowsAdapter,
    get_os_adapter,
    reset_os_adapter,
)
from services.agent.os import windows as legacy_windows
from services.agent.os import windows_manager as legacy_windows_manager
from services.agent.security.secret_manager import SecretManager
from services.agent.tools.window_tool import Rect, WindowInfo, WindowTool


class TestOSAdapterFactory:
    def teardown_method(self):
        reset_os_adapter()

    def test_factory_returns_windows_adapter_on_windows(self):
        with patch("platform.system", return_value="Windows"):
            reset_os_adapter()
            adapter = get_os_adapter()
            assert isinstance(adapter, WindowsAdapter)

    def test_factory_returns_linux_adapter_on_linux(self):
        with patch("platform.system", return_value="Linux"):
            reset_os_adapter()
            adapter = get_os_adapter()
            assert isinstance(adapter, LinuxAdapter)

    def test_factory_returns_macos_adapter_on_darwin(self):
        with patch("platform.system", return_value="Darwin"):
            reset_os_adapter()
            adapter = get_os_adapter()
            assert isinstance(adapter, MacOSAdapter)

    def test_factory_singleton_behavior(self):
        adapter1 = get_os_adapter()
        adapter2 = get_os_adapter()
        assert adapter1 is adapter2

        adapter_fresh = get_os_adapter(force_refresh=True)
        assert isinstance(adapter_fresh, BaseOSAdapter)

    def test_factory_system_override_does_not_pollute_singleton(self):
        linux_adapter = get_os_adapter(system_override="Linux")
        assert isinstance(linux_adapter, LinuxAdapter)

        # Default singleton remains unchanged
        default_adapter = get_os_adapter()
        expected_type = {
            "Windows": WindowsAdapter,
            "Darwin": MacOSAdapter,
        }.get(platform.system(), LinuxAdapter)
        assert isinstance(default_adapter, expected_type)


class TestWindowsAdapter:
    @pytest.fixture
    def adapter(self):
        return WindowsAdapter()

    def test_system_info_structure(self, adapter):
        info = adapter.get_system_info()
        assert "os_version" in info
        assert "cpu_percent" in info
        assert "ram_total_gb" in info
        assert "ram_used_gb" in info
        assert "disk_info" in info
        assert info["ram_total_gb"] > 0
        assert info["disk_info"]["total_gb"] > 0

    def test_get_active_window(self, adapter):
        win = adapter.get_active_window()
        assert isinstance(win, dict)
        if win:
            assert "hwnd" in win
            assert "title" in win
            assert "pid" in win
            assert "rect" in win

    def test_get_foreground_pid(self, adapter):
        pid = adapter.get_foreground_pid()
        assert isinstance(pid, int)
        assert pid >= 0

    @pytest.mark.skipif(platform.system() != "Windows", reason="Requires native Windows win32clipboard")
    def test_clipboard_roundtrip(self, adapter):
        test_val = "helix_test_clipboard_data_123"
        adapter.set_clipboard(test_val)
        retrieved = adapter.get_clipboard()
        assert retrieved == test_val

    def test_show_notification_does_not_raise(self, adapter):
        adapter.show_notification("Helix Test", "Test notification message")

    def test_set_environment_variable_user(self, adapter):
        var_name = "HELIX_TEST_VAR_ADAPTER"
        var_val = "adapter_val_456"
        adapter.set_environment_variable(var_name, var_val, scope="user")
        assert os.environ.get(var_name) == var_val
        os.environ.pop(var_name, None)

    def test_list_applications(self, adapter):
        apps = adapter.list_applications()
        assert isinstance(apps, list)
        assert len(apps) > 0
        first = apps[0]
        assert "name" in first
        assert "pid" in first
        assert "exe_path" in first
        assert "window_titles" in first
        assert "memory_mb" in first

    @pytest.mark.skipif(platform.system() != "Windows", reason="Requires native Windows PowerShell")
    def test_execute_command(self, adapter):
        res = adapter.execute_command("Write-Output 'helix-adapter-ok'")
        assert res["success"] is True
        assert res["exit_code"] == 0
        assert "helix-adapter-ok" in res["stdout"]

    def test_window_management_methods_run(self, adapter):
        windows = adapter.list_windows(visible_only=False)
        assert isinstance(windows, list)
        if windows:
            first_hwnd = windows[0]["hwnd"]
            rect = adapter.get_window_rect(first_hwnd)
            assert "x" in rect
            assert "y" in rect
            assert "width" in rect
            assert "height" in rect
            text = adapter.get_window_text(first_hwnd)
            assert isinstance(text, str)


class TestLinuxAdapter:
    @pytest.fixture
    def adapter(self):
        return LinuxAdapter()

    def test_system_info_structure(self, adapter):
        info = adapter.get_system_info()
        assert "os_version" in info
        assert "cpu_percent" in info
        assert "ram_total_gb" in info
        assert "disk_info" in info

    def test_get_active_window_with_mocked_xdotool(self, adapter):
        def fake_run(cmd, **kwargs):
            action = cmd[1] if len(cmd) > 1 else ""
            if action == "getactivewindow":
                return subprocess.CompletedProcess(cmd, 0, stdout="123456\n", stderr="")
            elif action == "getwindowname":
                return subprocess.CompletedProcess(cmd, 0, stdout="Helix Terminal\n", stderr="")
            elif action == "getwindowpid":
                return subprocess.CompletedProcess(cmd, 0, stdout="7890\n", stderr="")
            elif action == "getwindowgeometry":
                geom = "WINDOW=123456\nX=100\nY=200\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n"
                return subprocess.CompletedProcess(cmd, 0, stdout=geom, stderr="")
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="error")

        with patch("shutil.which", return_value="/usr/bin/xdotool"), patch(
            "subprocess.run", side_effect=fake_run
        ):
            win = adapter.get_active_window()
            assert win["hwnd"] == 123456
            assert win["title"] == "Helix Terminal"
            assert win["pid"] == 7890
            assert win["rect"] == {"x": 100, "y": 200, "width": 800, "height": 600}

    def test_clipboard_with_mocked_xclip(self, adapter):
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/xclip" if x == "xclip" else None):
            with patch(
                "subprocess.run",
                return_value=subprocess.CompletedProcess(["xclip"], 0, stdout="linux-clip-content"),
            ):
                content = adapter.get_clipboard()
                assert content == "linux-clip-content"

            with patch("subprocess.run") as mock_run:
                adapter.set_clipboard("new-content")
                mock_run.assert_called_once()
                args, kwargs = mock_run.call_args
                assert "xclip" in args[0]
                assert kwargs.get("input") == b"new-content"

    def test_show_notification_with_notify_send(self, adapter):
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/notify-send" if x == "notify-send" else None):
            with patch("subprocess.run") as mock_run:
                adapter.show_notification("Linux Title", "Linux Message")
                mock_run.assert_called_once()
                assert mock_run.call_args[0][0] == ["notify-send", "Linux Title", "Linux Message"]

    def test_execute_command_via_bash(self, adapter):
        with patch("shutil.which", return_value="/bin/bash"):
            with patch(
                "subprocess.run",
                return_value=subprocess.CompletedProcess(
                    ["/bin/bash", "-c", "echo linux"],
                    0,
                    stdout="linux\n",
                    stderr="",
                ),
            ) as mock_run:
                res = adapter.execute_command("echo linux")
                assert res["success"] is True
                assert res["stdout"] == "linux\n"
                mock_run.assert_called_once()

    def test_window_operations_with_wmctrl(self, adapter):
        with patch("shutil.which", return_value="/usr/bin/wmctrl"):
            with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as mock_run:
                assert adapter.focus_window("Firefox") is True
                mock_run.assert_called_with(["wmctrl", "-a", "Firefox"], capture_output=True)


class TestMacOSAdapter:
    @pytest.fixture
    def adapter(self):
        return MacOSAdapter()

    def test_system_info_structure(self, adapter):
        info = adapter.get_system_info()
        assert "os_version" in info
        assert "cpu_percent" in info
        assert "ram_total_gb" in info
        assert "disk_info" in info

    def test_get_active_window_with_mocked_osascript(self, adapter):
        fake_output = "1234::Terminal::bash - helix::50::100::900::600"
        with patch.object(adapter, "_run_osascript", return_value=fake_output):
            win = adapter.get_active_window()
            assert win["hwnd"] == 1234
            assert win["pid"] == 1234
            assert win["title"] == "bash - helix"
            assert win["rect"] == {"x": 50, "y": 100, "width": 900, "height": 600}

    def test_get_foreground_pid_with_mocked_osascript(self, adapter):
        with patch.object(adapter, "_run_osascript", return_value="5678"):
            assert adapter.get_foreground_pid() == 5678

    def test_clipboard_with_pbpaste_and_pbcopy(self, adapter):
        with patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}"):
            with patch(
                "subprocess.run",
                return_value=subprocess.CompletedProcess(["pbpaste"], 0, stdout="macos-clipboard"),
            ):
                assert adapter.get_clipboard() == "macos-clipboard"

            with patch("subprocess.run") as mock_run:
                adapter.set_clipboard("macos-data")
                mock_run.assert_called_once()
                args, kwargs = mock_run.call_args
                assert "pbcopy" in args[0]
                assert kwargs.get("input") == b"macos-data"

    def test_show_notification_with_osascript(self, adapter):
        with patch.object(adapter, "_run_osascript", return_value="ok") as mock_osa:
            adapter.show_notification("Mac Title", "Mac Message")
            mock_osa.assert_called_once()
            assert 'display notification "Mac Message" with title "Mac Title"' in mock_osa.call_args[0][0]

    def test_execute_command_via_zsh(self, adapter):
        with patch("shutil.which", return_value="/bin/zsh"):
            with patch(
                "subprocess.run",
                return_value=subprocess.CompletedProcess(
                    ["/bin/zsh", "-c", "echo macos"],
                    0,
                    stdout="macos\n",
                    stderr="",
                ),
            ):
                res = adapter.execute_command("echo macos")
                assert res["success"] is True
                assert res["stdout"] == "macos\n"

    def test_window_operations_with_osascript(self, adapter):
        with patch.object(adapter, "_run_osascript", return_value="ok") as mock_osa:
            assert adapter.focus_window("Safari") is True
            assert 'tell application "Safari" to activate' in mock_osa.call_args[0][0]


class TestSecretManagerMultiOS:
    def test_secret_manager_accepts_linux_secretservice(self, monkeypatch):
        fake_backend = type(
            "SecretServiceKeyring",
            (),
            {"priority": 5, "__module__": "keyring.backends.SecretService"},
        )()
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr(keyring, "get_keyring", lambda: fake_backend)

        manager = SecretManager()
        assert manager.is_available()

    def test_secret_manager_accepts_linux_kwallet(self, monkeypatch):
        fake_backend = type(
            "DBusKeyring",
            (),
            {"priority": 4, "__module__": "keyring.backends.kwallet"},
        )()
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr(keyring, "get_keyring", lambda: fake_backend)

        manager = SecretManager()
        assert manager.is_available()

    def test_secret_manager_accepts_macos_keyring(self, monkeypatch):
        fake_backend = type(
            "MacOSKeyring",
            (),
            {"priority": 5, "__module__": "keyring.backends.macOS"},
        )()
        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr(keyring, "get_keyring", lambda: fake_backend)

        manager = SecretManager()
        assert manager.is_available()

    def test_secret_manager_rejects_insecure_backend_on_linux(self, monkeypatch):
        fake_backend = type(
            "PlaintextKeyring",
            (),
            {"priority": 1, "__module__": "keyring.backends.file"},
        )()
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr(keyring, "get_keyring", lambda: fake_backend)

        manager = SecretManager()
        assert not manager.is_available()

    def test_secret_manager_rejects_insecure_backend_on_macos(self, monkeypatch):
        fake_backend = type(
            "PlaintextKeyring",
            (),
            {"priority": 1, "__module__": "keyring.backends.file"},
        )()
        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr(keyring, "get_keyring", lambda: fake_backend)

        manager = SecretManager()
        assert not manager.is_available()


class TestLegacyWindowsModulesCompatibility:
    def test_legacy_windows_module_methods(self):
        info = legacy_windows.get_system_info()
        assert "ram_total_gb" in info
        ver = legacy_windows.get_windows_version()
        assert isinstance(ver, str)
        pid = legacy_windows.get_foreground_pid()
        assert isinstance(pid, int)

    def test_legacy_windows_manager_module_methods(self):
        windows = legacy_windows_manager.list_windows(visible_only=False)
        assert isinstance(windows, list)


@pytest.mark.asyncio
class TestWindowToolCrossPlatform:
    async def test_window_tool_uses_os_adapter_fallback(self):
        mock_adapter = MagicMock(spec=BaseOSAdapter)
        mock_adapter.list_windows.return_value = [
            {"hwnd": 101, "title": "Mocked Window", "pid": 500, "rect": {"x": 10, "y": 20, "width": 300, "height": 400}}
        ]
        mock_adapter.get_active_window.return_value = {
            "hwnd": 101, "title": "Mocked Window", "pid": 500, "rect": {"x": 10, "y": 20, "width": 300, "height": 400}
        }
        mock_adapter.get_window_rect.return_value = {"x": 10, "y": 20, "width": 300, "height": 400}

        tool = WindowTool(os_adapter=mock_adapter)

        # Patch _WIN32_AVAILABLE to False to test cross-platform branch
        with patch("services.agent.tools.window_tool._WIN32_AVAILABLE", False):
            windows = await tool.list_windows()
            assert len(windows) == 1
            assert windows[0].title == "Mocked Window"
            assert windows[0].hwnd == 101
            assert windows[0].rect == Rect(10, 20, 300, 400)

            active = await tool.get_active_window()
            assert active.title == "Mocked Window"
            assert active.hwnd == 101

            await tool.focus_window(101)
            mock_adapter.focus_window.assert_called_with(101)

            await tool.minimize_window(101)
            mock_adapter.minimize_window.assert_called_with(101)

            await tool.maximize_window(101)
            mock_adapter.maximize_window.assert_called_with(101)

            await tool.restore_window(101)
            mock_adapter.restore_window.assert_called_with(101)

            await tool.close_window(101)
            mock_adapter.close_window.assert_called_with(101)

            await tool.resize_window(101, 800, 600)
            mock_adapter.resize_window.assert_called_with(101, 800, 600)

            await tool.move_window(101, 50, 60)
            mock_adapter.move_window.assert_called_with(101, 50, 60)

            rect = await tool.get_window_rect(101)
            assert rect == Rect(10, 20, 300, 400)
