import logging
import asyncio

logger = logging.getLogger(__name__)

class BrowserAgent:
    def __init__(self, event_bus, model_call_fn, key_manager):
        self.event_bus = event_bus
        self.model_call_fn = model_call_fn
        self.key_manager = key_manager
        self._session = None
        self._researcher = None

    async def _ensure_started(self):
        if not self._session:
            from services.agent.browser.browser_session import BrowserSession
            self._session = BrowserSession(
                headless=BrowserSession.default_headless,
                browser_type=BrowserSession.default_browser_type,
            )
            await self._session.start()
            
        if not self._researcher:
            from services.agent.browser.web_research import WebResearcher
            self._researcher = WebResearcher(self._session, self.model_call_fn, self.event_bus)

    async def start(self):
        await self._ensure_started()
        logger.info("BrowserAgent started.")

    async def stop(self):
        if self._session:
            await self._session.stop()
            self._session = None
        logger.info("BrowserAgent stopped.")

    def get_session(self):
        return self._session

    async def navigate_and_extract(self, url: str, goal: str) -> str:
        await self._ensure_started()
        await self._session.navigate(url)
        html = await self._session.get_page_source()
        
        from services.agent.browser.extraction import DataExtractor
        text = DataExtractor.extract_main_content(html)
        
        prompt = f"Goal: {goal}\n\nExtract relevant information to satisfy this goal from the following text:\n{text[:8000]}"
        return await self.model_call_fn(prompt=prompt)

    async def research(self, topic: str) -> str:
        await self._ensure_started()
        result = await self._researcher.research(topic)
        return result.summary

    async def fill_form(self, url: str, fields: dict):
        await self._ensure_started()
        await self._session.navigate(url)
        for selector, value in fields.items():
            await self._session.type_text(selector, str(value))

    async def download_file(self, url: str, save_path: str):
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                with open(save_path, 'wb') as f:
                    while True:
                        chunk = await response.content.read(1024)
                        if not chunk:
                            break
                        f.write(chunk)

    async def take_action(self, instruction: str) -> str:
        """High-level browser automation via model reasoning."""
        await self._ensure_started()
        
        url = await self._session.get_current_url()
        html = await self._session.get_page_source()
        
        from services.agent.browser.extraction import DataExtractor
        links = DataExtractor.extract_links(html)
        links_str = "\n".join([f"{l.text}: {l.url}" for l in links[:20]])
        
        prompt = (
            f"Instruction: {instruction}\n"
            f"Current URL: {url}\n"
            f"Available Links:\n{links_str}\n\n"
            "What action should I take? Respond with ONLY ONE of:\n"
            "NAVIGATE <url>\n"
            "CLICK <text>\n"
            "DONE <result>"
        )
        
        response = await self.model_call_fn(prompt=prompt)
        
        if response.startswith("NAVIGATE"):
            target = response.split(" ", 1)[1].strip()
            await self._session.navigate(target)
            return f"Navigated to {target}"
        elif response.startswith("CLICK"):
            target = response.split(" ", 1)[1].strip()
            await self._session.click_text(target)
            return f"Clicked {target}"
        elif response.startswith("DONE"):
            return response.split(" ", 1)[1].strip()
            
        return "Unknown action."
