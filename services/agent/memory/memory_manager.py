import logging
import uuid
import asyncio
from enum import Enum, auto
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

class MemoryType(Enum):
    SHORT_TERM = auto()
    CONVERSATION = auto()
    LONG_TERM = auto()
    SEMANTIC = auto()

@dataclass
class MemoryEntry:
    id: str
    content: str
    memory_type: MemoryType
    metadata: dict
    created_at: datetime
    expires_at: Optional[datetime]

class MemoryManager:
    def __init__(self):
        self.memories: Dict[str, MemoryEntry] = {}
        self.context_limit = 20
        self.auto_compaction = True
        self.embedding_model = "text-embedding-3-small"
        self.similarity_threshold = 0.75

    def configure(self, settings: dict) -> None:
        self.context_limit = max(1, min(100, int(settings.get("memory_context_limit", self.context_limit))))
        self.auto_compaction = bool(settings.get("memory_auto_compaction", self.auto_compaction))
        self.embedding_model = str(settings.get("embedding_model", self.embedding_model))
        threshold = settings.get("memory_similarity_threshold", self.similarity_threshold)
        if isinstance(threshold, (int, float)) and not isinstance(threshold, bool):
            self.similarity_threshold = max(0.0, min(1.0, float(threshold)))
        application_memory = settings.get("application_memory")
        if isinstance(application_memory, dict):
            self.memories = {
                key: MemoryEntry(
                    id=key,
                    content=str(value),
                    memory_type=MemoryType.LONG_TERM,
                    metadata={"application": True},
                    created_at=datetime.now(),
                    expires_at=None,
                )
                for key, value in application_memory.items()
                if isinstance(key, str) and value is not None
            }

    async def store(self, content: str, memory_type: MemoryType, metadata: dict = None) -> MemoryEntry:
        entry_id = str(uuid.uuid4())
        entry = MemoryEntry(
            id=entry_id,
            content=content,
            memory_type=memory_type,
            metadata=metadata or {},
            created_at=datetime.now(),
            expires_at=None
        )
        self.memories[entry_id] = entry
        logger.info(f"Stored memory {entry_id} of type {memory_type.name}")
        return entry

    async def retrieve(self, query: str, memory_type: MemoryType, limit: int = 10) -> List[MemoryEntry]:
        results = [m for m in self.memories.values() if m.memory_type == memory_type and query.lower() in m.content.lower()]
        return results[:limit]

    async def retrieve_relevant(self, query: str, limit: int = 10) -> List[MemoryEntry]:
        query_terms = {term for term in query.lower().split() if len(term) > 2}
        scored = []
        for memory in self.memories.values():
            content_terms = set(memory.content.lower().split())
            overlap = len(query_terms & content_terms)
            if overlap:
                scored.append((overlap / max(1, len(query_terms)), memory))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [memory for score, memory in scored if score >= self.similarity_threshold or not query_terms][:limit]

    async def forget(self, memory_id: str) -> None:
        if memory_id in self.memories:
            del self.memories[memory_id]
            logger.info(f"Forgot memory {memory_id}")

    async def get_conversation_context(self, limit: int = 20) -> List[MemoryEntry]:
        conv_memories = [m for m in self.memories.values() if m.memory_type == MemoryType.CONVERSATION]
        conv_memories.sort(key=lambda x: x.created_at)
        return conv_memories[-limit:]
