import logging
from dataclasses import dataclass
from typing import List, Dict

logger = logging.getLogger(__name__)

@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str

@dataclass
class ResearchPlan:
    queries: List[str]
    expected_sources: List[str]
    depth: int

@dataclass
class ResearchResult:
    topic: str
    summary: str
    sources: List[str]
    confidence: float
    key_findings: List[str]
    raw_findings: List[Dict]

class WebResearcher:
    def __init__(self, browser_session, model_call_fn, event_bus):
        self.browser = browser_session
        self.model_call_fn = model_call_fn
        self.event_bus = event_bus

    async def research(self, topic: str, depth: int = 3) -> ResearchResult:
        logger.info(f"Starting research on: {topic} with depth {depth}")
        if not self.browser.is_running():
            await self.browser.start()

        plan = await self._plan_research(topic)
        all_findings = []
        sources = set()

        for query in plan.queries[:depth]:
            results = await self._execute_search(query)
            for res in results[:2]: # Check top 2 results per query
                if res.url not in sources:
                    content = await self._extract_from_page(res.url, topic)
                    all_findings.append({
                        "url": res.url,
                        "query": query,
                        "content": content
                    })
                    sources.add(res.url)

        await self._cross_check([f["content"] for f in all_findings], list(sources))
        summary = await self._synthesize(all_findings)
        
        # Simple extraction of key findings from summary
        key_findings = [line.strip('- ') for line in summary.split('\n') if line.strip().startswith('-')]

        return ResearchResult(
            topic=topic,
            summary=summary,
            sources=list(sources),
            confidence=0.85, # mock confidence based on cross-check
            key_findings=key_findings,
            raw_findings=all_findings
        )

    async def _plan_research(self, topic: str) -> ResearchPlan:
        prompt = f"Generate 3 distinct search queries to research the following topic comprehensively: '{topic}'. Return ONLY a comma-separated list of queries."
        response = await self.model_call_fn(prompt=prompt)
        queries = [q.strip() for q in response.split(',')]
        return ResearchPlan(queries=queries, expected_sources=[], depth=3)

    async def _execute_search(self, query: str) -> List[SearchResult]:
        search_url = f"https://html.duckduckgo.com/html/?q={query}"
        await self.browser.navigate(search_url)
        
        html = await self.browser.get_page_source()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        
        results = []
        for a in soup.find_all('a', class_='result__url'):
            url = a.get('href', '')
            if url.startswith('//duckduckgo.com/l/?'):
                import urllib.parse
                parsed = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                url = parsed.get('uddg', [url])[0]
            
            parent = a.find_parent('div', class_='result')
            title = parent.find('h2', class_='result__title').text.strip() if parent and parent.find('h2', class_='result__title') else "No Title"
            snippet = parent.find('a', class_='result__snippet').text.strip() if parent and parent.find('a', class_='result__snippet') else ""
            
            results.append(SearchResult(url=url, title=title, snippet=snippet))
            
        return results

    async def _extract_from_page(self, url: str, info_needed: str) -> str:
        try:
            await self.browser.navigate(url)
            text = await self.browser.get_text('body')
            # Use model to extract relevant part
            prompt = f"Extract the most relevant information about '{info_needed}' from this text. Keep it under 200 words: {text[:4000]}"
            return await self.model_call_fn(prompt=prompt)
        except Exception as e:
            logger.error(f"Error extracting from {url}: {e}")
            return ""

    async def _cross_check(self, claims: List[str], sources: List[str]):
        # Stub for fact checking across sources
        pass

    async def _synthesize(self, findings: List[Dict]) -> str:
        if not findings:
            return "No relevant information found."
            
        combined = "\n".join([f"Source: {f['url']}\nContent: {f['content']}" for f in findings])
        prompt = f"Synthesize these findings into a comprehensive summary with bullet points for key facts:\n{combined}"
        return await self.model_call_fn(prompt=prompt)
