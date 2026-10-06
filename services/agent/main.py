import asyncio
import argparse
import logging
import signal
from dotenv import load_dotenv
import websockets

from core.event_bus import EventBus
from core.state_manager import StateManager
from core.task_manager import TaskManager
from core.planner import Planner
from core.orchestrator import Orchestrator
from core.agent import Agent

from ai.key_manager import KeyManager
from ai.capability_registry import CapabilityRegistry
from ai.provider_registry import ProviderRegistry
from ai.model_router import ModelRouter
from ai.fallback_manager import FallbackManager
from ai.openai_provider import OpenAIProvider
from ai.anthropic_provider import AnthropicProvider
from ai.google_provider import GoogleProvider

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("HELIX_MAIN")

async def ws_handler(websocket, event_bus: EventBus):
    async for message in websocket:
        await event_bus.publish("WS_MESSAGE", {"data": message})

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ws-port", type=int, default=8765)
    parser.add_argument("--log-level", type=str, default="INFO")
    parser.add_argument("--config", type=str)
    args = parser.parse_args()

    load_dotenv()

    event_bus = EventBus()
    state_manager = StateManager()
    
    key_manager = KeyManager()
    capability_registry = CapabilityRegistry()
    provider_registry = ProviderRegistry(key_manager)
    
    provider_registry.register_provider(OpenAIProvider())
    provider_registry.register_provider(AnthropicProvider())
    provider_registry.register_provider(GoogleProvider())
    
    model_router = ModelRouter(capability_registry, provider_registry, key_manager)
    fallback_manager = FallbackManager(model_router, key_manager, event_bus)

    task_manager = TaskManager(event_bus)
    planner = Planner(model_router, fallback_manager)
    orchestrator = Orchestrator(planner, task_manager, event_bus, fallback_manager)
    
    agent = Agent(event_bus, state_manager, orchestrator, task_manager)
    
    server = await websockets.serve(
        lambda ws: ws_handler(ws, event_bus), 
        "localhost", 
        args.ws_port
    )
    logger.info(f"HELIX Agent WebSocket server started on ws://localhost:{args.ws_port}")
    
    try:
        # Keep server running until cancelled or interrupted
        await asyncio.Future()
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        server.close()
        await server.wait_closed()
        logger.info("HELIX Agent shut down gracefully.")

if __name__ == "__main__":
    asyncio.run(main())
