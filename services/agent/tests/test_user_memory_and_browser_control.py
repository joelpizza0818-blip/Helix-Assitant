import asyncio
import base64
import logging
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import services.agent.tools.browser_control_tool as browser_control_module
from services.agent.browser.browser_session import BrowserSession
from services.agent.browser.observer import BrowserObservation
from services.agent.browser.state_validator import BrowserStateValidator
from services.agent.core.react_loop import ReActLoop
from services.agent.security.permission_manager import PermissionManager
from services.agent.core.tool_registry import ToolRegistry
from services.agent.memory.user_memory_manager import UserMemoryManager
from services.agent.tools.browser_control_tool import BrowserControlTool
from services.agent.tools.memory_tool import UserMemoryTool


def test_user_memory_crud_deduplication_and_secret_rejection(tmp_path):
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    saved = manager.add_memory("Prefers concise answers", "preference")
    duplicate = manager.add_memory("Prefers concise answers", "preference")

    assert duplicate["id"] == saved["id"]
    assert len(manager.load_all()) == 1
    assert manager.search("concise")[0]["id"] == saved["id"]
    assert manager.update_memory(saved["id"], "Prefers short answers", "instruction")["text"] == "Prefers short answers"
    assert manager.delete_memory(saved["id"])
    assert manager.load_all() == []

    with pytest.raises(ValueError, match="Credentials and secrets"):
        manager.add_memory("api_key: do-not-store", "fact")


def test_user_memory_context_is_bounded_and_treats_entries_as_data(tmp_path):
    """format_context_prompt should include the summary and user_notes in the prompt."""
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    manager.update_summary("User prefers dark mode and concise answers.")
    manager.update_user_notes("Always respond in Spanish.")

    prompt = manager.format_context_prompt()

    assert "What Helix knows about the user" in prompt
    assert "User prefers dark mode" in prompt
    assert "Always respond in Spanish" in prompt


def test_general_memory_graph_tracks_learned_facts_and_keeps_positions(tmp_path):
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    manager.update_summary("Uses [[Python]] for automation.\nPython")

    graph = manager.get_knowledge_graph()
    facts = {node["title"]: node for node in graph["nodes"]}
    assert graph["project_id"] == "general-memory"
    assert any(edge["relation"] == "references" for edge in graph["edges"])
    assert any(edge["relation"] == "mentions" for edge in graph["edges"])

    fact = facts["Uses [[Python]] for automation."]
    fact["title"] = "Automation preference"
    fact["x"] = -415
    fact["y"] = 19000
    saved = manager.save_knowledge_graph(graph["nodes"], graph["edges"])
    reloaded = manager.get_knowledge_graph()
    saved_fact = next(node for node in reloaded["nodes"] if node["node_id"] == fact["node_id"])

    assert manager.get_summary() == "Uses [[Python]] for automation.\nPython"
    assert saved["project_id"] == "general-memory"
    assert saved_fact["title"] == "Automation preference"
    assert saved_fact["x"] == -415
    assert saved_fact["y"] == 19000


def test_general_memory_graph_refreshes_after_learning_and_clear(tmp_path):
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    manager.update_summary("Prefers concise explanations.")
    first = manager.get_knowledge_graph()
    manager.update_summary("Prefers concise explanations.\nUses Python.")

    refreshed = manager.get_knowledge_graph()
    manager.clear_all()
    cleared = manager.get_knowledge_graph()

    assert len([node for node in first["nodes"] if node["node_id"] != "general-memory"]) == 1
    assert len([node for node in refreshed["nodes"] if node["node_id"] != "general-memory"]) == 2
    assert [node["node_id"] for node in cleared["nodes"]] == ["general-memory"]


