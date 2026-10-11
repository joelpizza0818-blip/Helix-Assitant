import pytest

pytest.importorskip("bs4")

from services.agent.browser.extraction import DataExtractor


def test_html_extraction_keeps_content_and_links_without_optional_readability():
    html = """
    <html><head><style>.hidden { display: none; }</style></head>
      <body><nav>Navigation</nav><article>
        <h1>Release notes</h1><p>Stable content.</p>
        <a href="/docs">Documentation</a>
      </article><script>secret()</script></body>
    </html>
    """

    text = DataExtractor.extract_text(html)
    links = DataExtractor.extract_links(html, "https://helix.example/app")

    assert "Release notes" in text
    assert "Stable content." in text
    assert "Navigation" not in text
    assert "secret" not in text
    assert links[0].url == "https://helix.example/docs"


def test_main_content_has_a_safe_fallback_for_a_small_document():
    content = DataExtractor.extract_main_content(
        "<html><body><main><p>Primary body</p></main></body></html>"
    )

    assert "Primary body" in content
