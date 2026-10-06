import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

class BrowserTool:
    """Browser automation tool backed by Playwright."""
    
    def __init__(self, browser_session: Any):
        """Initialize with a BrowserSession from services/agent/browser/browser_session.py"""
        self.session = browser_session
        
    async def navigate(self, url: str) -> None:
        """Navigates to a URL."""
        logger.info(f"Navigating to {url}")
        await self.session.navigate(url)
        
    async def click(self, selector_or_text: str) -> None:
        """Clicks an element by selector or text."""
        logger.info(f"Clicking: {selector_or_text}")
        await self.session.click(selector_or_text)
        
    async def type_text(self, selector: str, text: str) -> None:
        """Types text into an element."""
        logger.info(f"Typing into {selector}")
        await self.session.type(selector, text)
        
    async def get_text(self, selector: str) -> str:
        """Gets text content of an element."""
        logger.info(f"Getting text for {selector}")
        return await self.session.get_text(selector)
        
    async def get_page_content(self) -> str:
        """Gets the entire page content as text."""
        logger.info("Getting page content")
        return await self.session.get_content()
        
    async def screenshot(self) -> bytes:
        """Takes a screenshot of the current page."""
        logger.info("Taking screenshot")
        return await self.session.screenshot()
        
    async def scroll(self, direction: str, amount: int) -> None:
        """Scrolls the page."""
        logger.info(f"Scrolling {direction} by {amount}")
        await self.session.scroll(direction, amount)
        
    async def wait_for_element(self, selector: str, timeout: int = 10) -> None:
        """Waits for an element to appear."""
        logger.info(f"Waiting for {selector} (timeout: {timeout}s)")
        await self.session.wait_for(selector, timeout=timeout)
        
    async def execute_js(self, script: str) -> Any:
        """Executes JavaScript on the page."""
        logger.info("Executing JS")
        return await self.session.execute_script(script)
        
    async def find_links(self) -> List[str]:
        """Finds all links on the page."""
        logger.info("Finding links")
        return await self.session.execute_script(
            "Array.from(document.querySelectorAll('a')).map(a => a.href)"
        )
        
    async def extract_structured(self, schema: Dict) -> Dict:
        """Extracts structured data based on a schema."""
        logger.info(f"Extracting structured data using schema: {schema}")
        return await self.session.extract(schema)
        
    async def go_back(self) -> None:
        """Navigates back."""
        logger.info("Navigating back")
        await self.session.go_back()
        
    async def go_forward(self) -> None:
        """Navigates forward."""
        logger.info("Navigating forward")
        await self.session.go_forward()
        
    async def close(self) -> None:
        """Closes the browser session."""
        logger.info("Closing browser session")
        await self.session.close()
