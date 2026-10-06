import logging
from bs4 import BeautifulSoup
from dataclasses import dataclass
from typing import List, Dict
import json

logger = logging.getLogger(__name__)

@dataclass
class LinkInfo:
    url: str
    text: str
    rel: str

class DataExtractor:
    @staticmethod
    def extract_text(html: str) -> str:
        soup = BeautifulSoup(html, 'html.parser')
        # Remove scripts, styles, and nav
        for elem in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
            elem.decompose()
        return soup.get_text(separator='\n', strip=True)

    @staticmethod
    async def extract_structured(html: str, schema: dict, model_call_fn) -> dict:
        text = DataExtractor.extract_main_content(html)
        
        schema_json = json.dumps(schema)
        prompt = (
            f"Extract information from the text to match this JSON schema exactly: {schema_json}\n\n"
            f"Text:\n{text[:6000]}\n\n"
            "Respond ONLY with valid JSON."
        )
        
        response = await model_call_fn(prompt=prompt)
        try:
            # Clean markdown block if present
            if response.startswith("```json"):
                response = response[7:-3]
            elif response.startswith("```"):
                response = response[3:-3]
                
            return json.loads(response.strip())
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse structured data: {e}")
            return {}

    @staticmethod
    def extract_links(html: str, base_url: str = None) -> List[LinkInfo]:
        soup = BeautifulSoup(html, 'html.parser')
        links = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            if base_url and not href.startswith('http'):
                import urllib.parse
                href = urllib.parse.urljoin(base_url, href)
                
            links.append(LinkInfo(
                url=href,
                text=a.get_text(strip=True),
                rel=a.get('rel', [''])[0] if a.get('rel') else ''
            ))
        return links

    @staticmethod
    def extract_tables(html: str) -> List[List[List[str]]]:
        soup = BeautifulSoup(html, 'html.parser')
        tables_data = []
        
        for table in soup.find_all('table'):
            t_data = []
            for row in table.find_all('tr'):
                row_data = [cell.get_text(strip=True) for cell in row.find_all(['td', 'th'])]
                if row_data:
                    t_data.append(row_data)
            if t_data:
                tables_data.append(t_data)
                
        return tables_data

    @staticmethod
    def extract_main_content(html: str) -> str:
        try:
            from readability import Document
            doc = Document(html)
            main_html = doc.summary()
            return DataExtractor.extract_text(main_html)
        except ImportError:
            logger.warning("readability-lxml not installed. Falling back to basic text extraction.")
            return DataExtractor.extract_text(html)