@pytest.mark.asyncio
async def test_user_memory_tool_save_recall_update_and_delete(monkeypatch, tmp_path):
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    monkeypatch.setattr(UserMemoryManager, "_instance", manager)
    tool = UserMemoryTool()

    saved = await tool.execute({"action": "save", "text": "Uses dark mode", "category": "preference"})
    memory_id = saved.output["memory"]["id"]
    recalled = await tool.execute({"action": "recall", "query": "dark"})
    updated = await tool.execute({"action": "update", "memory_id": memory_id, "text": "Prefers dark mode"})
    deleted = await tool.execute({"action": "delete", "memory_id": memory_id})

    assert saved.success and recalled.output["count"] == 1
    assert updated.success and updated.output["memory"]["text"] == "Prefers dark mode"
    assert not tool.validate_params({"action": "update", "text": "Missing ID"})
    assert deleted.success


def test_native_tool_discovery_registers_memory_and_browser_controls():
    registry = ToolRegistry()
    tools_dir = Path(__file__).parent.parent / "tools"

    registry.auto_discover(str(tools_dir))

    assert registry.get_tool("manage_memory") is not None
    assert registry.get_tool("browser_control") is not None


def test_browser_control_escalates_only_explicit_or_consequential_actions():
    tool = BrowserControlTool()

    assert tool.permission_level_for({"action": "get_content"}) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "type",
        "selector": "#message",
        "text": "Hello",
        "submit": False,
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "type",
        "selector": "#message",
        "text": "Hello",
        "submit": True,
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "type",
        "selector": "input[name='q']",
        "text": "weather",
        "submit": True,
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "type",
        "selector": "input[type='password']",
        "text": "redacted",
        "submit": False,
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "click",
        "selector": "text=Confirm purchase",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "click_at",
        "x": 40,
        "y": 70,
        "target_description": "Delete account",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "double_click_at",
        "x": 40,
        "y": 70,
        "target_description": "Confirm purchase",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "click_at",
        "x": 40,
        "y": 70,
        "target_description": "Open settings",
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "move_mouse",
        "x": 40,
        "y": 70,
        "target_description": "Delete account",
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "press_key",
        "key": "Enter",
    }) == "EXECUTE"
    assert tool.permission_level_for({"action": "press_key"}) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "press_key",
        "key": "Escape",
        "target_description": "Delete account",
    }) == "EXECUTE"
    assert tool.permission_level_for({
        "action": "press_key",
        "key": "Escape",
        "target_description": "Close menu",
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "press_key",
        "key": "Enter",
        "target_description": "Google search box",
    }) == "LOW_RISK"
    assert tool.permission_level_for({
        "action": "press_key",
        "key": "Enter",
        "target_description": "Password field",
    }) == "EXECUTE"


def test_planned_browser_submission_uses_contextual_confirmation():
    tool = BrowserControlTool()
    tool.execute = AsyncMock(return_value=SimpleNamespace(
        success=True,
        output={"submitted": True},
        error=None,
    ))
    event_bus = SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: tool),
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
        permission_manager=PermissionManager(),
    )
    loop._request_tool_confirmation = AsyncMock(return_value=False)

    outcome = asyncio.run(loop.execute_planned_tool(
        "browser_control",
        {
            "action": "type",
            "selector": "#message",
            "text": "Send this",
            "submit": True,
        },
        task_id="browser-confirmation",
    ))

    assert not outcome.success
    assert "confirmation was rejected" in outcome.output
    loop._request_tool_confirmation.assert_awaited_once()
    assert loop._request_tool_confirmation.await_args.args[1]["submit"] is True
    tool.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_planned_routine_browser_navigation_skips_always_ask_prompt():
    tool = BrowserControlTool()
    tool.execute = AsyncMock(return_value=SimpleNamespace(
        success=True,
        output={"url": "https://example.org"},
        error=None,
    ))
    event_bus = SimpleNamespace(publish=AsyncMock())
    permission_manager = PermissionManager()
    permission_manager.configure(mode="ALWAYS_ASK")
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: tool),
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
        permission_manager=permission_manager,
    )
    loop._request_tool_confirmation = AsyncMock(return_value=False)
    loop.tool_verification_enabled = False

    outcome = await loop.execute_planned_tool(
        "browser_control",
        {"action": "navigate", "url": "https://example.org"},
        task_id="browser-routine-navigation",
    )

    assert outcome.success
    loop._request_tool_confirmation.assert_not_awaited()
    tool.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_browser_tool_summary_and_log_expose_sanitized_error(caplog):
    tool = BrowserControlTool()
    tool.execute = AsyncMock(return_value=SimpleNamespace(
        success=False,
        output=None,
        error=(
            "Search selector timed out at https://example.org/search?q=private "
            "api_key=sk-private-value"
        ),
    ))
    event_bus = SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: tool),
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
    )

    caplog.set_level(logging.ERROR, logger="services.agent.core.react_loop")
    outcome = await loop.execute_planned_tool(
        "browser_control",
        {
            "action": "click",
            "selector": "input[name=q]",
            "url": "https://example.org/search?q=private",
            "text": "private search",
        },
        task_id="browser-failure-summary",
    )

    assert not outcome.success
    tool_events = [
        call.args[1]
        for call in event_bus.publish.call_args_list
        if call.args[0] == "TOOL_EXECUTED"
    ]
    assert len(tool_events) == 1
    assert "Search selector timed out" in tool_events[0]["result_summary"]
    assert "sk-private-value" not in tool_events[0]["result_summary"]
    assert "task_id=browser-failure-summary" in caplog.text
    assert "action" in caplog.text and "input[name=q]" in caplog.text
    assert "Search selector timed out" in caplog.text
    assert "?q=private" not in caplog.text
    assert "private search" not in caplog.text
    assert "sk-private-value" not in caplog.text


