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
        results = [m for m in self.memories.values() if query.lower() in m.content.lower()]
        return results[:limit]

    async def forget(self, memory_id: str) -> None:
        if memory_id in self.memories:
            del self.memories[memory_id]
            logger.info(f"Forgot memory {memory_id}")

    async def get_conversation_context(self, limit: int = 20) -> List[MemoryEntry]:
        conv_memories = [m for m in self.memories.values() if m.memory_type == MemoryType.CONVERSATION]
        conv_memories.sort(key=lambda x: x.created_at)
        return conv_memories[-limit:]
