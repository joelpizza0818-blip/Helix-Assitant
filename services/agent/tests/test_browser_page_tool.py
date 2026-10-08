from datetime import datetime, timezone

import pytest

from services.agent.core.browser_page_context import clear_current_page, update_current_page
from services.agent.tools.browser_page_tool import BrowserPageTool


@pytest.mark.asyncio
async def test_browser_page_tool_returns_the_active_page():
    page = {
        "title": "Inbox",
        "url": "https://mail.example.com",
        "text": "Visible page content",
        "links": [{"text": "Open message", "url": "https://mail.example.com/1"}],
        "forms": [{"label": "Search mail", "type": "search"}],
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
    update_current_page(page)

    result = await BrowserPageTool().execute({})

    assert result.success is True
    assert result.output["visible_text"] == page["text"]
    assert result.output["links"] == page["links"]
    assert "untrusted input" in result.output["trust_notice"]
    clear_current_page()


@pytest.mark.asyncio
async def test_browser_page_tool_reports_missing_snapshot():
    clear_current_page()

    result = await BrowserPageTool().execute({})

    assert result.success is False
    assert "No recent browser page" in result.error