def test_planned_visual_deletion_uses_contextual_confirmation():
    tool = BrowserControlTool()
    tool.execute = AsyncMock(return_value=SimpleNamespace(
        success=True,
        output={"clicked": True},
        error=None,
    ))
    event_bus = SimpleNamespace(publish=AsyncMock())
    loop = ReActLoop(
        provider_registry=None,
        model_router=None,
        fallback_manager=None,
        tool_registry=SimpleNamespace(get_tool=lambda _name: tool),
        key_manager=None,
        event_bus=event_bus,
        role_config=None,
        permission_manager=PermissionManager(),
    )
    loop._request_tool_confirmation = AsyncMock(return_value=False)

    outcome = asyncio.run(loop.execute_planned_tool(
        "browser_control",
        {
            "action": "click_at",
            "x": 40,
            "y": 70,
            "target_description": "Delete workspace",
        },
        task_id="browser-visual-confirmation",
    ))

    assert not outcome.success
    assert "confirmation was rejected" in outcome.output
    loop._request_tool_confirmation.assert_awaited_once()
    assert (
        loop._request_tool_confirmation.await_args.args[1]["target_description"]
        == "Delete workspace"
    )
    tool.execute.assert_not_awaited()


class FakeBrowserSession:
    def __init__(self):
        self.visited = None
        self.visible_text = "page text"
        self.typed = None
        self.pressed = []
        self.mouse_actions = []

    async def navigate(self, url):
        self.visited = url

    async def get_current_url(self):
        return self.visited

    async def get_visible_text(self):
        return "page text"

    async def observe(self):
        return BrowserObservation(
            url=self.visited or "about:blank",
            title="Fake page",
            visible_text=self.visible_text,
            interactive_controls="",
        )

    async def type_text(self, selector, text):
        self.typed = (selector, text)
        return "text"

    async def press_key(self, key):
        self.pressed.append(key)

    async def screenshot(self):
        return b"image-bytes"

    async def move_mouse(self, x, y):
        self.mouse_actions.append(("move", x, y))

    async def click_at(self, x, y, button):
        self.mouse_actions.append(("click", x, y, button))

    async def double_click_at(self, x, y):
        self.mouse_actions.append(("double_click", x, y))

    async def drag(self, x, y, end_x, end_y):
        self.mouse_actions.append(("drag", x, y, end_x, end_y))

    async def scroll_at(self, x, y, direction, amount):
        self.mouse_actions.append(("scroll", x, y, direction, amount))


