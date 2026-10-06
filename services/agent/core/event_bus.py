import asyncio
import logging
from typing import Callable, Coroutine, Dict, Set

logger = logging.getLogger(__name__)

class EventBus:
    def __init__(self):
        self.subscribers: Dict[str, Set[Callable]] = {}
        self.lock = asyncio.Lock()

    async def subscribe(self, event_name: str, handler: Callable):
        async with self.lock:
            if event_name not in self.subscribers:
                self.subscribers[event_name] = set()
            self.subscribers[event_name].add(handler)

    async def unsubscribe(self, event_name: str, handler: Callable):
        async with self.lock:
            if event_name in self.subscribers:
                self.subscribers[event_name].discard(handler)

    async def publish(self, event_name: str, payload: dict):
        logger.info(f"Event published: {event_name}")
        handlers = set()
        async with self.lock:
            if event_name in self.subscribers:
                handlers.update(self.subscribers[event_name])
            if '*' in self.subscribers:
                handlers.update(self.subscribers['*'])

        for handler in handlers:
            asyncio.create_task(self._safe_invoke(handler, event_name, payload))

    async def _safe_invoke(self, handler: Callable, event_name: str, payload: dict):
        try:
            await handler(event_name, payload)
        except Exception as e:
            logger.error(f"Error in handler for event {event_name}: {e}")
