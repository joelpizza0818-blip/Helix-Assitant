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

    async def take_action(self, instruction: str, max_steps: int = 8) -> str:
        """High-level browser automation via model reasoning (ReAct loop)."""
        await self._ensure_started()

        for step in range(1, max_steps + 1):
            url = await self._session.get_current_url()
            snapshot = await self._session.get_visible_text(max_chars=6000)

            from services.agent.browser.extraction import DataExtractor
            html = await self._session.get_page_source()
            links = DataExtractor.extract_links(html)
            links_str = "\n".join([f"{l.text}: {l.url}" for l in links[:20]])

            prompt = (
                f"Step {step}/{max_steps}. Instruction: {instruction}\n"
                f"Current URL: {url}\n"
                f"Page snapshot:\n{snapshot}\n\n"
                f"Available Links:\n{links_str}\n\n"
                "What is the NEXT single action to take? Reply with ONLY ONE of:\n"
                "NAVIGATE <url>\n"
                "CLICK <css-selector-or-text>\n"
                "TYPE <css-selector> | <text>\n"
                "SCROLL down\n"
                "DONE <result>\n"
                "If the task is complete or cannot be completed, use DONE."
            )

            response = await self.model_call_fn(prompt=prompt)
            response = response.strip()
            logger.info("take_action step %d response: %s", step, response[:120])

            if response.startswith("NAVIGATE"):
                target = response.split(" ", 1)[1].strip()
                await self._session.navigate(target)
            elif response.startswith("CLICK"):
                target = response.split(" ", 1)[1].strip()
                await self._session.click(target)
            elif response.startswith("TYPE"):
                _, rest = response.split(" ", 1)
                if "|" in rest:
                    selector, text = rest.split("|", 1)
                    await self._session.type_text(selector.strip(), text.strip())
                else:
                    logger.warning("TYPE action missing '|' separator: %s", rest)
            elif response.startswith("SCROLL"):
                await self._session.scroll("down", 500)
            elif response.startswith("DONE"):
                result_text = response.split(" ", 1)[1].strip() if " " in response else ""
                return result_text or f"Task completed after {step} step(s)."
            else:
                logger.warning("take_action: unrecognised response '%s', stopping.", response[:80])
                return f"Could not determine action at step {step}."

        return f"Task did not finish within {max_steps} steps."