@pytest.mark.asyncio
async def test_browser_control_validates_urls_and_does_not_submit_unless_requested(monkeypatch):
    tool = BrowserControlTool()
    session = FakeBrowserSession()
    session.visited = "https://example.org/start"

    async def use_fake_session():
        return session

    monkeypatch.setattr(tool, "_get_or_create_session", use_fake_session)
    assert not tool.validate_params({"action": "navigate", "url": "javascript:alert(1)"})
    assert not tool.validate_params({"action": "navigate", "url": "https://user:pass@example.org"})

    navigation = await tool.execute({"action": "navigate", "url": "example.org"})
    typing = await tool.execute({"action": "type", "selector": "#query", "text": "HELIX"})
    assert typing.success and session.pressed == []
    submitted = await tool.execute({"action": "type", "selector": "#query", "text": "HELIX", "submit": True})
    screenshot = await tool.execute({"action": "screenshot"})
    visual_click = await tool.execute({"action": "click_at", "x": 420, "y": 260})

    assert navigation.success and session.visited == "https://example.org"
    assert navigation.output["state_validation"]["changed"] is True
    assert "url" in navigation.output["state_validation"]["changed_fields"]
    assert submitted.success and session.pressed == ["Enter"]
    assert typing.output["verified"] is True
    assert typing.output["control_type"] == "text"
    assert screenshot.output["screenshot_bytes"] == b"image-bytes"
    assert visual_click.output["screenshot_bytes"] == b"image-bytes"
    assert visual_click.output["state_validation"]["changed"] is False
    assert session.mouse_actions == [("click", 420, 260, "left")]


@pytest.mark.asyncio
@pytest.mark.parametrize("initial_url", ["about:blank", "chrome://newtab/"])
async def test_browser_navigation_does_not_observe_internal_start_page(
    monkeypatch, initial_url
):
    tool = BrowserControlTool()
    session = FakeBrowserSession()
    session.visited = initial_url
    observe_calls = 0
    observe_page = session.observe

    async def observe_web_page_only():
        nonlocal observe_calls
        observe_calls += 1
        if not (session.visited or "").startswith(("http://", "https://")):
            raise RuntimeError("Internal browser pages cannot be inspected.")
        return await observe_page()

    session.observe = observe_web_page_only

    async def use_fake_session():
        return session

    monkeypatch.setattr(tool, "_get_or_create_session", use_fake_session)

    result = await tool.execute({"action": "navigate", "url": "example.org"})

    assert result.success
    assert session.visited == "https://example.org"
    assert observe_calls == 1
    assert result.output["page"].startswith("URL: https://example.org")
    assert "state_validation" not in result.output


@pytest.mark.asyncio
async def test_browser_control_reports_failed_action_without_automatic_retry(monkeypatch):
    tool = BrowserControlTool()
    session = FakeBrowserSession()
    session.visited = "https://example.org/form"
    click_attempts = []

    async def fail_click(selector):
        click_attempts.append(selector)
        raise TimeoutError("click timed out")

    session.click = fail_click

    async def use_fake_session():
        return session

    monkeypatch.setattr(tool, "_get_or_create_session", use_fake_session)

    result = await tool.execute({"action": "click", "selector": "#submit"})

    assert result.success is False
    assert result.output is None
    assert len(click_attempts) == 1
    assert "timeout" in result.error
    assert "No automatic retry was attempted" in result.error
    assert "verify the current browser state before retrying" in result.error
    assert "https://example.org/form" in result.error


def test_browser_state_validator_reports_changed_observation_fields_without_failing():
    before = BrowserObservation(
        url="https://example.org/start",
        title="Start",
        visible_text="Before",
        interactive_controls="button Continue",
    )
    after = BrowserObservation(
        url="https://example.org/next",
        title="Next",
        visible_text="After",
        interactive_controls="button Done",
    )

    result = BrowserStateValidator.compare(before, after)

    assert result == {
        "changed": True,
        "changed_fields": ["url", "title", "visible_text", "interactive_controls"],
        "before": {"url": "https://example.org/start", "title": "Start"},
        "after": {"url": "https://example.org/next", "title": "Next"},
    }


def test_browser_state_validator_reports_unchanged_observation_informationally():
    observation = BrowserObservation(
        url="https://example.org/",
        title="Example",
        visible_text="Content",
        interactive_controls="",
    )

    result = BrowserStateValidator.compare(observation, observation)

    assert result["changed"] is False
    assert result["changed_fields"] == []


