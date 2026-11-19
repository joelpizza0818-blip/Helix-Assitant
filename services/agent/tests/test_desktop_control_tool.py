"""Tests for on-demand ReAct integration of desktop control."""

from pathlib import Path
from typing import Any

import pytest

from services.agent.ai.google_provider import GoogleProvider
from services.agent.core.orchestrator import _should_observe_screen
from services.agent.core.react_loop import ReActLoop
from services.agent.core.tool_registry import ToolRegistry
from services.agent.desktop_control.guest.client import GuestDesktopUnavailable
from services.agent.security.permission_manager import (
    PermissionManager,
    PermissionMode,
)
from services.agent.tools.desktop_control_tool import DesktopControlTool


class FakeGuestClient:
    def __init__(self, configured: bool = True) -> None:
        self.calls: list[dict[str, Any]] = []
        self.configured = configured

    def is_configured(self) -> bool:
        return self.configured

    async def execute(self, action: str, **parameters: Any) -> dict[str, Any]:
        self.calls.append({"action": action, **parameters})
        if action == "screenshot":
            return {
                "screenshot_bytes": b"guest-frame",
                "capture_source": "docker_guest",
                "desktop_backend": "docker_guest",
                "virtual_cursor": {"x": 0.3, "y": 0.4, "visible": True},
            }
        return {"action": action}


class FakeHostClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.settings: dict[str, Any] = {}

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = dict(settings)

    async def execute(self, action: str, **parameters: Any) -> dict[str, Any]:
        self.calls.append({"action": action, **parameters})
        if action == "windows":
            return {"windows": [{"window_handle": 42, "title": "Editor"}]}
        if action == "screenshot":
            return {
                "screenshot_bytes": b"host-frame",
                "capture_source": "windows_host",
                "desktop_backend": "windows_host",
                "window_handle": parameters["window_handle"],
                "window_title": "Editor",
            }
        if action == "observe_ui":
            return {
                "window_handle": parameters["window_handle"],
                "window_title": "Editor",
                "capture_source": "windows_host",
                "desktop_backend": "windows_host",
            }
        return {
            "action": action,
            "capture_source": "windows_host",
            "desktop_backend": "windows_host",
        }


def test_desktop_tool_validates_action_and_requires_a_typing_target():
    tool = DesktopControlTool(FakeGuestClient())

    assert not tool.validate_params({"action": "click_element", "window_handle": 42})
    assert not tool.validate_params({"action": "capture_monitor"})
    assert tool.validate_params({"action": "list_windows"})
    assert tool.validate_params({"action": "guest_screenshot"})
    assert not tool.validate_params({"action": "host_screenshot"})
    assert tool.validate_params({"action": "host_screenshot", "window_handle": 42})
    assert tool.validate_params({
        "action": "guest_move",
        "x": 10,
        "y": 20,
        "target_description": "Move cursor to the Save button",
    })
    assert tool.validate_params({
        "action": "guest_click",
        "x": 10,
        "y": 20,
        "target_description": "Open the settings menu",
    })
    assert not tool.validate_params({
        "action": "guest_key",
        "key": "ctrl+a; id",
        "target_description": "Document editor",
    })
    assert not tool.validate_params({
        "action": "guest_click",
        "x": True,
        "y": 20,
        "target_description": "Open the settings menu",
    })


@pytest.mark.asyncio
async def test_host_desktop_actions_attach_only_the_selected_window_preview():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(), host)
    tool.configure({
        "computer_use_mode": "host",
        "computer_use_host_consent": True,
    })

    result = await tool.execute({
        "action": "host_observe_ui",
        "window_handle": 42,
    })

    assert result.success
    assert result.output["_desktop_preview_frame"] == b"host-frame"
    assert result.output["_desktop_preview_title"] == "Editor"
    assert host.calls == [
        {"action": "observe_ui", "window_handle": 42},
        {"action": "screenshot", "window_handle": 42},
    ]


