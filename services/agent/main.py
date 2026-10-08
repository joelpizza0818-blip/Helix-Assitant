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
from core.desktop_bridge import DesktopRequestHandler, _serialize_task_for_desktop
from core.state_manager import StateManager
from core.task_manager import TaskManager
from core.planner import Planner
from core.orchestrator import Orchestrator
from core.agent import Agent
from services.agent.core.tool_registry import ToolRegistry
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
from security.permission_manager import PermissionManager
from memory.memory_manager import MemoryManager

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
    permission_manager = PermissionManager()
    
    # Key & Provider Management
    key_manager = KeyManager()
    memory_manager = MemoryManager(key_manager=key_manager)
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
    context_manager = ContextManager(tool_registry=tool_registry)

    # ReAct Loop
    react_loop = ReActLoop(
        provider_registry=provider_registry,
        model_router=model_router,
        fallback_manager=fallback_manager,
        tool_registry=tool_registry,
        key_manager=key_manager,
        event_bus=event_bus,
        role_config=role_config,
        permission_manager=permission_manager,
    )

    # Skills Subsystem
    default_settings_path = Path(os.environ.get("APPDATA", Path.home())) / "HELIX" / "settings.json"
    settings_path = Path(os.environ.get("HELIX_SETTINGS_PATH", default_settings_path))
    skill_loader = SkillLoader()
    skill_registry = SkillRegistry(skill_loader)
    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.exists():
        skill_registry.discover_skills(str(skills_dir))
    custom_skills_dir = settings_path.parent / "skills"
    if custom_skills_dir.exists():
        skill_registry.discover_skills(str(custom_skills_dir))
    intent_matcher = IntentMatcher(skill_registry)

    # MCP Subsystem
    mcp_client_manager = MCPClientManager(event_bus)
    mcp_tool_bridge = MCPToolBridge(mcp_client_manager, tool_registry)
    mcp_server = MCPServer(tool_registry)

    # Plugin System
    plugin_manager = PluginManager(event_bus, tool_registry, skill_registry)
    plugins_dir = Path(__file__).parent / "plugins"

    # Agent Management, Planning & Orchestration
    agent_manager = AgentManager(
        react_loop=react_loop,
        context_manager=context_manager,
        event_bus=event_bus,
        role_config=role_config,
        tool_registry=tool_registry,
        task_manager=task_manager,
    )
    await agent_manager.attach_task_manager(task_manager)

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
        role_config=role_config,
        memory_manager=memory_manager,
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

    request_handler = DesktopRequestHandler(
        task_manager,
        provider_registry,
        capability_registry,
        key_manager,
        settings_path,
        fallback_manager,
        react_loop,
        permission_manager,
        model_router,
        memory_manager,
        skill_registry,
    )
    request_handler.get_settings()
    clients = set()

    async def broadcast_event(event_name: str, payload: dict):
        event_types = {
            "TASK_CREATED": "task_update",
            "TASK_STATUS_CHANGED": "task_update",
            "TASK_CANCELLED": "task_update",
            "TASK_DETAILS_CHANGED": "task_update",
            "WAIT_CONFIRMATION": "confirmation_request",
            "CONFIRMATION_RESOLVED": "confirmation_resolved",
            "AGENT_MESSAGE": "agent_message",
            "STATUS_UPDATE": "status_update",
            "FALLBACK_EVENT": "fallback_event",
            "ERROR": "error",
            "PROVIDER_UPDATE": "provider_update",
            "SKILL_ACTIVATED": "skill_update",
            "SUBAGENT_SPAWNED": "agent_update",
            "SUBAGENT_STATUS_CHANGED": "agent_update",
            "SUBAGENT_COMPLETED": "agent_update",
            "SUBAGENT_FAILED": "agent_update",
            "SUBAGENT_CANCELLED": "agent_update",
            "AGENT_STARTED": "agent_update",
            "AGENT_COMPLETED": "agent_update",
            "AGENT_FAILED": "agent_update",
            "AGENT_CANCELLED": "agent_update",
            "REACT_STEP": "react_step",
            "HAND_LANDMARKS": "hand_landmarks",
        }
        if event_name in {
            "TASK_CREATED",
            "TASK_STATUS_CHANGED",
            "TASK_CANCELLED",
            "TASK_DETAILS_CHANGED",
        }:
            task = await task_manager.get_task(payload.get("task_id", ""))
            if task is None:
                return
            event_payload = _serialize_task_for_desktop(task)
            event_payload["error"] = None
        elif event_name in {
            "SUBAGENT_SPAWNED",
            "SUBAGENT_STATUS_CHANGED",
            "SUBAGENT_COMPLETED",
            "SUBAGENT_FAILED",
            "SUBAGENT_CANCELLED",
            "AGENT_STARTED",
            "AGENT_COMPLETED",
            "AGENT_FAILED",
            "AGENT_CANCELLED",
        }:
            # Delegated-agent payloads can contain private model responses or
            # prompts. The desktop needs lifecycle metadata only; never send
            # those contents through the renderer event channel.
            event_payload = {
                key: payload.get(key)
                for key in (
                    "agent_id", "parent_id", "role", "status",
                    "created_at", "started_at", "completed_at",
                )
                if key in payload
            }
            if payload.get("result") is not None:
                event_payload["has_result"] = True
            if payload.get("error") is not None:
                event_payload["failed"] = True
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
    active_mcp_servers: dict[str, str] = {}
    connecting_mcp_servers: set[str] = set()
    mcp_server_errors: dict[str, str] = {}

    async def apply_mcp_servers(server_configs: list[dict]) -> None:
        desired = {
            config["name"]: config["command"]
            for config in server_configs
            if isinstance(config, dict)
            and config.get("enabled", True) is True
            and isinstance(config.get("name"), str)
            and isinstance(config.get("command"), str)
            and config["name"].strip()
            and config["command"].strip()
        }
        for name, command in list(active_mcp_servers.items()):
            if desired.get(name) == command:
                continue
            for tool in mcp_client_manager.tools_cache.get(name, []):
                tool_registry.unregister_tool(f"{name}_{tool.name}")
            try:
                await mcp_client_manager.remove_server(name)
            except Exception:
                logger.exception("Failed to stop MCP server %s", name)
            active_mcp_servers.pop(name, None)
            mcp_server_errors.pop(name, None)

        for name, command in desired.items():
            if active_mcp_servers.get(name) == command:
                continue
            connecting_mcp_servers.add(name)
            mcp_server_errors.pop(name, None)
            try:
                await mcp_client_manager.add_server(name, command=command)
                await mcp_tool_bridge.sync_tools()
                active_mcp_servers[name] = command
                logger.info("MCP server %s connected.", name)
            except Exception as error:
                logger.error(
                    "Failed to connect MCP server %s (%s)",
                    name,
                    type(error).__name__,
                )
                mcp_server_errors[name] = (
                    f"Connection failed ({type(error).__name__}). Check the command and available logs."
                )
                if name in mcp_client_manager.clients:
                    await mcp_client_manager.remove_server(name)
            finally:
                connecting_mcp_servers.discard(name)

    def get_mcp_server_status(server_configs: list[dict]) -> list[dict]:
        statuses = []
        for config in server_configs:
            if not isinstance(config, dict):
                continue
            name = config.get("name")
            if not isinstance(name, str):
                continue
            if not config.get("enabled", True):
                status = "disabled"
            elif name in connecting_mcp_servers:
                status = "connecting"
            elif name in active_mcp_servers:
                status = "connected"
            elif name in mcp_server_errors:
                status = "error"
            else:
                status = "pending"
            statuses.append({
                **config,
                "status": status,
                "tool_count": len(mcp_client_manager.tools_cache.get(name, [])),
                "error": mcp_server_errors.get(name),
            })
        return statuses

    request_handler.mcp_status_provider = get_mcp_server_status

    async def on_settings_updated(event_name: str, payload: dict):
        nonlocal gesture_engine, voice_engine

        await apply_mcp_servers(payload.get("mcp_servers", []))
        memory_manager.configure(payload)
        if voice_engine is not None:
            voice_engine.configure_memory(
                payload.get("memory_context_limit", memory_manager.context_limit)
            )
            if "wake_word_threshold" in payload:
                voice_engine.wake_detector.threshold = float(
                    payload["wake_word_threshold"]
                )
            if "vad_threshold" in payload:
                try:
                    voice_engine.vad.min_speech_rms = max(
                        50.0, min(2000.0, float(payload["vad_threshold"]))
                    )
                except (TypeError, ValueError):
                    logger.error("Invalid microphone sensitivity threshold: %r", payload["vad_threshold"])

        for configured_tool in tool_registry.get_all_tools():
            configure = getattr(configured_tool, "configure", None)
            if callable(configure):
                configure(payload)
        from browser.browser_session import BrowserSession
        BrowserSession.configure_defaults(payload)
        
        # log_level
        log_level = payload.get("log_level")
        if log_level:
            logging.getLogger().setLevel(log_level)
            
        # agent_ws_port
        logger.info("Note: agent_ws_port changes require a restart to take effect.")
        
        camera_enabled = payload.get("camera_enabled", gesture_engine is not None)
        camera_index = payload.get(
            "camera_device_index",
            gesture_engine.camera_index if gesture_engine is not None else 0,
        )
        gesture_sensitivity = payload.get(
            "gesture_sensitivity",
            gesture_engine.sensitivity if gesture_engine is not None else 0.8,
        )
        gesture_mappings = payload.get("gesture_mappings", {})
        if camera_enabled:
            try:
                if gesture_engine is None:
                    from perception.gesture_engine import GestureEngine

                    gesture_engine = GestureEngine(
                        event_bus,
                        camera_index=camera_index,
                        sensitivity=gesture_sensitivity,
                        state_manager=state_manager,
                        gesture_mappings=gesture_mappings,
                        hand_commands=payload.get("hand_commands", []),
                    )
                else:
                    gesture_engine.set_gesture_mappings(gesture_mappings)
                    gesture_engine.set_hand_commands(payload.get("hand_commands", []))
                await gesture_engine.configure(
                    camera_index,
                    gesture_sensitivity,
                    enabled=True,
                )
                logger.info("Gesture engine settings applied.")
            except Exception as e:
                logger.error("Failed to apply gesture settings: %s", e)
        elif gesture_engine is not None:
            await gesture_engine.configure(
                camera_index,
                gesture_sensitivity,
                enabled=False,
            )
            gesture_engine = None
            logger.info("Gesture engine stopped.")
                
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
                    env_dict = {
                        **dict(os.environ),
                        "VOICE_ENABLED": "true",
                        "WAKE_WORD": payload.get("wake_word", "hey helix"),
                        "WAKE_WORD_ALIASES": payload.get("custom_wake_words", []),
                        "WAKE_WORD_PROVIDER": payload.get(
                            "wake_word_provider", "openwakeword"
                        ),
                        "WAKE_WORD_THRESHOLD": str(
                            payload.get("wake_word_threshold", 0.5)
                        ),
                        "STT_PROVIDER": {
                            "openai_whisper": "openai",
                            "local_whisper": "whisper_local",
                            "windows_sapi": "whisper_local",
                        }.get(payload.get("voice_stt_provider", "local_whisper"), "whisper_local"),
                        "STT_MODEL": payload.get("stt_model", "base"),
                        "TTS_PROVIDER": {
                            "openai_tts": "openai",
                            "elevenlabs": "elevenlabs",
                            "edge_tts": "edge_tts",
                            "windows_sapi": "system",
                        }.get(payload.get("voice_tts_provider", "edge_tts"), "edge_tts"),
                        "TTS_MODEL": payload.get(
                            "tts_model", os.environ.get("TTS_MODEL", "tts-1")
                        ),
                        "TTS_VOICE": payload.get(
                            "voice_tts_voice", "en-US-AndrewMultilingualNeural"
                        ),
                        "MEMORY_CONTEXT_LIMIT": payload.get(
                            "memory_context_limit", memory_manager.context_limit
                        ),
                        "VAD_THRESHOLD": str(
                            payload.get("vad_threshold", 250)
                        ),
                    }
                    voice_engine = VoiceEngine(
                        env_dict, event_bus, key_manager, state_manager
                    )
                    await voice_engine.start()
                    logger.info("Voice engine started.")
                except Exception as e:
                    logger.error(f"Failed to start voice engine: {e}")
        elif voice_enabled is True and voice_engine is not None:
            configured_aliases = payload.get("custom_wake_words", [])
            if not isinstance(configured_aliases, list):
                raise ValueError("custom_wake_words must be a list of phrases.")
            wake_word = payload.get(
                "wake_word", voice_engine.config.get("WAKE_WORD", "hey helix")
            )
            wake_provider = payload.get(
                "wake_word_provider",
                voice_engine.config.get("WAKE_WORD_PROVIDER", "openwakeword"),
            )
            wake_threshold = float(payload.get(
                "wake_word_threshold",
                voice_engine.config.get("WAKE_WORD_THRESHOLD", 0.5),
            ))
            model_path = payload.get(
                "wake_word_model_path",
                voice_engine.config.get(
                    "WAKE_WORD_MODEL_PATH",
                    os.environ.get("WAKE_WORD_MODEL_PATH"),
                ),
            )
            if (
                wake_word != voice_engine.config.get("WAKE_WORD")
                or wake_provider != voice_engine.config.get("WAKE_WORD_PROVIDER")
                or wake_threshold != float(voice_engine.config.get("WAKE_WORD_THRESHOLD", 0.5))
                or configured_aliases != voice_engine.config.get("WAKE_WORD_ALIASES", [])
                or model_path != voice_engine.config.get("WAKE_WORD_MODEL_PATH")
            ):
                await voice_engine.configure_wake_word(
                    wake_word=wake_word,
                    provider=wake_provider,
                    threshold=wake_threshold,
                    aliases=configured_aliases,
                    model_path=model_path,
                )
            tts_provider = {
                "openai_tts": "openai",
                "elevenlabs": "elevenlabs",
                "edge_tts": "edge_tts",
                "windows_sapi": "system",
            }.get(
                payload.get(
                    "voice_tts_provider",
                    voice_engine.config.get("TTS_PROVIDER", "edge_tts"),
                ),
                "edge_tts",
            )
            tts_model = payload.get(
                "tts_model",
                voice_engine.config.get(
                    "TTS_MODEL", os.environ.get("TTS_MODEL", "tts-1")
                ),
            )
            tts_voice = payload.get(
                "voice_tts_voice",
                voice_engine.config.get(
                    "TTS_VOICE", "en-US-AndrewMultilingualNeural"
                ),
            )
            if (
                tts_provider != voice_engine.config.get("TTS_PROVIDER")
                or tts_model != voice_engine.config.get("TTS_MODEL")
                or tts_voice != voice_engine.config.get("TTS_VOICE")
            ):
                await voice_engine.configure_tts(
                    provider=tts_provider,
                    model=tts_model,
                    voice_id=tts_voice,
                )
            stt_provider = {
                "openai_whisper": "openai",
                "local_whisper": "whisper_local",
                "windows_sapi": "whisper_local",
            }.get(
                payload.get(
                    "voice_stt_provider",
                    voice_engine.config.get("STT_PROVIDER", "whisper_local"),
                ),
                "whisper_local",
            )
            stt_model = payload.get(
                "stt_model", voice_engine.config.get("STT_MODEL", "base")
            )
            if (
                stt_provider != voice_engine.stt.provider
                or stt_model != voice_engine.stt.model
            ):
                await voice_engine.configure_stt(stt_provider, stt_model)

    async def record_model_request(event_name: str, payload: dict) -> None:
        task_id = payload.get("task_id")
        if task_id:
            await task_manager.record_model_request(task_id, payload)

    async def record_execution_summary(event_name: str, payload: dict) -> None:
        task_id = payload.get("task_id")
        if not task_id:
            return
        if event_name == "REACT_STEP":
            await task_manager.record_react_step(
                task_id,
                int(payload.get("iteration", 0)),
                str(payload.get("role", "main")),
            )
        elif event_name == "TOOL_EXECUTED":
            await task_manager.record_tool_call(
                task_id,
                str(payload.get("tool", "unknown tool")),
                bool(payload.get("success")),
                payload.get("result_summary"),
            )
        elif event_name == "ORCHESTRATION_COMPLETED":
            await task_manager.record_result(
                task_id,
                "completed",
                payload.get("response") or payload.get("results"),
            )
        elif event_name == "ORCHESTRATION_FAILED":
            await task_manager.record_result(
                task_id,
                "failed",
                payload.get("error", "Execution failed"),
            )

    await event_bus.subscribe("MODEL_REQUEST", record_model_request)
    for execution_event in (
        "REACT_STEP",
        "TOOL_EXECUTED",
        "ORCHESTRATION_COMPLETED",
        "ORCHESTRATION_FAILED",
    ):
        await event_bus.subscribe(execution_event, record_execution_summary)
    await event_bus.subscribe("*", broadcast_event)
    await event_bus.subscribe("SETTINGS_UPDATED", on_settings_updated)
    await asyncio.sleep(0)

    runtime_settings = request_handler.get_settings()

    async def handle_voice_toggle(_event_name: str, _payload: dict):
        nonlocal voice_engine
        if voice_engine is None:
            return
        if voice_engine._is_active:
            await voice_engine.stop()
        else:
            await voice_engine.start()

    await event_bus.subscribe("VOICE_TOGGLE", handle_voice_toggle)

    async def initialize_startup_settings() -> None:
        if plugins_dir.exists():
            try:
                await plugin_manager.load_plugins_from_directory(str(plugins_dir))
            except Exception:
                logger.exception("HELIX plugins could not be initialized.")

        try:
            await on_settings_updated("SETTINGS_UPDATED", runtime_settings)
        except Exception:
            logger.exception(
                "Saved HELIX settings could not be fully initialized; "
                "the desktop agent will remain available."
            )

    server = await websockets.serve(
        lambda ws: ws_handler(ws, clients, request_handler),
        "127.0.0.1", 
        args.ws_port
    )
    logger.info(f"HELIX Agent WebSocket server started on ws://127.0.0.1:{args.ws_port}")
    await asyncio.sleep(0)
    startup_settings_task = asyncio.create_task(
        initialize_startup_settings(),
        name="helix-startup-settings",
    )
    
    try:
        # Keep server running until cancelled or interrupted
        await asyncio.Future()
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        if not startup_settings_task.done():
            startup_settings_task.cancel()
            try:
                await startup_settings_task
            except asyncio.CancelledError:
                pass
        if gesture_engine:
            await gesture_engine.stop()
        if voice_engine:
            await voice_engine.stop()
        server.close()
        await server.wait_closed()
        logger.info(
            "Loaded %s skills, %s tools, and %s plugins.",
            len(skill_registry.get_all_skills()),
            len(tool_registry.get_all_tools()),
            len(plugin_manager.get_all_plugins()),
        )
        logger.info("HELIX Agent shut down gracefully.")

if __name__ == "__main__":
    asyncio.run(main())