@pytest.mark.asyncio
async def test_browser_control_always_uses_playwright_for_legacy_extension_setting(monkeypatch):
    tool = BrowserControlTool()
    session = FakeBrowserSession()
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")

    async def use_fake_session():
        return session

    monkeypatch.setattr(tool, "_get_or_create_session", use_fake_session)
    tool.configure({"browser_control_mode": "extension"})
    result = await tool.execute({"action": "navigate", "url": "example.org"})

    assert result.success
    assert session.visited == "https://example.org"
    assert "HELIX_BROWSER_EXTENSION_TOKEN" not in os.environ
    assert os.environ["HELIX_BROWSER_CONTROL_MODE"] == "playwright"


@pytest.mark.asyncio
async def test_browser_control_restarts_a_disconnected_persistent_session(monkeypatch):
    class Session:
        def __init__(self, running):
            self.running = running
            self.stopped = False
            self.started = False

        def is_running(self):
            return self.running

        def matches_defaults(self):
            return True

        async def stop(self):
            self.stopped = True

        async def start(self):
            self.started = True
            self.running = True

    previous = Session(running=False)
    replacement = Session(running=False)
    monkeypatch.setattr(browser_control_module, "_active_browser_session", previous)

    class BrowserSessionFactory:
        def __new__(cls):
            return replacement

    monkeypatch.setattr(
        "services.agent.browser.browser_session.BrowserSession",
        BrowserSessionFactory,
    )

    session = await BrowserControlTool()._get_or_create_session()

    assert previous.stopped
    assert replacement.started
    assert session is replacement


@pytest.mark.asyncio
@pytest.mark.skip(reason="Browser control now uses Playwright exclusively.")
async def test_browser_control_forwards_form_label_to_companion(monkeypatch):
    tool = BrowserControlTool()
    commands = []
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(browser_control_module, "_active_extension_session_id", "42")

    def fake_request(method, path, payload=None):
        assert method == "GET" and path == "/status"
        return {"connected": True}

    async def fake_command(command):
        commands.append(command)
        if command["action"] == "screenshot":
            encoded = base64.b64encode(b"post-action-frame").decode("ascii")
            return {"data_url": f"data:image/jpeg;base64,{encoded}"}
        if command["action"] == "snapshot":
            return {"title": "Contact", "url": "https://example.org", "text": ""}
        return {"typed": True}

    monkeypatch.setattr(tool, "_extension_request", fake_request)
    monkeypatch.setattr(tool, "_extension_command", fake_command)

    result = await tool.execute({
        "action": "type",
        "selector": "label=Email address",
        "text": "user@example.org",
    })

    assert result.success
    assert result.output["verified"] is True
    assert result.output["screenshot_bytes"] == b"post-action-frame"
    assert {
        "action": "type",
        "session_id": "42",
        "selector": "label=Email address",
        "text": "user@example.org",
        "submit": False,
    } in commands
    assert {"action": "screenshot", "session_id": "42"} in commands


@pytest.mark.asyncio
@pytest.mark.skip(reason="Browser control now uses Playwright exclusively.")
async def test_companion_coordinate_action_returns_post_action_screenshot(monkeypatch):
    tool = BrowserControlTool()
    commands = []
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(browser_control_module, "_active_extension_session_id", "42")

    def fake_request(method, path, payload=None):
        if method == "GET" and path == "/status":
            return {"connected": True}
        raise AssertionError("Unexpected synchronous bridge request.")

    async def fake_command(command):
        commands.append(command)
        if command["action"] == "snapshot":
            return {
                "title": "Canvas",
                "url": "https://example.org/canvas",
                "text": "Interactive canvas",
            }
        if command["action"] == "screenshot":
            encoded = base64.b64encode(b"coordinate-action-frame").decode("ascii")
            return {"data_url": f"data:image/jpeg;base64,{encoded}"}
        return {"ok": True}

    monkeypatch.setattr(tool, "_extension_request", fake_request)
    monkeypatch.setattr(tool, "_extension_command", fake_command)

    result = await tool.execute({"action": "click_at", "x": 34, "y": 56})

    assert result.success
    assert result.output["screenshot_bytes"] == b"coordinate-action-frame"
    assert result.output["mime_type"] == "image/jpeg"
    assert {
        "action": "click_at",
        "session_id": "42",
        "x": 34,
        "y": 56,
        "button": "left",
    } in commands
    assert {"action": "screenshot", "session_id": "42"} in commands