@pytest.mark.asyncio
async def test_desktop_preview_publishes_guest_and_selected_host_window_frames():
    class FakeEventBus:
        def __init__(self) -> None:
            self.events = []

        async def publish(self, event_name, payload):
            self.events.append((event_name, payload))

    event_bus = FakeEventBus()
    loop = type("Loop", (), {"event_bus": event_bus})()

    host_output = {
        "capture_source": "windows_host",
        "window_title": "Editor",
        "_desktop_preview_frame": b"host-frame",
    }
    await ReActLoop._publish_desktop_frame(
        loop,
        "7dbde734-e57d-4c8c-9c88-cb4bc61d7b6f",
        host_output,
    )
    await ReActLoop._publish_desktop_frame(
        loop,
        "7dbde734-e57d-4c8c-9c88-cb4bc61d7b6f",
        {
            "capture_source": "docker_guest",
            "screenshot_bytes": b"guest-frame",
            "virtual_cursor": {"x": 0.4, "y": 0.7, "visible": True},
        },
    )

    assert "_desktop_preview_frame" not in host_output
    assert len(event_bus.events) == 2
    host_event, host_payload = event_bus.events[0]
    assert host_event == "DESKTOP_FRAME"
    assert host_payload["source"] == "windows_host"
    assert host_payload["window_title"] == "Editor"
    assert host_payload["image_base64"] == "aG9zdC1mcmFtZQ=="
    guest_event, guest_payload = event_bus.events[1]
    assert guest_event == "DESKTOP_FRAME"
    assert guest_payload["task_id"] == "7dbde734-e57d-4c8c-9c88-cb4bc61d7b6f"
    assert guest_payload["mime_type"] == "image/jpeg"
    assert guest_payload["source"] == "docker_guest"
    assert guest_payload["image_base64"] == "Z3Vlc3QtZnJhbWU="
    assert guest_payload["cursor"] == {"x": 0.4, "y": 0.7, "visible": True}


@pytest.mark.asyncio
async def test_desktop_preview_rejects_oversized_frames_and_invalid_cursor():
    class FakeEventBus:
        def __init__(self) -> None:
            self.events = []

        async def publish(self, event_name, payload):
            self.events.append((event_name, payload))

    event_bus = FakeEventBus()
    loop = type("Loop", (), {"event_bus": event_bus})()

    await ReActLoop._publish_desktop_frame(
        loop,
        "7dbde734-e57d-4c8c-9c88-cb4bc61d7b6f",
        {
            "capture_source": "docker_guest",
            "screenshot_bytes": b"x" * 560_001,
        },
    )
    await ReActLoop._publish_desktop_frame(
        loop,
        "7dbde734-e57d-4c8c-9c88-cb4bc61d7b6f",
        {
            "capture_source": "docker_guest",
            "screenshot_bytes": b"guest-frame",
            "virtual_cursor": {"x": 2.0, "y": 0.7, "visible": True},
        },
    )

    assert len(event_bus.events) == 1
    assert "cursor" not in event_bus.events[0][1]


def test_desktop_tool_requires_confirmation_for_sensitive_targets():
    tool = DesktopControlTool(FakeGuestClient())

    assert tool.permission_level_for({
        "action": "guest_click",
        "x": 10,
        "y": 20,
        "target_description": "Send email",
    }) == "SYSTEM"
    assert tool.permission_level_for({
        "action": "guest_launch",
        "application": "org.example.App",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "guest_click",
        "x": 10,
        "y": 20,
        "target_description": "Enviar mensaje",
    }) == "SYSTEM"
    assert tool.permission_level_for({
        "action": "guest_type",
        "text": "test",
        "target_description": "Bank password field",
    }) == "SYSTEM"

    manager = PermissionManager(mode=PermissionMode.AUTO_APPROVE)
    evaluation = manager.evaluate_risk(
        tool.name,
        {"action": "guest_click", "target_description": "Send email"},
        tool.permission_level_for({
            "action": "guest_click",
            "target_description": "Send email",
        }),
    )
    assert evaluation.requires_confirmation
    assert evaluation.level.name == "SYSTEM"


@pytest.mark.asyncio
async def test_desktop_preflight_returns_guest_screenshot_without_host_access():
    guest = FakeGuestClient()
    tool = DesktopControlTool(guest)

    result = await tool.execute({"action": "list_windows"})

    assert result.success
    assert result.output["screenshot_bytes"] == b"guest-frame"
    assert result.output["capture_source"] == "docker_guest"
    assert guest.calls == [{"action": "screenshot"}]


