import logging
import sqlite3
import json
import math
from typing import List, Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class VectorSearchResult:
    id: str
    text: str
    score: float
    metadata: dict

class VectorMemory:
    def __init__(self, db_path="vectors.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS vectors
                     (id TEXT PRIMARY KEY, text TEXT, embedding TEXT, metadata TEXT)''')
        conn.commit()
        conn.close()

    async def embed(self, text: str) -> List[float]:
        # Dummy embedding for illustration purposes
        logger.info(f"Generating embedding for text: {text[:20]}...")
        return [0.1] * 128

    async def store(self, id: str, text: str, embedding: List[float], metadata: dict) -> None:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO vectors (id, text, embedding, metadata) VALUES (?, ?, ?, ?)",
                  (id, text, json.dumps(embedding), json.dumps(metadata)))
        conn.commit()
        conn.close()
        logger.info(f"Stored vector for {id}")

    def _cosine_similarity(self, v1: List[float], v2: List[float]) -> float:
        dot_product = sum(a * b for a, b in zip(v1, v2))
        norm_v1 = math.sqrt(sum(a * a for a in v1))
        norm_v2 = math.sqrt(sum(b * b for b in v2))
        if norm_v1 == 0 or norm_v2 == 0:
            return 0.0
        return dot_product / (norm_v1 * norm_v2)

    async def search(self, query_embedding: List[float], limit: int, threshold: float = 0.7) -> List[VectorSearchResult]:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("SELECT id, text, embedding, metadata FROM vectors")
        rows = c.fetchall()
        conn.close()
        
        results = []
        for row in rows:
            emb = json.loads(row[2])
            score = self._cosine_similarity(query_embedding, emb)
            if score >= threshold:
                results.append(VectorSearchResult(
                    id=row[0],
                    text=row[1],
                    score=score,
                    metadata=json.loads(row[3])
                ))
        
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:limit]

    async def delete(self, id: str) -> None:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("DELETE FROM vectors WHERE id = ?", (id,))
        conn.commit()
        conn.close()
        logger.info(f"Deleted vector {id}")
