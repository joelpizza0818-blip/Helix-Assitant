from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.agent.browser.browser_session import BrowserSession
from services.agent.browser.observer import BrowserObserver


class FakeLocator:
    def __init__(self, *, visible_text="", controls=""):
        self.visible_text = visible_text
        self.controls = controls
        self.control_script = None

    async def inner_text(self):
        return self.visible_text

    async def evaluate_all(self, script):
        self.control_script = script
        return self.controls


class FakePage:
    def __init__(self):
        self.url = "https://example.org/form"
        self.body_locator = FakeLocator(visible_text="Page body")
        self.controls_locator = FakeLocator(
            controls='[0] selector=[data-helix-control="0"] role=checkbox input[type=checkbox] "Accept terms" [checked=true, required] at (20, 30)'
        )
        self.locator_selectors = []
        self.timeout_ms = None
        self.screenshot_options = None
        self.closed = False

    def locator(self, selector):
        self.locator_selectors.append(selector)
        if selector == "body":
            return self.body_locator
        return self.controls_locator

    async def title(self):
        return "Example form"

    async def wait_for_timeout(self, timeout_ms):
        self.timeout_ms = timeout_ms

    async def screenshot(self, **options):
        self.screenshot_options = options
        return b"jpeg-bytes"

    async def evaluate(self, _script):
        return None

    def is_closed(self):
        return self.closed


@pytest.mark.asyncio
async def test_browser_observer_captures_page_text_and_interactive_controls():
    page = FakePage()
    observer = BrowserObserver(page)

    observation = await observer.observe()

    assert observation.url == "https://example.org/form"
    assert observation.title == "Example form"
    assert observation.visible_text == "Page body"
    assert observation.interactive_controls == (
        '[0] selector=[data-helix-control="0"] role=checkbox '
        'input[type=checkbox] "Accept terms" [checked=true, required] at (20, 30)'
    )
    assert "URL: https://example.org/form" in observation.to_text()
    assert "Interactive controls:" in observation.to_text()
    assert page.locator_selectors == [
        "body",
        "a, button, input, textarea, select, "
        "[role='button'], [role='checkbox'], [role='radio'], [role='switch'], "
        "[role='link'], [role='tab'], [role='menuitem'], [role='option'], "
        "[role='slider'], [role='combobox'], [role='listbox'], [role='textbox'], "
        "[tabindex='0']",
    ]
    script = page.controls_locator.control_script
    assert 'data-helix-control' in script
    assert "element.labels" in script
    assert "aria-labelledby" in script
    assert "aria-label" in script
    assert "role=${role}" in script
    assert "element.matches(':disabled')" in script
    assert "const nativeCheckable = tag === 'input'" in script
    assert "['checkbox', 'radio'].includes(element.type)" in script
    assert "checked=${element.checked}" in script
    assert "aria-expanded" in script
    assert "aria-required" in script
    assert "aria-invalid" in script


@pytest.mark.asyncio
async def test_browser_observer_captures_viewport_screenshot():
    page = FakePage()
    observer = BrowserObserver(page)

    screenshot = await observer.screenshot()

    assert screenshot == b"jpeg-bytes"
    assert page.timeout_ms == 150
    assert page.screenshot_options == {
        "type": "jpeg",
        "quality": 75,
        "full_page": False,
    }


@pytest.mark.asyncio
async def test_browser_session_preserves_observation_and_screenshot_contracts():
    page = FakePage()
    session = BrowserSession(headless=True)
    session._page = page

    visible_text = await session.get_visible_text()
    screenshot = await session.screenshot()

    assert visible_text == (
        'URL: https://example.org/form\nTitle: Example form\n\nPage body'
        '\n\nInteractive controls:\n[0] selector=[data-helix-control="0"] role=checkbox '
        'input[type=checkbox] "Accept terms" [checked=true, required] at (20, 30)'
    )
    assert screenshot == b"jpeg-bytes"