@pytest.mark.asyncio
@pytest.mark.skip(reason="Browser control now uses Playwright exclusively.")
async def test_browser_control_rejects_stale_numeric_control_indices(monkeypatch):
    tool = BrowserControlTool()
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(browser_control_module, "_active_extension_session_id", "42")
    monkeypatch.setattr(
        browser_control_module,
        "_active_extension_session_url",
        "https://example.org/inbox",
    )
    monkeypatch.setattr(tool, "_extension_request", lambda *_args, **_kwargs: {"connected": True})

    result = await tool.execute({
        "action": "click",
        "selector": "2",
    })

    assert not result.success
    assert "stale" in result.error.lower()


@pytest.mark.asyncio
@pytest.mark.skip(reason="Browser control now uses Playwright exclusively.")
async def test_browser_control_fails_clearly_when_extension_is_not_connected(monkeypatch):
    tool = BrowserControlTool()
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(tool, "_extension_request", lambda *_args, **_kwargs: {"connected": False})
    monkeypatch.setattr(tool, "_get_or_create_session", lambda: pytest.fail("Playwright fallback was used"))

    result = await tool.execute({"action": "navigate", "url": "example.org"})

    assert not result.success
    assert "extension is not connected" in result.error


@pytest.mark.asyncio
@pytest.mark.skip(reason="Browser control now uses Playwright exclusively.")
async def test_browser_control_recovers_when_browser_restart_clears_managed_tab(monkeypatch):
    tool = BrowserControlTool()
    requests = []
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(browser_control_module, "_active_extension_session_id", "7")
    monkeypatch.setattr(
        browser_control_module,
        "_active_extension_session_url",
        "https://example.org/inbox",
    )

    def fake_request(method, path, payload=None):
        requests.append((method, path, payload))
        if method == "GET":
            return {"connected": True}
        if payload["action"] == "click" and payload["session_id"] == "7":
            return {
                "ok": False,
                "error": (
                    "Browser companion request failed: "
                    "Could not process browser page snapshot: "
                    "This tab is not managed by HELIX."
                ),
            }
        if payload["action"] == "open_session":
            return {
                "ok": True,
                "result": {"session_id": "9", "url": "https://example.org/inbox"},
            }
        if payload["action"] == "snapshot":
            return {
                "ok": True,
                "result": {
                    "title": "Inbox",
                    "url": "https://example.org/inbox",
                    "text": "Mail",
                },
            }
        return {"ok": True, "result": {"clicked": True}}

    monkeypatch.setattr(tool, "_extension_request", fake_request)
    result = await tool.execute({
        "action": "click",
        "selector": '[data-helix-control="helix-2"]',
    })

    assert not result.success
    assert result.output is None
    assert "not retried" in result.error
    assert "verify the page before issuing a new action" in result.error
    assert "https://example.org/inbox" in result.error
    assert ("POST", "/control", {
        "action": "open_session",
        "url": "https://example.org/inbox",
    }) in requests
    assert not any(
        method == "POST"
        and payload.get("action") == "click"
        and payload.get("session_id") == "9"
        for method, _path, payload in requests
    )
    assert browser_control_module._active_extension_session_id == "9"


def test_browser_control_validates_virtual_mouse_coordinates():
    tool = BrowserControlTool()

    assert tool.validate_params({"action": "move_mouse", "x": 10, "y": 20})
    assert tool.validate_params({
        "action": "drag", "x": 10, "y": 20, "end_x": 80, "end_y": 90,
    })
    assert not tool.validate_params({"action": "click_at", "x": -1, "y": 20})
    assert not tool.validate_params({"action": "click_at", "x": True, "y": 20})
    assert not tool.validate_params({"action": "scroll_at", "x": 10, "y": 20, "amount": 4000})
    assert not tool.validate_params({
        "action": "click_at",
        "x": 10,
        "y": 20,
        "target_description": "x" * 301,
    })


