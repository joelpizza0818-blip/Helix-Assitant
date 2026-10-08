import pytest

from services.agent.tools import indexed_file_search_tool
from services.agent.tools.indexed_file_search_tool import IndexedFileSearchTool


@pytest.mark.asyncio
async def test_search_returns_bounded_index_results(monkeypatch):
    captured = {}
    expected = [{"name": "notes.txt", "path": "C:\\Users\\sample\\notes.txt"}]

    def fake_run(sql, limit):
        captured["sql"] = sql
        captured["limit"] = limit
        return expected

    monkeypatch.setattr(indexed_file_search_tool, "_is_windows_platform", lambda: True)
    monkeypatch.setattr(indexed_file_search_tool, "_run_windows_search_query", fake_run)

    result = await IndexedFileSearchTool().execute({
        "query": "owner's report",
        "max_results": 250,
    })

    assert result.success is True
    assert result.output == expected
    assert captured["limit"] == 100
    assert "CONTAINS(*, 'owner''s report')" in captured["sql"]


@pytest.mark.asyncio
async def test_search_reports_windows_index_errors(monkeypatch):
    def fake_run(_sql, _limit):
        raise RuntimeError("index unavailable")

    monkeypatch.setattr(indexed_file_search_tool, "_is_windows_platform", lambda: True)
    monkeypatch.setattr(indexed_file_search_tool, "_run_windows_search_query", fake_run)

    result = await IndexedFileSearchTool().execute({"query": "report"})

    assert result.success is False
    assert "index unavailable" in result.error


@pytest.mark.asyncio
async def test_search_rejects_empty_query():
    result = await IndexedFileSearchTool().execute({"query": "  "})

    assert result.success is False
    assert "query" in result.error


@pytest.mark.asyncio
async def test_search_reports_non_windows_platform(monkeypatch):
    monkeypatch.setattr(indexed_file_search_tool, "_is_windows_platform", lambda: False)
    tool = IndexedFileSearchTool()

    result = await tool.execute({"query": "report"})

    assert result.success is False
    assert "only on Windows" in result.error
