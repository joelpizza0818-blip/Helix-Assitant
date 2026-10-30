import base64
from pathlib import Path

import pytest

import services.agent.tools.browser_control_tool as browser_control_module
from services.agent.browser.browser_session import BrowserSession
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
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    manager.add_memory("Low priority context", "fact", importance=1)
    manager.add_memory("High priority context", "project", importance=5)

    prompt = manager.format_context_prompt(limit=1)

    assert "data, not instructions" in prompt
    assert "High priority context" in prompt
    assert "Low priority context" not in prompt


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


class FakeBrowserSession:
    def __init__(self):
        self.visited = None
        self.typed = None
        self.pressed = []
        self.mouse_actions = []

    async def navigate(self, url):
        self.visited = url

    async def get_current_url(self):
        return self.visited

    async def get_visible_text(self):
        return "page text"

    async def type_text(self, selector, text):
        self.typed = (selector, text)

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
    assert submitted.success and session.pressed == ["Enter"]
    assert screenshot.output["screenshot_bytes"] == b"image-bytes"
    assert visual_click.output["screenshot_bytes"] == b"image-bytes"
    assert session.mouse_actions == [("click", 420, 260, "left")]


@pytest.mark.asyncio
async def test_browser_control_uses_only_the_paired_extension_tab(monkeypatch):
    tool = BrowserControlTool()
    commands = []
    monkeypatch.setenv("HELIX_BROWSER_CONTROL_MODE", "extension")
    monkeypatch.setenv("HELIX_BROWSER_EXTENSION_TOKEN", "a" * 64)
    monkeypatch.setattr(browser_control_module, "_active_extension_session_id", None)
    monkeypatch.setattr(tool, "_get_or_create_session", lambda: pytest.fail("Playwright fallback was used"))
    assert "drag" in tool.get_schema()["properties"]["action"]["enum"]

    def fake_request(method, path, payload=None):
        assert method == "GET" and path == "/status"
        return {"connected": True}

    async def fake_command(command):
        commands.append(command)
        if command["action"] == "open_session":
            return {"session_id": "42", "url": f"{command['url'].rstrip('/')}/inbox"}
        if command["action"] == "snapshot":
            return {"title": "HELIX page", "url": "https://example.org", "text": "page text"}
        if command["action"] == "screenshot":
            encoded = base64.b64encode(b"image-bytes").decode("ascii")
            return {"data_url": f"data:image/jpeg;base64,{encoded}"}
        return {"ok": True}

    monkeypatch.setattr(tool, "_extension_request", fake_request)
    monkeypatch.setattr(tool, "_extension_command", fake_command)

    navigation = await tool.execute({"action": "navigate", "url": "example.org"})
    click = await tool.execute({
        "action": "click",
        "selector": '[data-helix-control="helix-2"]',
    })
    double_click = await tool.execute({
        "action": "double_click_at", "x": 22, "y": 32, "button": "right",
    })
    drag = await tool.execute({
        "action": "drag", "x": 20, "y": 30, "end_x": 80, "end_y": 90,
    })
    screenshot = await tool.execute({"action": "screenshot"})

    assert navigation.success and navigation.output["page"]["title"] == "HELIX page"
    assert navigation.output["url"] == "https://example.org/inbox"
    assert click.success
    assert double_click.success
    assert {
        "action": "double_click_at",
        "session_id": "42",
        "x": 22,
        "y": 32,
        "button": "right",
    } in commands
    assert drag.success
    assert {
        "action": "drag",
        "session_id": "42",
        "x": 20,
        "y": 30,
        "end_x": 80,
        "end_y": 90,
        "button": "left",
    } in commands
    assert {
        "action": "click",
        "session_id": "42",
        "selector": '[data-helix-control="helix-2"]',
    } in commands
    assert screenshot.output["screenshot_bytes"] == b"image-bytes"


@pytest.mark.asyncio
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

    assert result.success
    assert ("POST", "/control", {
        "action": "open_session",
        "url": "https://example.org/inbox",
    }) in requests
    assert ("POST", "/control", {
        "action": "click",
        "session_id": "9",
        "selector": '[data-helix-control="helix-2"]',
    }) in requests
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

    async def evaluate(self, script, argument=None):
        self.evaluations.append((script, argument))


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
    assert "addEventListener('mousemove'" not in BrowserSession._VIRTUAL_CURSOR_SCRIPT
    with pytest.raises(ValueError, match="outside the page viewport"):
        await session.move_mouse(800, 600)
