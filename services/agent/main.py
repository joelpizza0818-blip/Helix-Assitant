import asyncio
import argparse
import logging
import signal
import json
import os
import sys
from pathlib import Path

# Add the project root to sys.path to allow absolute imports like 'services.agent.mcp'
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
import websockets

from core.event_bus import EventBus
from core.desktop_bridge import DesktopRequestHandler, _serialize
from core.state_manager import StateManager
from core.task_manager import TaskManager
from core.planner import Planner
from core.orchestrator import Orchestrator
from core.agent import Agent
from core.tool_registry import ToolRegistry
from core.role_config import RoleConfig
from core.context_manager import ContextManager
from core.react_loop import ReActLoop
from core.agent_manager import AgentManager

from ai.key_manager import KeyManager
from ai.capability_registry import CapabilityRegistry
from ai.provider_registry import ProviderRegistry
from ai.model_router import ModelRouter
from ai.fallback_manager import FallbackManager
from ai.openai_provider import OpenAIProvider
from ai.anthropic_provider import AnthropicProvider
from ai.google_provider import GoogleProvider

from skills.skill_loader import SkillLoader
from skills.skill_registry import SkillRegistry
from skills.intent_matcher import IntentMatcher

from mcp.client import MCPClientManager
from mcp.server import MCPServer
from mcp.tool_provider import MCPToolBridge

