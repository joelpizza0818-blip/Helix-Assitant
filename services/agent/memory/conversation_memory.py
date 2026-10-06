import logging
import sqlite3
import json
from datetime import datetime
from typing import List, Dict

logger = logging.getLogger(__name__)

class ConversationMemory:
    def __init__(self, db_path: str = "conversation.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS messages
                     (id INTEGER PRIMARY KEY, role TEXT, content TEXT, timestamp TEXT, metadata TEXT)''')
        conn.commit()
        conn.close()

    def get_messages(self, limit: int = 20) -> List[Dict]:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("SELECT role, content, timestamp, metadata FROM messages ORDER BY id DESC LIMIT ?", (limit,))
        rows = c.fetchall()
        conn.close()
        messages = []
        for row in reversed(rows):
            messages.append({
                "role": row[0],
                "content": row[1],
                "timestamp": row[2],
                "metadata": json.loads(row[3]) if row[3] else {}
            })
        return messages

    async def add_message(self, role: str, content: str, metadata: dict = None) -> None:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("INSERT INTO messages (role, content, timestamp, metadata) VALUES (?, ?, ?, ?)",
                  (role, content, datetime.now().isoformat(), json.dumps(metadata or {})))
        conn.commit()
        conn.close()
        logger.info(f"Added message for role {role}")

    async def clear(self) -> None:
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("DELETE FROM messages")
        conn.commit()
        conn.close()
        logger.info("Cleared conversation memory")

    def count_tokens(self, text: str) -> int:
        return len(text.split())

    async def summarize_if_needed(self, model_call_fn, max_tokens: int = 4000) -> None:
        messages = self.get_messages(100)
        total_tokens = sum(self.count_tokens(m['content']) for m in messages)
        if total_tokens > max_tokens:
            logger.info("Summarizing conversation history")
            # In a real implementation we would call model_call_fn to summarize
            pass
