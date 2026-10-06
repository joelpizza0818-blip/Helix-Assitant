import asyncio
import argparse
import logging
import signal
import json
import os
from pathlib import Path
from dotenv import load_dotenv
import websockets

from core.event_bus import EventBus
from core.desktop_bridge import DesktopRequestHandler, _serialize
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

async def ws_handler(websocket, clients: set, request_handler: DesktopRequestHandler):
    clients.add(websocket)
    try:
        async for raw_message in websocket:
            request_id = None
            try:
                message = json.loads(raw_message)
                if not isinstance(message, dict):
                    raise ValueError("WebSocket message must be a JSON object")
                request_id = message.get("request_id")
                response = await request_handler.dispatch(message)
                if response:
                    await websocket.send(json.dumps(response))
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                logger.warning("Invalid desktop WebSocket request: %s", error)
                if request_id is not None:
                    await websocket.send(json.dumps({
                        "request_id": request_id,
                        "error": str(error),
                    }))
            except Exception as error:
                logger.exception("Desktop WebSocket request failed")
                if request_id is not None:
                    await websocket.send(json.dumps({
                        "request_id": request_id,
                        "error": "Internal agent request failed",
                    }))
    finally:
        clients.discard(websocket)

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

    default_settings_path = Path(os.environ.get("APPDATA", Path.home())) / "HELIX" / "settings.json"
    settings_path = Path(os.environ.get("HELIX_SETTINGS_PATH", default_settings_path))
    request_handler = DesktopRequestHandler(
        task_manager,
        provider_registry,
        capability_registry,
        key_manager,
        settings_path,
    )
    clients = set()

    async def broadcast_event(event_name: str, payload: dict):
        event_types = {
            "TASK_CREATED": "task_update",
            "TASK_STATUS_CHANGED": "task_update",
            "TASK_CANCELLED": "task_update",
            "WAIT_CONFIRMATION": "confirmation_request",
            "AGENT_MESSAGE": "agent_message",
            "STATUS_UPDATE": "status_update",
            "FALLBACK_EVENT": "fallback_event",
            "ERROR": "error",
            "PROVIDER_UPDATE": "provider_update",
        }
        if event_name in {"TASK_CREATED", "TASK_STATUS_CHANGED", "TASK_CANCELLED"}:
            task = await task_manager.get_task(payload.get("task_id", ""))
            if task is None:
                return
            event_payload = _serialize(task)
            event_payload["error"] = None
        else:
            event_payload = payload

        event = json.dumps({
            "type": event_types.get(event_name, event_name.lower()),
            "payload": event_payload,
        })
        stale_clients = set()
        for client in clients:
            try:
                await client.send(event)
            except websockets.ConnectionClosed:
                stale_clients.add(client)
            except Exception:
                logger.exception("Failed to forward %s to desktop client", event_name)
                stale_clients.add(client)
        clients.difference_update(stale_clients)

    await event_bus.subscribe("*", broadcast_event)
    await asyncio.sleep(0)

    server = await websockets.serve(
        lambda ws: ws_handler(ws, clients, request_handler),
        "127.0.0.1", 
        args.ws_port
    )
    logger.info(f"HELIX Agent WebSocket server started on ws://127.0.0.1:{args.ws_port}")
    
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