class FakePageMouse:
    def __init__(self):
        self.actions = []

    async def move(self, x, y, **kwargs):
        self.actions.append(("move", x, y, kwargs))

    async def click(self, x, y, **kwargs):
        self.actions.append(("click", x, y, kwargs))

    async def dblclick(self, x, y):
        self.actions.append(("double_click", x, y))

    async def down(self):
        self.actions.append(("down",))

    async def up(self):
        self.actions.append(("up",))

    async def wheel(self, delta_x, delta_y):
        self.actions.append(("wheel", delta_x, delta_y))


class FakePage:
    viewport_size = {"width": 800, "height": 600}

    def __init__(self):
        self.mouse = FakePageMouse()
        self.evaluations = []
        self.goto_calls = []
        self.locator_calls = []
        self.text_calls = []
        self.label_calls = []
        self.locator_actions = []
        self.goto_error = None
        self.field_tag = "input"
        self.field_value = ""
        self.field_selected_index = -1
        self.selected_index_override = None
        self.field_options = []
        self.field_multiple = False

    async def evaluate(self, script, argument=None):
        self.evaluations.append((script, argument))

    async def goto(self, url, *, wait_until, timeout):
        self.goto_calls.append((url, wait_until, timeout))
        if self.goto_error:
            raise self.goto_error

    def locator(self, selector):
        self.locator_calls.append(selector)
        return FakeLocator(self)

    def get_by_text(self, text, *, exact=False):
        self.text_calls.append((text, exact))
        return FakeLocator(self)

    def get_by_label(self, label):
        self.label_calls.append(label)
        return FakeLocator(self)


class FakeLocator:
    def __init__(self, page):
        self.first = self
        self.page = page
        self.actions = page.locator_actions

    async def wait_for(self, *, state):
        assert state == "visible"

    async def bounding_box(self):
        return {"x": 100, "y": 50, "width": 40, "height": 20}

    async def click(self):
        self.actions.append(("click",))

    async def evaluate(self, script, argument=None):
        if "tagName.toLowerCase()" in script:
            return self.page.field_tag
        if "element.options" in script:
            matches = [
                (index, option)
                for index, option in enumerate(self.page.field_options)
                if argument in {option["value"], option["label"], option["text"]}
            ]
            return {
                "multiple": self.page.field_multiple,
                "match_count": len(matches),
                "index": matches[0][0] if matches else None,
                "value": matches[0][1]["value"] if matches else None,
            }
        if "selectedIndex" in script:
            return self.page.field_selected_index
        return self.page.field_value

    async def fill(self, text):
        self.actions.append(("fill", text))
        self.page.field_value = text

    async def select_option(self, *, index):
        if not isinstance(index, int) or isinstance(index, bool):
            raise TypeError("The option index must be an integer.")
        selected_index = index
        self.actions.append(("select_option", selected_index))
        actual_index = (
            self.page.selected_index_override
            if self.page.selected_index_override is not None
            else selected_index
        )
        self.page.field_selected_index = actual_index
        self.page.field_value = self.page.field_options[actual_index]["value"]

    async def input_value(self):
        return self.page.field_value


@pytest.mark.asyncio
async def test_browser_session_navigation_honors_wait_state_without_retrying():
    session = BrowserSession(headless=True)
    session.block_untrusted_domains = False
    page = FakePage()
    session._page = page

    await session.navigate("https://example.org")
    assert page.goto_calls == [("https://example.org", "domcontentloaded", 15000)]

    page.goto_error = RuntimeError("navigation failed")
    with pytest.raises(RuntimeError, match="navigation failed"):
        await session.navigate("https://example.org/next", wait_until="load")
    assert page.goto_calls[-1] == ("https://example.org/next", "load", 15000)
    assert len(page.goto_calls) == 2


