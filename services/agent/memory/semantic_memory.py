import logging
import uuid
import sqlite3
import json
from typing import List, Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class MemoryEntry:
    def __init__(self, id: str, content: str, metadata: dict):
        self.id = id
        self.content = content
        self.metadata = metadata

class SemanticMemory:
    def __init__(self, vector_memory=None, db_path="semantic.db"):
        self.vector_memory = vector_memory
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS semantic_facts
                     (id TEXT PRIMARY KEY, content TEXT, source TEXT, importance REAL, timestamp TEXT)''')
        conn.commit()
        conn.close()

    async def store_fact(self, content: str, source: str = None, importance: float = 0.5) -> str:
        fact_id = str(uuid.uuid4())
        timestamp = datetime.now().isoformat()
        
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("INSERT INTO semantic_facts (id, content, source, importance, timestamp) VALUES (?, ?, ?, ?, ?)",
                  (fact_id, content, source, importance, timestamp))
        conn.commit()
        conn.close()
        
        if self.vector_memory:
            embedding = await self.vector_memory.embed(content)
            await self.vector_memory.store(fact_id, content, embedding, {"source": source, "importance": importance})
            
        logger.info(f"Stored semantic fact {fact_id}")
        return fact_id

    async def retrieve_similar(self, query: str, limit: int = 5) -> List[MemoryEntry]:
        if self.vector_memory:
            embedding = await self.vector_memory.embed(query)
            results = await self.vector_memory.search(embedding, limit)
            return [MemoryEntry(r.id, r.text, r.metadata) for r in results]
            
        # Fallback to keyword search
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("SELECT id, content, source, importance FROM semantic_facts WHERE content LIKE ? LIMIT ?", (f"%{query}%", limit))
        rows = c.fetchall()
        conn.close()
        
        return [MemoryEntry(r[0], r[1], {"source": r[2], "importance": r[3]}) for r in rows]