from plugins.plugin_manager import PluginManager

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

    load_dotenv(project_root / ".env")

    # Core Infrastructure
    event_bus = EventBus()
    state_manager = StateManager()
    task_manager = TaskManager(event_bus)
    
    # Key & Provider Management
    key_manager = KeyManager()
    logger.info(
        "AI providers with configured credentials: %s",
        ", ".join(key_manager.get_configured_providers()) or "none",
    )
    capability_registry = CapabilityRegistry()
    provider_registry = ProviderRegistry(key_manager)
    
    provider_registry.register_provider(OpenAIProvider())
    provider_registry.register_provider(AnthropicProvider())
    provider_registry.register_provider(GoogleProvider())
    
    model_router = ModelRouter(capability_registry, provider_registry, key_manager)
    fallback_manager = FallbackManager(model_router, key_manager, event_bus)

    # Tool & Role Configuration
    tool_registry = ToolRegistry()
    tools_dir = Path(__file__).parent / "tools"
    if tools_dir.exists():
        tool_registry.auto_discover(str(tools_dir))
    
    role_config = RoleConfig(args.config)
    context_manager = ContextManager()

    # ReAct Loop
    react_loop = ReActLoop(
        provider_registry=provider_registry,
        model_router=model_router,
        fallback_manager=fallback_manager,
        tool_registry=tool_registry,
        key_manager=key_manager,
        event_bus=event_bus,
        role_config=role_config
    )

    # Skills Subsystem
    skill_loader = SkillLoader()
    skill_registry = SkillRegistry(skill_loader)
    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.exists():
        skill_registry.discover_skills(str(skills_dir))
    intent_matcher = IntentMatcher(skill_registry)

    # MCP Subsystem
    mcp_client_manager = MCPClientManager(event_bus)
    mcp_tool_bridge = MCPToolBridge(mcp_client_manager, tool_registry)
    mcp_server = MCPServer(tool_registry)

    # Plugin System
    plugin_manager = PluginManager(event_bus, tool_registry, skill_registry)
    plugins_dir = Path(__file__).parent / "plugins"
    if plugins_dir.exists():
        await plugin_manager.load_plugins_from_directory(str(plugins_dir))

    # Agent Management, Planning & Orchestration
    agent_manager = AgentManager(
        react_loop=react_loop,
        context_manager=context_manager,
        event_bus=event_bus,
        role_config=role_config,
        tool_registry=tool_registry
    )

    planner = Planner(
        react_loop=react_loop,
        role_config=role_config,
        tool_registry=tool_registry,
        skill_registry=skill_registry
    )

    orchestrator = Orchestrator(
        planner=planner,
        task_manager=task_manager,
        event_bus=event_bus,
        react_loop=react_loop,
        agent_manager=agent_manager,
        tool_registry=tool_registry,
        role_config=role_config
    )
    
    agent = Agent(
        event_bus=event_bus,
        state_manager=state_manager,
        orchestrator=orchestrator,
        task_manager=task_manager,
        skill_registry=skill_registry,
        intent_matcher=intent_matcher,
        agent_manager=agent_manager
    )

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
            "CONFIRMATION_RESOLVED": "confirmation_resolved",
            "AGENT_MESSAGE": "agent_message",
            "STATUS_UPDATE": "status_update",
            "FALLBACK_EVENT": "fallback_event",
            "ERROR": "error",
            "PROVIDER_UPDATE": "provider_update",
            "SKILL_ACTIVATED": "skill_update",
            "SUBAGENT_SPAWNED": "agent_update",
            "REACT_STEP": "react_step",
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

    gesture_engine = None
    voice_engine = None

    async def on_settings_updated(event_name: str, payload: dict):
        nonlocal gesture_engine, voice_engine
        
        # log_level
        log_level = payload.get("log_level")
        if log_level:
            logging.getLogger().setLevel(log_level)
            
        # agent_ws_port
        logger.info("Note: agent_ws_port changes require a restart to take effect.")
        
        # camera_enabled
        camera_enabled = payload.get("camera_enabled")
        if camera_enabled is False and gesture_engine is not None:
            await gesture_engine.stop()
            gesture_engine = None
            logger.info("Gesture engine stopped.")
        elif camera_enabled is True and gesture_engine is None:
            try:
                from perception.gesture_engine import GestureEngine
                gesture_engine = GestureEngine(
                    event_bus,
                    camera_index=payload.get("camera_device_index", 0),
                    sensitivity=payload.get("gesture_sensitivity", 0.8),
                    min_detection_confidence=payload.get("gesture_sensitivity", 0.8),
                    state_manager=state_manager,
                )
                await gesture_engine.start()
                logger.info("Gesture engine started.")
            except Exception as e:
                logger.error(f"Failed to start gesture engine: {e}")
                
        # voice_enabled
        voice_enabled = payload.get("voice_enabled")
        if voice_enabled is False and voice_engine is not None:
            await voice_engine.stop()
            voice_engine = None
            logger.info("Voice engine stopped.")
        elif voice_enabled is True and voice_engine is None:
            ww_path = Path(payload.get("wake_word_model_path", os.environ.get("WAKE_WORD_MODEL_PATH", "models/wakeword/hey_helix.onnx")))
            if not ww_path.is_absolute():
                ww_path = Path(__file__).resolve().parent / ww_path
            if ww_path.is_file():
                try:
                    from perception.voice_engine import VoiceEngine
                    env_dict = dict(os.environ)
                    env_dict["WAKE_WORD"] = payload.get("wake_word", env_dict.get("WAKE_WORD", "hey helix"))
                    voice_engine = VoiceEngine(
                        env_dict, event_bus, key_manager, state_manager
                    )
                    await voice_engine.start()
                    logger.info("Voice engine started.")
                except Exception as e:
                    logger.error(f"Failed to start voice engine: {e}")

    await event_bus.subscribe("*", broadcast_event)
    await event_bus.subscribe("SETTINGS_UPDATED", on_settings_updated)
    await asyncio.sleep(0)

    runtime_settings = request_handler.get_settings()
    
    # Startup Validations
    stt_provider = os.environ.get("STT_PROVIDER", "whisper_local")
    logger.info(f"Active STT Provider: {stt_provider}")
    if stt_provider == "whisper_local":
        from perception.speech_to_text import SpeechToText
        ffmpeg_available = SpeechToText.check_ffmpeg()
        logger.info(
            "FFmpeg available for non-PCM audio conversion: %s",
            ffmpeg_available,
        )
    
    ww_path = Path(os.environ.get("WAKE_WORD_MODEL_PATH", "models/wakeword/hey_helix.onnx"))
    if not ww_path.is_absolute():
        ww_path = Path(__file__).resolve().parent / ww_path
    logger.info(f"Wake word model exists: {ww_path.is_file()}")
    
    configured_providers = [name for name, env in [('OpenAI', 'OPENAI_API_KEY_1'), ('Anthropic', 'ANTHROPIC_API_KEY_1'), ('Google', 'GOOGLE_API_KEY_1')] if os.environ.get(env)]
    logger.info(f"Configured API providers: {', '.join(configured_providers) if configured_providers else 'None'}")

    if runtime_settings.get("camera_enabled", False):
        try:
            from perception.gesture_engine import GestureEngine

            gesture_engine = GestureEngine(
                event_bus,
                camera_index=runtime_settings.get("camera_device_index", 0),
                sensitivity=runtime_settings.get("gesture_sensitivity", 0.8),
                min_detection_confidence=runtime_settings.get("gesture_sensitivity", 0.8),
                state_manager=state_manager,
            )
            await gesture_engine.start()
        except (ImportError, RuntimeError, ValueError) as error:
            logger.error("Gesture recognition could not be started: %s", error)
    else:
        logger.info("Camera gesture recognition is disabled in HELIX settings.")

    if os.environ.get("VOICE_ENABLED", "false").lower() == "true":
        wake_word_model_path = Path(os.environ.get(
            "WAKE_WORD_MODEL_PATH",
            "models/wakeword/hey_helix.onnx",
        ))
        if not wake_word_model_path.is_absolute():
            wake_word_model_path = Path(__file__).resolve().parent / wake_word_model_path

        if wake_word_model_path.is_file():
            try:
                from perception.voice_engine import VoiceEngine

                voice_engine = VoiceEngine(
                    dict(os.environ), event_bus, key_manager, state_manager
                )
                await voice_engine.start()
            except Exception:
                voice_engine = None
                logger.exception(
                    "Voice activation could not start; the desktop agent will continue without voice."
                )
        else:
            logger.error(
                "Voice activation is enabled, but the OpenWakeWord model for %r is missing: %s",
                os.environ.get("WAKE_WORD", "hey helix"),
                wake_word_model_path,
            )

    server = await websockets.serve(
        lambda ws: ws_handler(ws, clients, request_handler),
        "127.0.0.1", 
        args.ws_port
    )
    logger.info(f"HELIX Agent WebSocket server started on ws://127.0.0.1:{args.ws_port}")
    logger.info(f"Loaded {len(skill_registry.get_all_skills())} skills, {len(tool_registry.get_all_tools())} tools, {len(plugin_manager.get_all_plugins())} plugins.")
    
    try:
        # Keep server running until cancelled or interrupted
        await asyncio.Future()
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        if gesture_engine:
            await gesture_engine.stop()
        if voice_engine:
            await voice_engine.stop()
        server.close()
        await server.wait_closed()
        logger.info("HELIX Agent shut down gracefully.")

if __name__ == "__main__":
    asyncio.run(main())