@pytest.mark.asyncio
async def test_browser_session_supports_semantic_text_and_form_selectors():
    session = BrowserSession(headless=True)
    page = FakePage()
    session._page = page

    await session.click("text=Search")
    await session.type_text("label=Email address", "user@example.org")

    assert page.text_calls == [("Search", True)]
    assert page.label_calls == ["Email address"]
    assert page.locator_actions == [("click",), ("click",), ("fill", "user@example.org")]
    assert page.field_value == "user@example.org"


@pytest.mark.asyncio
async def test_browser_session_type_text_preserves_complex_css_selectors():
    session = BrowserSession(headless=True)
    page = FakePage()
    session._page = page

    await session.type_text('div[role="textbox"]', "message")

    assert page.locator_calls == ['div[role="textbox"]']
    assert page.locator_actions == [("click",), ("fill", "message")]
    assert page.field_value == "message"


@pytest.mark.asyncio
async def test_browser_session_selects_and_verifies_dropdown_options():
    session = BrowserSession(headless=True)
    page = FakePage()
    page.field_tag = "select"
    page.field_options = [
        {"value": "ca", "label": "Canada", "text": "Canada"},
        {"value": "us", "label": "United States", "text": "United States"},
    ]
    session._page = page

    control_type = await session.type_text("label=Country", "Canada")

    assert control_type == "select"
    assert page.locator_actions == [("click",), ("select_option", 0)]
    assert page.field_value == "ca"
    assert page.field_selected_index == 0


@pytest.mark.asyncio
async def test_browser_session_selects_exact_option_when_values_are_duplicated():
    session = BrowserSession(headless=True)
    page = FakePage()
    page.field_tag = "select"
    page.field_options = [
        {"value": "same", "label": "First", "text": "First"},
        {"value": "same", "label": "Second", "text": "Second"},
    ]
    session._page = page

    await session.type_text("label=Choice", "Second")

    assert page.locator_actions == [("click",), ("select_option", 1)]
    assert page.field_value == "same"
    assert page.field_selected_index == 1

    page.selected_index_override = 0
    with pytest.raises(RuntimeError, match="did not retain the requested option"):
        await session.type_text("label=Choice", "Second")


@pytest.mark.asyncio
async def test_browser_session_rejects_missing_or_ambiguous_dropdown_options():
    session = BrowserSession(headless=True)
    page = FakePage()
    page.field_tag = "select"
    session._page = page

    with pytest.raises(ValueError, match="exactly one enabled option"):
        await session.type_text("label=Country", "Unknown")

    page.field_options = [
        {"value": "ca", "label": "Canada", "text": "Canada"},
        {"value": "can", "label": "Canada", "text": "Canada"},
    ]

    with pytest.raises(ValueError, match="exactly one enabled option"):
        await session.type_text("label=Country", "Canada")
    assert page.field_value == ""

    page.field_options = [
        {"value": "ca", "label": "Canada", "text": "Canada"},
    ]
    page.field_multiple = True
    with pytest.raises(ValueError, match="Multi-select dropdowns"):
        await session.type_text("label=Country", "Canada")


@pytest.mark.asyncio
async def test_browser_session_routes_virtual_mouse_with_viewport_bounds():
    session = BrowserSession(headless=True)
    session._page = FakePage()

    await session.move_mouse(120, 80)
    await session.click_at(120, 80)
    await session.drag(120, 80, 200, 180)
    await session.scroll_at(200, 180, "down", 350)

    assert ("move", 120, 80, {"steps": 8}) in session._page.mouse.actions
    assert ("click", 120, 80, {"button": "left"}) in session._page.mouse.actions
    assert ("wheel", 0, 350) in session._page.mouse.actions
    assert session._page.evaluations[0][1] == {"x": 120, "y": 80, "clicked": False}
    assert "opacity:1; transform:translate3d(16px,16px,0)" in BrowserSession._VIRTUAL_CURSOR_SCRIPT
    assert "addEventListener('mousemove'" not in BrowserSession._VIRTUAL_CURSOR_SCRIPT
    with pytest.raises(ValueError, match="outside the page viewport"):
        await session.move_mouse(800, 600)