@pytest.mark.asyncio
async def test_guest_action_failure_is_not_replaced_by_host_control():
    class MissingGuest:
        def is_configured(self) -> bool:
            return True

        async def execute(self, *_args, **_kwargs):
            raise RuntimeError("The Docker desktop session is not configured.")

    tool = DesktopControlTool(MissingGuest(), FakeHostClient())

    result = await tool.execute({"action": "list_windows"})

    assert not result.success
    assert "No other desktop backend was used" in result.error


@pytest.mark.asyncio
async def test_host_mode_without_consent_uses_docker_for_default_actions():
    host = FakeHostClient()
    guest = FakeGuestClient()
    tool = DesktopControlTool(guest, host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": False})

    result = await tool.execute({"action": "list_windows"})

    assert result.success
    assert result.output["desktop_backend"] == "docker_guest"
    assert guest.calls == [{"action": "screenshot"}]
    assert host.calls == []


@pytest.mark.asyncio
async def test_host_mode_without_consent_still_rejects_explicit_host_actions():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(), host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": False})

    result = await tool.execute({"action": "host_screenshot", "window_handle": 42})

    assert not result.success
    assert "one-time explicit consent" in result.error
    assert host.calls == []


@pytest.mark.asyncio
async def test_host_mode_without_consent_allows_explicit_docker_actions():
    guest = FakeGuestClient()
    host = FakeHostClient()
    tool = DesktopControlTool(guest, host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": False})

    result = await tool.execute({"action": "guest_screenshot"})

    assert result.success
    assert result.output["desktop_backend"] == "docker_guest"
    assert guest.calls == [{"action": "screenshot"}]
    assert host.calls == []


@pytest.mark.asyncio
async def test_host_mode_controls_the_real_desktop_only_after_consent():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(), host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": True})

    result = await tool.execute({
        "action": "host_click",
        "x": 12,
        "y": 24,
        "target_description": "Open the Start menu",
    })

    assert result.success
    assert result.output["desktop_backend"] == "windows_host"
    assert result.output["capture_source"] == "windows_host"
    assert "screenshot_bytes" not in result.output
    assert host.calls == [{"action": "click", "x": 12, "y": 24}]
    assert "backend_note" not in result.output


@pytest.mark.asyncio
async def test_host_screenshot_requires_and_uses_a_selected_window():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(), host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": True})

    result = await tool.execute({
        "action": "host_screenshot",
        "window_handle": 42,
    })

    assert result.success
    assert result.output["screenshot_bytes"] == b"host-frame"
    assert result.output["window_handle"] == 42
    assert host.calls == [{"action": "screenshot", "window_handle": 42}]


@pytest.mark.asyncio
async def test_host_mode_rejects_guest_actions_instead_of_touching_the_host():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(), host)
    tool.configure({"computer_use_mode": "host", "computer_use_host_consent": True})

    result = await tool.execute({
        "action": "guest_click",
        "x": 12,
        "y": 24,
        "target_description": "Click the guest desktop",
    })

    assert not result.success
    assert host.calls == []


@pytest.mark.asyncio
async def test_auto_mode_prefers_the_host_when_host_consent_exists():
    guest = FakeGuestClient(configured=True)
    host = FakeHostClient()
    tool = DesktopControlTool(guest, host)
    tool.configure({"computer_use_mode": "auto", "computer_use_host_consent": True})

    result = await tool.execute({"action": "list_windows"})

    assert result.success
    assert result.output["desktop_backend"] == "windows_host"
    assert guest.calls == []
    assert host.calls == [{"action": "windows"}]
    assert "screenshot_bytes" not in result.output


@pytest.mark.asyncio
async def test_auto_mode_falls_back_to_consented_host_when_guest_is_unavailable():
    class MissingGuest:
        def is_configured(self) -> bool:
            return False

        async def execute(self, *_args, **_kwargs):
            raise RuntimeError("The Docker desktop session is not configured.")

    host = FakeHostClient()
    tool = DesktopControlTool(MissingGuest(), host)
    tool.configure({"computer_use_mode": "auto", "computer_use_host_consent": True})

    result = await tool.execute({"action": "list_windows"})

    assert result.success
    assert result.output["desktop_backend"] == "windows_host"
    assert host.calls == [{"action": "windows"}]
    assert result.output["backend_note"] == "isolated_desktop_unavailable"


@pytest.mark.asyncio
async def test_auto_mode_without_consent_reports_docker_readiness_not_host_permission():
    class MissingGuest:
        def is_configured(self) -> bool:
            return False

        async def execute(self, *_args, **_kwargs):
            raise GuestDesktopUnavailable("The Docker desktop session is not configured.")

    host = FakeHostClient()
    tool = DesktopControlTool(MissingGuest(), host)
    tool.configure({"computer_use_mode": "auto", "computer_use_host_consent": False})

    result = await tool.execute({"action": "list_windows"})

    assert not result.success
    assert "Docker desktop session is not configured" in result.error
    assert result.output["desktop_backend"] == "docker_guest"
    assert result.safe_to_retry
    assert host.calls == []


@pytest.mark.asyncio
async def test_auto_mode_rejects_host_actions_without_consent():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(configured=True), host)
    tool.configure({"computer_use_mode": "auto", "computer_use_host_consent": False})

    result = await tool.execute({"action": "host_screenshot", "window_handle": 42})

    assert not result.success
    assert "one-time explicit consent" in result.error
    assert host.calls == []


