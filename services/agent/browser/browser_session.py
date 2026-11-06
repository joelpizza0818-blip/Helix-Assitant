import logging
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from .input_controller import BrowserInputController
from .observer import BrowserObserver

logger = logging.getLogger(__name__)

class BrowserSession:
    _VIRTUAL_CURSOR_SCRIPT = """
(() => {
    const install = () => {
        if (document.getElementById('helix-virtual-cursor')) return;
        const host = document.createElement('div');
        host.id = 'helix-virtual-cursor';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .frame { position:fixed; inset:0; border:3px solid #ee6018;
                    box-shadow:inset 0 0 14px rgba(238,96,24,.85), 0 0 12px rgba(238,96,24,.75);
                    pointer-events:none; }
                .cursor { position:fixed; left:0; top:0; width:28px; height:36px;
                    opacity:0; transform:translate3d(-100px,-100px,0);
                    transition:transform 20ms linear; will-change:transform; }
                .cursor svg { width:100%; height:100%; overflow:visible;
                    filter:drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
                .pulse { position:fixed; width:28px; height:28px; margin:-14px 0 0 -14px;
                    border:2px solid #ee6018; border-radius:50%; opacity:0;
                    transform:scale(.35); }
                .pulse.active { animation:helix-click 420ms ease-out; }
                @keyframes helix-click {
                    0% { opacity:.9; transform:scale(.35); }
                    100% { opacity:0; transform:scale(1.7); }
                }
            </style>
            <div class="frame"></div>
            <div class="cursor"><svg viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2v25l6.4-6.1 4.1 9.2 4.1-1.8-4.1-9.1H23L3 2Z"
                    fill="#ee6018" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            </svg></div>
            <div class="pulse"></div>`;
        (document.documentElement || document).appendChild(host);
        const cursor = shadow.querySelector('.cursor');
        const pulse = shadow.querySelector('.pulse');
        window.__helixMoveCursor = (x, y) => {
            cursor.style.opacity = '1';
            cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
        };
        window.__helixClickCursor = (x, y) => {
            pulse.style.left = `${x}px`;
            pulse.style.top = `${y}px`;
            pulse.classList.remove('active');
            void pulse.offsetWidth;
            pulse.classList.add('active');
        };
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
"""

    default_headless = False
    default_browser_type = 'chromium'
    default_browser_channel = 'chrome'
    default_search_provider = 'google'
    default_research_depth = 2
    default_block_downloads = True
    default_block_untrusted_domains = True
    default_trusted_domains = []

    @classmethod
    def configure_defaults(cls, settings: dict) -> None:
        cls.default_browser_type = 'chromium'
        browser_channel = settings.get('browser_channel', cls.default_browser_channel)
        if browser_channel in {'bundled', 'chrome', 'msedge'}:
            cls.default_browser_channel = browser_channel
        cls.default_headless = False
        if settings.get('search_provider') in {'google', 'duckduckgo', 'bing'}:
            cls.default_search_provider = settings['search_provider']
        if isinstance(settings.get('research_depth'), int) and settings['research_depth'] >= 1:
            cls.default_research_depth = min(settings['research_depth'], 10)
        for setting_name, attribute in (
            ('block_downloads', 'default_block_downloads'),
            ('block_untrusted_domains', 'default_block_untrusted_domains'),
        ):
            if isinstance(settings.get(setting_name), bool):
                setattr(cls, attribute, settings[setting_name])
        trusted = settings.get('trusted_domains', [])
        if isinstance(trusted, list):
            cls.default_trusted_domains = [str(domain).casefold() for domain in trusted if str(domain).strip()]

    def __init__(self, headless: bool | None = None, browser_type: str | None = None):
        self.headless = self.default_headless if headless is None else headless
        self.browser_type = browser_type or self.default_browser_type
        self.browser_channel = self.default_browser_channel
        self.search_provider = self.default_search_provider
        self.research_depth = self.default_research_depth
        self.block_downloads = self.default_block_downloads
        self.block_untrusted_domains = self.default_block_untrusted_domains
        self.trusted_domains = list(self.default_trusted_domains)
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._input_controller = None

    def _input_controller_for_page(self) -> BrowserInputController:
        if not self._page:
            raise RuntimeError("Browser not started")
        if (
            self._input_controller is None
            or not self._input_controller.uses_page(self._page)
        ):
            self._input_controller = BrowserInputController(self._page)
        return self._input_controller

    async def start(self):
        if self.is_running():
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()
        
        browser_class = getattr(self._playwright, self.browser_type)
        profile_path = (
            Path.home()
            / ".helix"
            / "browser-profile"
            / self.browser_type
            / self.browser_channel
        )
        profile_path.mkdir(parents=True, exist_ok=True)
        launch_options: dict[str, Any] = {
            "user_data_dir": str(profile_path),
            "headless": self.headless,
            "accept_downloads": not self.block_downloads,
        }
        if self.browser_channel != 'bundled':
            launch_options["channel"] = self.browser_channel
        try:
            self._context = await browser_class.launch_persistent_context(
                **launch_options,
            )
        except Exception as error:
            await self._playwright.stop()
            self._playwright = None
            browser_name = {
                "chrome": "Google Chrome",
                "msedge": "Microsoft Edge",
                "bundled": "Playwright Chromium",
            }[self.browser_channel]
            install_help = (
                "Install it from Toolbox or run `playwright install chromium`."
                if self.browser_channel == "bundled"
                else "Check that the selected browser is installed or choose another browser in Toolbox."
            )
            raise RuntimeError(
                f"Could not launch {browser_name} with HELIX's isolated browser profile. "
                f"{install_help}"
            ) from error
        self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()
        await self._install_virtual_cursor()
        logger.info(
            "BrowserSession started: %s (%s, headless=%s)",
            self.browser_type,
            self.browser_channel,
            self.headless,
        )

    async def _install_virtual_cursor(self):
        if not self._context or not self._page:
            raise RuntimeError("Browser not started")
        await self._context.add_init_script(self._VIRTUAL_CURSOR_SCRIPT)
        await self._page.evaluate(self._VIRTUAL_CURSOR_SCRIPT)

    async def stop(self):
        context = self._context
        playwright = self._playwright
        try:
            if context:
                try:
                    await context.close()
                except Exception:
                    logger.warning(
                        "Could not close the browser context cleanly.",
                        exc_info=True,
                    )
        finally:
            self._page = None
            self._input_controller = None
            self._context = None
            self._browser = None
            self._playwright = None
            if playwright:
                await playwright.stop()
        logger.info("BrowserSession stopped.")

    def is_running(self) -> bool:
        if self._context is None or self._page is None:
            return False
        if self._page.is_closed():
            return False
        browser = self._context.browser
        if browser is not None and not browser.is_connected():
            return False
        return True

    def matches_defaults(self) -> bool:
        return (
            self.browser_type == self.default_browser_type
            and self.browser_channel == self.default_browser_channel
            and self.headless == self.default_headless
        )

    async def navigate(self, url: str, wait_until: str = "domcontentloaded"):
        if not self._page:
            raise RuntimeError("Browser not started")
        if wait_until not in {"commit", "domcontentloaded", "load", "networkidle"}:
            raise ValueError("Unsupported browser navigation wait state.")
        parsed = urlparse(url)
        host = (parsed.hostname or '').casefold()
        if self.block_untrusted_domains:
            trusted = set(self.trusted_domains)
            if parsed.scheme not in {'http', 'https'}:
                raise PermissionError("Blocked non-web URL by browser safety policy")
            if trusted and not any(host == domain or host.endswith('.' + domain) for domain in trusted):
                raise PermissionError(f"Blocked untrusted domain: {host}")
        logger.info(f"Navigating to {url}")
        await self._page.goto(url, wait_until=wait_until, timeout=15000)

    def _locator_for_selector(self, selector: str, *, prefer_css: bool = False):
        return self._input_controller_for_page().locator_for_selector(
            selector, prefer_css=prefer_css
        )

    async def click(self, selector: str):
        await self._input_controller_for_page().click(selector)

    async def _validate_mouse_coordinates(self, x: int, y: int) -> None:
        await self._input_controller_for_page().validate_mouse_coordinates(x, y)

    async def _show_virtual_cursor(self, x: int, y: int, *, clicked: bool = False) -> None:
        await self._input_controller_for_page()._show_virtual_cursor(
            x, y, clicked=clicked
        )

    async def move_mouse(self, x: int, y: int) -> None:
        await self._input_controller_for_page().move_mouse(x, y)

    async def click_at(self, x: int, y: int, button: str = "left") -> None:
        await self._input_controller_for_page().click_at(x, y, button)

    async def double_click_at(self, x: int, y: int) -> None:
        await self._input_controller_for_page().double_click_at(x, y)

    async def drag(self, x: int, y: int, end_x: int, end_y: int) -> None:
        await self._input_controller_for_page().drag(x, y, end_x, end_y)

    async def scroll_at(self, x: int, y: int, direction: str, amount: int) -> None:
        await self._input_controller_for_page().scroll_at(x, y, direction, amount)

    async def click_text(self, text: str):
        await self._input_controller_for_page().click_text(text)

    async def type_text(self, selector: str, text: str) -> str:
        return await self._input_controller_for_page().type_text(selector, text)

    async def get_text(self, selector: str) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.locator(selector).text_content() or ""

    async def get_page_source(self) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.content()

    async def get_visible_text(self, max_chars: int = 12000) -> str:
        observation = await self.observe()
        return observation.to_text(max_chars)

    async def observe(self):
        if not self._page:
            raise RuntimeError("Browser not started")
        return await BrowserObserver(self._page).observe()

    async def screenshot(self) -> bytes:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await BrowserObserver(self._page).screenshot()

    async def screenshot_as_base64(self) -> str:
        """Return a base64-encoded JPEG screenshot, ready to embed or pass to a vision model."""
        import base64
        return base64.b64encode(await self.screenshot()).decode("ascii")

    async def scroll(self, direction: str, amount: int):
        await self._input_controller_for_page().scroll(direction, amount)

    async def press_key(self, key: str):
        await self._input_controller_for_page().press_key(key)

    async def go_back(self):
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._page.go_back(wait_until="domcontentloaded")

    async def refresh(self):
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._page.reload(wait_until="domcontentloaded")

    async def wait_for_selector(self, selector: str, timeout: float = 10.0):
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._page.wait_for_selector(selector, timeout=timeout * 1000)

    async def execute_js(self, script: str) -> Any:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.evaluate(script)

    async def get_links(self) -> list[str]:
        if not self._page:
            raise RuntimeError("Browser not started")
        links = await self._page.evaluate("Array.from(document.querySelectorAll('a')).map(a => a.href)")
        return [link for link in links if link]

    async def get_current_url(self) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return self._page.url

    async def get_title(self) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.title()

    async def extract_structured_data(self, schema: dict) -> dict:
        # Simplistic mapping based on schema keys as CSS selectors if possible,
        # otherwise delegates to DataExtractor combined with HTML
        result = {}
        for key, selector in schema.items():
            try:
                val = await self.get_text(selector)
                result[key] = val.strip()
            except Exception:
                result[key] = None
        return result

    async def find_element_by_text(self, text: str) -> Any:
        if not self._page:
            raise RuntimeError("Browser not started")
        return self._page.get_by_text(text).first
