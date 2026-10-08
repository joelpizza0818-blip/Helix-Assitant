import logging
import uuid
import asyncio
import os
import time
import json
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
    STATUS_CACHE_SECONDS = 30.0

    def __init__(self, key_manager=None):
        self.memories: Dict[str, MemoryEntry] = {}
        self.key_manager = key_manager
        self.context_limit = 20
        self.auto_compaction = True
        self.embedding_model = "text-embedding-3-small"
        self.similarity_threshold = 0.75
        self.database_url = os.environ.get("HELIX_MEMORY_DATABASE_URL", "")
        self.pgvector_ready = False
        self.pgvector_message = (
            "Set HELIX_MEMORY_DATABASE_URL to enable semantic memory. "
            "The backend DATABASE_URL is intentionally not used for conversation data."
        )
        self.embedding_dimensions: int | None = None
        self._status_checked_at = 0.0
        self._status_lock = asyncio.Lock()

    def configure(self, settings: dict) -> None:
        self.context_limit = max(1, min(100, int(settings.get("memory_context_limit", self.context_limit))))
        self.auto_compaction = bool(settings.get("memory_auto_compaction", self.auto_compaction))
        self.embedding_model = str(settings.get("embedding_model", self.embedding_model))
        threshold = settings.get("memory_similarity_threshold", self.similarity_threshold)
        if isinstance(threshold, (int, float)) and not isinstance(threshold, bool):
            self.similarity_threshold = max(0.0, min(1.0, float(threshold)))
        application_memory = settings.get("application_memory")
        if isinstance(application_memory, dict):
            session_memories = {
                key: entry
                for key, entry in self.memories.items()
                if not entry.metadata.get("application")
            }
            configured_memories = {
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
            self.memories = {**session_memories, **configured_memories}
        self._status_checked_at = 0.0
        if not self.database_url:
            self.pgvector_ready = False
            self.pgvector_message = (
                "HELIX_MEMORY_DATABASE_URL is not configured; semantic memory "
                "is using local keyword retrieval."
            )

    async def status(self) -> dict:
        if time.monotonic() - self._status_checked_at >= self.STATUS_CACHE_SECONDS:
            async with self._status_lock:
                if time.monotonic() - self._status_checked_at >= self.STATUS_CACHE_SECONDS:
                    await asyncio.to_thread(self._refresh_pgvector_status)
        return {
            "pgvector_ready": self.pgvector_ready,
            "provider": "pgvector" if self.pgvector_ready else "local",
            "embedding_model": self.embedding_model,
            "similarity_threshold": self.similarity_threshold,
            "dimensions": self.embedding_dimensions,
            "message": self.pgvector_message,
        }

    def _refresh_pgvector_status(self) -> None:
        if not self.database_url:
            self.pgvector_ready = False
            self.pgvector_message = (
                "HELIX_MEMORY_DATABASE_URL is not configured; semantic memory "
                "is using local keyword retrieval."
            )
            self._status_checked_at = time.monotonic()
            return
        if self.embedding_model == "local_bge":
            self.pgvector_ready = False
            self.pgvector_message = (
                "The selected local embedding model is not installed; semantic "
                "memory is using local keyword retrieval."
            )
            self._status_checked_at = time.monotonic()
            return
        if not self._embedding_key_available():
            self.pgvector_ready = False
            self.pgvector_message = (
                f"{self.embedding_model} needs an API key before pgvector "
                "retrieval can run."
            )
            self._status_checked_at = time.monotonic()
            return
        try:
            self._ensure_pgvector_schema()
            self.pgvector_ready = True
            self.pgvector_message = "pgvector is connected and semantic similarity search is active."
        except Exception as error:
            self.pgvector_ready = False
            self.pgvector_message = f"pgvector is unavailable: {type(error).__name__}."
            logger.warning("pgvector memory unavailable: %s", error)
        self._status_checked_at = time.monotonic()

    def _embedding_key_available(self) -> bool:
        if self.embedding_model.startswith("text-embedding-3"):
            return bool(self._embedding_api_key("openai"))
        if self.embedding_model == "text-embedding-004":
            return bool(self._embedding_api_key("google"))
        return False

    def _embedding_api_key(self, provider: str) -> str | None:
        if self.key_manager is not None:
            available_key = self.key_manager.get_available_key(provider)
            if available_key:
                return available_key[1]
        environment_name = "OPENAI_API_KEY" if provider == "openai" else "GOOGLE_API_KEY"
        return (
            os.environ.get(environment_name)
            or os.environ.get(f"{environment_name}_1")
        )

    @staticmethod
    def _vector_literal(values: list[float]) -> str:
        return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"

    def _connect(self):
        import psycopg2

        return psycopg2.connect(self.database_url, connect_timeout=5)

    def _ensure_pgvector_schema(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS semantic_memories (
                        id uuid PRIMARY KEY,
                        content text NOT NULL,
                        memory_type text NOT NULL,
                        source text,
                        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                        embedding vector NOT NULL,
                        embedding_model text NOT NULL,
                        created_at timestamptz NOT NULL DEFAULT now()
                    )
                    """
                )

    async def _embed(self, text: str) -> list[float]:
        if self.embedding_model.startswith("text-embedding-3"):
            from openai import AsyncOpenAI

            api_key = self._embedding_api_key("openai")
            if not api_key:
                raise RuntimeError("OpenAI embedding API key is not configured.")
            client = AsyncOpenAI(api_key=api_key)
            response = await client.embeddings.create(model=self.embedding_model, input=text)
            embedding = response.data[0].embedding
            self.embedding_dimensions = len(embedding)
            return embedding
        if self.embedding_model == "text-embedding-004":
            import google.generativeai as genai

            api_key = self._embedding_api_key("google")
            if not api_key:
                raise RuntimeError("Google embedding API key is not configured.")
            genai.configure(api_key=api_key)
            response = await asyncio.to_thread(
                genai.embed_content,
                model="models/text-embedding-004",
                content=text,
            )
            embedding = response["embedding"]
            self.embedding_dimensions = len(embedding)
            return embedding
        raise RuntimeError(f"Embedding model is not supported for pgvector: {self.embedding_model}")

    async def _store_pgvector(self, entry: MemoryEntry) -> None:
        embedding = await self._embed(entry.content)
        vector = self._vector_literal(embedding)

        def write() -> None:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO semantic_memories (id, content, memory_type, source, metadata, embedding, embedding_model, created_at)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s::vector, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          content = EXCLUDED.content,
                          memory_type = EXCLUDED.memory_type,
                          source = EXCLUDED.source,
                          metadata = EXCLUDED.metadata,
                          embedding = EXCLUDED.embedding,
                          embedding_model = EXCLUDED.embedding_model
                        """,
                        (
                            entry.id,
                            entry.content,
                            entry.memory_type.name,
                            entry.metadata.get("source"),
                            json.dumps(entry.metadata),
                            vector,
                            self.embedding_model,
                            entry.created_at,
                        ),
                    )

        await asyncio.to_thread(write)

    async def _retrieve_pgvector(self, query: str, limit: int) -> list[MemoryEntry]:
        embedding = await self._embed(query)
        vector = self._vector_literal(embedding)
        max_distance = 1.0 - self.similarity_threshold

        def read() -> list[MemoryEntry]:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, content, memory_type, metadata, created_at, 1 - (embedding <=> %s::vector) AS similarity
                        FROM semantic_memories
                        WHERE embedding_model = %s
                          AND (embedding <=> %s::vector) <= %s
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                        """,
                        (vector, self.embedding_model, vector, max_distance, vector, limit),
                    )
                    rows = cursor.fetchall()
            entries = []
            for memory_id, content, memory_type, metadata, created_at, _similarity in rows:
                entries.append(MemoryEntry(
                    id=str(memory_id),
                    content=content,
                    memory_type=MemoryType[memory_type] if memory_type in MemoryType.__members__ else MemoryType.SEMANTIC,
                    metadata=metadata or {},
                    created_at=created_at,
                    expires_at=None,
                ))
            return entries

        return await asyncio.to_thread(read)

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
        if memory_type in {MemoryType.CONVERSATION, MemoryType.LONG_TERM, MemoryType.SEMANTIC}:
            if time.monotonic() - self._status_checked_at >= self.STATUS_CACHE_SECONDS:
                await asyncio.to_thread(self._refresh_pgvector_status)
            if self.pgvector_ready:
                try:
                    await self._store_pgvector(entry)
                except Exception as error:
                    self.pgvector_ready = False
                    self.pgvector_message = f"pgvector write failed: {type(error).__name__}; using local memory."
                    logger.warning("pgvector memory write failed: %s", error)
        logger.info(f"Stored memory {entry_id} of type {memory_type.name}")
        return entry

    async def retrieve(self, query: str, memory_type: MemoryType, limit: int = 10) -> List[MemoryEntry]:
        results = [m for m in self.memories.values() if m.memory_type == memory_type and query.lower() in m.content.lower()]
        return results[:limit]

    async def retrieve_relevant(self, query: str, limit: int = 10) -> List[MemoryEntry]:
        if time.monotonic() - self._status_checked_at >= self.STATUS_CACHE_SECONDS:
            await asyncio.to_thread(self._refresh_pgvector_status)
        if self.pgvector_ready:
            try:
                return await self._retrieve_pgvector(query, limit)
            except Exception as error:
                self.pgvector_ready = False
                self.pgvector_message = f"pgvector retrieval failed: {type(error).__name__}; using local keyword retrieval."
                logger.warning("pgvector memory retrieval failed: %s", error)
        query_terms = {term for term in query.lower().split() if len(term) > 2}
        scored = []
        for memory in self.memories.values():
            content_terms = set(memory.content.lower().split())
            overlap = len(query_terms & content_terms)
            if overlap:
                scored.append((overlap / max(1, len(query_terms)), memory))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [memory for score, memory in scored if score >= self.similarity_threshold or not query_terms][:limit]

    async def clear_conversation_memory(self) -> None:
        self.memories = {
            memory_id: memory
            for memory_id, memory in self.memories.items()
            if memory.memory_type != MemoryType.CONVERSATION
        }
        if self.database_url:
            def clear_database() -> None:
                with self._connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "DELETE FROM semantic_memories WHERE memory_type = %s",
                            (MemoryType.CONVERSATION.name,),
                        )

            try:
                await asyncio.to_thread(clear_database)
            except Exception as error:
                logger.exception("Could not clear persisted conversation memory.")
                raise RuntimeError(
                    "Local conversation cache was cleared, but semantic memory could not be cleared."
                ) from error

    async def forget(self, memory_id: str) -> None:
        if memory_id in self.memories:
            del self.memories[memory_id]
            logger.info(f"Forgot memory {memory_id}")

    async def get_conversation_context(self, limit: int = 20) -> List[MemoryEntry]:
        conv_memories = [m for m in self.memories.values() if m.memory_type == MemoryType.CONVERSATION]
        conv_memories.sort(key=lambda x: x.created_at)
        return conv_memories[-limit:]