@pytest.mark.asyncio
async def test_auto_mode_rejects_environment_override_without_consent():
    host = FakeHostClient()
    tool = DesktopControlTool(FakeGuestClient(configured=True), host)
    tool.configure({"computer_use_mode": "auto", "computer_use_host_consent": False})

    result = await tool.execute({"action": "list_windows", "environment": "windows_host"})

    assert not result.success
    assert "one-time explicit consent" in result.error
    assert host.calls == []


@pytest.mark.asyncio
async def test_guest_mouse_action_returns_a_fresh_guest_frame():
    guest = FakeGuestClient()
    tool = DesktopControlTool(guest)

    result = await tool.execute({
        "action": "guest_move",
        "x": 40,
        "y": 50,
        "target_description": "Move the cursor to the Save button",
    })

    assert result.success
    assert result.output["screenshot_bytes"] == b"guest-frame"
    assert result.output["capture_source"] == "docker_guest"
    assert guest.calls == [
        {"action": "move", "x": 40, "y": 50},
        {"action": "screenshot"},
    ]


def test_native_tool_discovery_registers_desktop_control():
    registry = ToolRegistry()

    registry.auto_discover(str(Path(__file__).resolve().parents[1] / "tools"))

    tool = registry.get_tool("computer.desktop_control")
    assert isinstance(tool, DesktopControlTool)
    assert "without it, use the isolated Docker desktop" in tool.description
    assert "Direct host control requires prior user consent" in tool.description
    assert "never attempt to bypass" in tool.description


def test_desktop_tool_schema_is_accepted_by_google_function_declaration():
    schema = DesktopControlTool().get_schema()

    converted = GoogleProvider._convert_tools([{
        "name": schema["name"],
        "description": schema["description"],
        "parameters": schema["parameters"],
    }])

    assert converted[0].function_declarations[0].parameters is not None
    actions = schema["parameters"]["properties"]["action"]["enum"]
    assert "guest_click" in actions
    assert "guest_move" in actions
    assert "host_click" in actions
    assert "host_drag" in actions
    assert "click_element" not in actions
    assert "capture_monitor" not in actions


@pytest.mark.parametrize(
    "description",
    [
        "Open Notepad and type a test sentence",
        "Abre el bloc de notas y escribe una prueba",
        "Launch Calculator then click its display",
        "Use desktop control to inspect the open Explorer window",
    ],
)
def test_compound_desktop_requests_enable_on_demand_observation(description):
    assert _should_observe_screen(True, description)


@pytest.mark.parametrize("description", ["Open Word", "Abre Word", "Tell me a joke"])
def test_app_mentions_alone_do_not_enable_desktop_observation(description):
    assert not _should_observe_screen(True, description)
