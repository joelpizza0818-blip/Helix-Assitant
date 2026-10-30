import logging
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

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
        if self.is_running():
            return
            
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()
        
        browser_class = getattr(self._playwright, self.browser_type)
        profile_path = Path.home() / ".helix" / "browser-profile" / self.browser_type
        profile_path.mkdir(parents=True, exist_ok=True)
        self._context = await browser_class.launch_persistent_context(
            user_data_dir=str(profile_path),
            headless=self.headless,
            accept_downloads=not self.block_downloads,
        )
        self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()
        await self._install_virtual_cursor()
        logger.info(f"BrowserSession started: {self.browser_type} (headless={self.headless})")

    async def _install_virtual_cursor(self):
        if not self._context or not self._page:
            raise RuntimeError("Browser not started")
        await self._context.add_init_script(self._VIRTUAL_CURSOR_SCRIPT)
        await self._page.evaluate(self._VIRTUAL_CURSOR_SCRIPT)

    async def stop(self):
        if self._context:
            await self._context.close()
        if self._playwright:
            await self._playwright.stop()
            
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None
        logger.info("BrowserSession stopped.")

    def is_running(self) -> bool:
        return self._context is not None

    async def navigate(self, url: str, wait_until: str = "domcontentloaded"):
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
        try:
            await self._page.goto(url, wait_until="networkidle", timeout=15000)
        except Exception:
            # networkidle can time out on SPAs with long-polling; domcontentloaded is fine
            await self._page.goto(url, wait_until="domcontentloaded")

    async def click(self, selector: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info("Clicking browser target: %s", selector)
        if selector.isdecimal():
            selector = f'[data-helix-control="{selector}"]'
        if selector.startswith(("#", ".", "[", "//", "button", "a[href", "input")):
            locator = self._page.locator(selector).first
        else:
            locator = self._page.get_by_text(selector, exact=True).first
        try:
            box = await locator.bounding_box()
            if box:
                cx = int(box["x"] + box["width"] / 2)
                cy = int(box["y"] + box["height"] / 2)
                await self._show_virtual_cursor(cx, cy, clicked=True)
        except Exception:
            pass
        await locator.click()

    async def _validate_mouse_coordinates(self, x: int, y: int) -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        viewport = self._page.viewport_size
        if viewport is None:
            viewport = await self._page.evaluate(
                "() => ({ width: window.innerWidth, height: window.innerHeight })"
            )
        if not (0 <= x < viewport["width"] and 0 <= y < viewport["height"]):
            raise ValueError(
                f"Coordinates ({x}, {y}) are outside the page viewport "
                f"({viewport['width']} x {viewport['height']})."
            )

    async def _show_virtual_cursor(self, x: int, y: int, *, clicked: bool = False) -> None:
        if not self._page:
            return
        await self._page.evaluate(
            """({ x, y, clicked }) => {
                window.__helixMoveCursor?.(x, y);
                if (clicked) window.__helixClickCursor?.(x, y);
            }""",
            {"x": x, "y": y, "clicked": clicked},
        )

    async def move_mouse(self, x: int, y: int) -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y)
        await self._page.mouse.move(x, y, steps=8)

    async def click_at(self, x: int, y: int, button: str = "left") -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y, clicked=True)
        await self._page.mouse.click(x, y, button=button)

    async def double_click_at(self, x: int, y: int) -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y, clicked=True)
        await self._page.mouse.dblclick(x, y)

    async def drag(self, x: int, y: int, end_x: int, end_y: int) -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._validate_mouse_coordinates(x, y)
        await self._validate_mouse_coordinates(end_x, end_y)
        await self._show_virtual_cursor(x, y)
        await self._page.mouse.move(x, y, steps=8)
        await self._page.mouse.down()
        try:
            await self._show_virtual_cursor(end_x, end_y)
            await self._page.mouse.move(end_x, end_y, steps=12)
        finally:
            await self._page.mouse.up()

    async def scroll_at(self, x: int, y: int, direction: str, amount: int) -> None:
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y)
        await self._page.mouse.move(x, y, steps=8)
        delta_x = amount if direction == "right" else -amount if direction == "left" else 0
        delta_y = amount if direction == "down" else -amount if direction == "up" else 0
        await self._page.mouse.wheel(delta_x, delta_y)

    async def click_text(self, text: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info(f"Clicking text: {text}")
        await self._page.get_by_text(text).first.click()

    async def type_text(self, selector: str, text: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        logger.info(f"Typing into {selector}")
        if selector.isdecimal():
            selector = f'[data-helix-control="{selector}"]'
        if selector.startswith("label="):
            locator = self._page.get_by_label(selector.split("=", 1)[1]).first
        else:
            locator = self._page.locator(selector).first
        try:
            box = await locator.bounding_box()
            if box:
                cx = int(box["x"] + box["width"] / 2)
                cy = int(box["y"] + box["height"] / 2)
                await self._show_virtual_cursor(cx, cy, clicked=True)
        except Exception:
            pass
        await locator.click()
        await locator.fill(text)

    async def get_text(self, selector: str) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.locator(selector).text_content() or ""

    async def get_page_source(self) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        return await self._page.content()

    async def get_visible_text(self, max_chars: int = 12000) -> str:
        if not self._page:
            raise RuntimeError("Browser not started")
        text = await self._page.locator("body").inner_text()
        controls = await self._page.locator(
            "a, button, input, textarea, select, [role='button'], [tabindex='0']"
        ).evaluate_all(
            """elements => {
                let count = 0;
                const result = [];
                for (const element of elements) {
                    if (count >= 100) break;
                    const rect = element.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) continue;
                    const style = window.getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

                    element.setAttribute('data-helix-control', String(count));
                    const label = (element.getAttribute('aria-label')
                        || element.innerText
                        || element.getAttribute('placeholder')
                        || element.getAttribute('title')
                        || element.getAttribute('value')
                        || '').replace(/\\s+/g, ' ').trim().slice(0, 60);

                    const cx = Math.round(rect.left + rect.width / 2);
                    const cy = Math.round(rect.top + rect.height / 2);
                    const tag = element.tagName.toLowerCase();
                    const typeAttr = element.getAttribute('type') ? `[type=${element.getAttribute('type')}]` : '';

                    result.push(`[${count}] selector=[data-helix-control="${count}"] ${tag}${typeAttr} "${label}" at (${cx}, ${cy})`);
                    count++;
                }
                return result.join('\\n');
            }"""
        )
        snapshot = f"URL: {self._page.url}\nTitle: {await self._page.title()}\n\n{text}"
        if controls:
            snapshot += f"\n\nInteractive controls:\n{controls}"
        return snapshot[:max_chars]

    async def screenshot(self) -> bytes:
        if not self._page:
            raise RuntimeError("Browser not started")
        # Wait a bit longer for animations/lazy content to settle
        await self._page.wait_for_timeout(150)
        return await self._page.screenshot(type="jpeg", quality=75, full_page=False)

    async def screenshot_as_base64(self) -> str:
        """Return a base64-encoded JPEG screenshot, ready to embed or pass to a vision model."""
        import base64
        return base64.b64encode(await self.screenshot()).decode("ascii")

    async def scroll(self, direction: str, amount: int):
        if not self._page:
            raise RuntimeError("Browser not started")
        delta_x = amount if direction == "right" else -amount if direction == "left" else 0
        delta_y = amount if direction == "down" else -amount if direction == "up" else 0
        await self._page.mouse.wheel(delta_x, delta_y)

    async def press_key(self, key: str):
        if not self._page:
            raise RuntimeError("Browser not started")
        await self._page.keyboard.press(key)

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
