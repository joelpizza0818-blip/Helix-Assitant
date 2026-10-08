import logging
import asyncio
from urllib.parse import urlparse
from typing import Any

logger = logging.getLogger(__name__)

class BrowserSession:
    default_headless = True
    default_browser_type = 'chromium'
    default_search_provider = 'google'
    default_research_depth = 2
    default_block_downloads = True
    default_block_untrusted_domains = True
    default_trusted_domains = []

    @classmethod
    def configure_defaults(cls, settings: dict) -> None:
        browser_type = settings.get('browser_engine', cls.default_browser_type)
        if browser_type in {'chromium', 'firefox', 'webkit'}:
            cls.default_browser_type = browser_type
        if isinstance(settings.get('browser_headless'), bool):
            cls.default_headless = settings['browser_headless']
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
        self.search_provider = self.default_search_provider
        self.research_depth = self.default_research_depth
        self.block_downloads = self.default_block_downloads
        self.block_untrusted_domains = self.default_block_untrusted_domains
        self.trusted_domains = list(self.default_trusted_domains)
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    async def start(self):
        if self._browser:
            return
            
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()
        
        browser_class = getattr(self._playwright, self.browser_type)
        self._browser = await browser_class.launch(headless=self.headless)
        self._context = await self._browser.new_context(
            accept_downloads=not self.block_downloads,
        )
        self._page = await self._context.new_page()
        logger.info(f"BrowserSession started: {self.browser_type} (headless={self.headless})")

    async def stop(self):
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
            
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None
        logger.info("BrowserSession stopped.")

    def is_running(self) -> bool:
        return self._browser is not None

    async def navigate(self, url: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        parsed = urlparse(url)
        host = (parsed.hostname or '').casefold()
        if self.block_untrusted_domains:
            trusted = set(self.trusted_domains)
            if parsed.scheme not in {'http', 'https'}:
                raise PermissionError("Blocked non-web URL by browser safety policy")
            if trusted and not any(host == domain or host.endswith('.' + domain) for domain in trusted):
                raise PermissionError(f"Blocked untrusted domain: {host}")
        logger.info(f"Navigating to {url}")
        await self._page.goto(url, wait_until="domcontentloaded")

    async def click(self, selector: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info(f"Clicking selector: {selector}")
        await self._page.click(selector)

    async def click_text(self, text: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info(f"Clicking text: {text}")
        await self._page.get_by_text(text).first.click()

    async def type_text(self, selector: str, text: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info(f"Typing into {selector}")
        await self._page.fill(selector, text)

    async def get_text(self, selector: str) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.locator(selector).text_content() or ""

    async def get_page_source(self) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.content()

    async def screenshot(self) -> bytes:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.screenshot(full_page=True)

    async def scroll(self, direction: str, amount: int):
        if not self._page:
            raise RuntimeError("Browser not started")
        script = ""
        if direction == 'up':
            script = f"window.scrollBy(0, -{amount});"
        elif direction == 'down':
            script = f"window.scrollBy(0, {amount});"
        elif direction == 'left':
            script = f"window.scrollBy(-{amount}, 0);"
        elif direction == 'right':
            script = f"window.scrollBy({amount}, 0);"
        await self._page.evaluate(script)

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