@pytest.mark.asyncio
async def test_browser_session_launches_installed_browser_with_isolated_profile(monkeypatch):
    page = FakePage()
    launch_options = {}

    class FakeContext:
        pages = [page]
        browser = None

        async def add_init_script(self, _script):
            return None

        async def close(self):
            return None

    class FakeChromium:
        async def launch_persistent_context(self, **options):
            launch_options.update(options)
            return FakeContext()

    playwright = SimpleNamespace(
        chromium=FakeChromium(),
        stop=AsyncMock(),
    )
    async_playwright = SimpleNamespace(start=AsyncMock(return_value=playwright))
    monkeypatch.setitem(
        sys.modules,
        "playwright",
        SimpleNamespace(async_api=SimpleNamespace(async_playwright=async_playwright)),
    )
    monkeypatch.setitem(
        sys.modules,
        "playwright.async_api",
        SimpleNamespace(async_playwright=lambda: async_playwright),
    )
    monkeypatch.setattr(BrowserSession, "default_browser_type", "chromium")
    monkeypatch.setattr(BrowserSession, "default_browser_channel", "bundled")
    monkeypatch.setattr(BrowserSession, "default_headless", True)
    BrowserSession.configure_defaults({
        "browser_channel": "msedge",
        "browser_headless": False,
    })
    session = BrowserSession()

    await session.start()

    assert launch_options["channel"] == "msedge"
    assert launch_options["headless"] is False
    assert launch_options["accept_downloads"] is False
    assert str(launch_options["user_data_dir"]).endswith(
        str(Path("chromium") / "msedge")
    )
    assert session.is_running()
    await session.stop()
    playwright.stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_browser_session_explains_how_to_install_playwright_chromium(monkeypatch):
    class FakeChromium:
        async def launch_persistent_context(self, **_options):
            raise RuntimeError("browser executable not found")

    playwright = SimpleNamespace(
        chromium=FakeChromium(),
        stop=AsyncMock(),
    )
    async_playwright = SimpleNamespace(start=AsyncMock(return_value=playwright))
    monkeypatch.setitem(
        sys.modules,
        "playwright",
        SimpleNamespace(async_api=SimpleNamespace(async_playwright=async_playwright)),
    )
    monkeypatch.setitem(
        sys.modules,
        "playwright.async_api",
        SimpleNamespace(async_playwright=lambda: async_playwright),
    )
    monkeypatch.setattr(BrowserSession, "default_browser_channel", "bundled")
    BrowserSession.configure_defaults({"browser_channel": "bundled"})
    session = BrowserSession()

    with pytest.raises(RuntimeError, match=r"playwright install chromium"):
        await session.start()

    playwright.stop.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_bundled_playwright_chromium_starts_in_visible_mode(monkeypatch):
    launch_options = {}
    page = SimpleNamespace(
        evaluate=AsyncMock(),
        is_closed=lambda: False,
    )
    context = SimpleNamespace(
        pages=[page],
        browser=None,
        add_init_script=AsyncMock(),
        close=AsyncMock(),
    )

    class FakeChromium:
        async def launch_persistent_context(self, **options):
            launch_options.update(options)
            return context

    playwright = SimpleNamespace(
        chromium=FakeChromium(),
        stop=AsyncMock(),
    )
    async_playwright = SimpleNamespace(start=AsyncMock(return_value=playwright))
    monkeypatch.setitem(
        sys.modules,
        "playwright",
        SimpleNamespace(async_api=SimpleNamespace(async_playwright=async_playwright)),
    )
    monkeypatch.setitem(
        sys.modules,
        "playwright.async_api",
        SimpleNamespace(async_playwright=lambda: async_playwright),
    )
    monkeypatch.setattr(BrowserSession, "default_browser_channel", "bundled")
    monkeypatch.setattr(BrowserSession, "default_headless", False)
    session = BrowserSession()

    await session.start()

    assert launch_options["headless"] is False
    assert "channel" not in launch_options
    await session.stop()


def test_playwright_managed_channel_uses_visible_default_even_if_legacy_setting_is_headless(monkeypatch):
    monkeypatch.setattr(BrowserSession, "default_browser_channel", "chrome")
    monkeypatch.setattr(BrowserSession, "default_headless", True)

    BrowserSession.configure_defaults({
        "browser_channel": "bundled",
        "browser_headless": True,
    })

    assert BrowserSession().headless is False
