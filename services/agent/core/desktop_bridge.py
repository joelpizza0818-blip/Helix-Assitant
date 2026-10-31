import json
import hashlib
import asyncio
import os
import re
import base64
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
try:
    from services.agent.perception.screen_vision_sampling import (
        DEFAULT_SCREEN_VISION_INTERVAL_MS,
        MIN_SCREEN_VISION_INTERVAL_MS,
        validate_screen_vision_interval_ms,
    )
except ImportError:
    from ..perception.screen_vision_sampling import (
        DEFAULT_SCREEN_VISION_INTERVAL_MS,
        MIN_SCREEN_VISION_INTERVAL_MS,
        validate_screen_vision_interval_ms,
    )

from services.agent.core.browser_page_context import clear_current_page, update_current_page
try:
    from services.agent.memory.user_memory_manager import UserMemoryManager
except ImportError:
    from ..memory.user_memory_manager import UserMemoryManager

try:
    from ..ai.base_provider import ModelDefinition, ModelCapabilities
    from ..ai.custom_provider import OpenAICompatibleProvider
    from ..ai.ollama_manager import get_ollama_manager
    from ..ai.llama_server_manager import get_llama_server_manager
    from ..ai.model_catalog_generated import MODEL_CATALOG
except ImportError:
    from ai.base_provider import ModelDefinition, ModelCapabilities
    from ai.custom_provider import OpenAICompatibleProvider
    from ai.ollama_manager import get_ollama_manager
    from ai.llama_server_manager import get_llama_server_manager
    from ai.model_catalog_generated import MODEL_CATALOG


DEFAULT_SETTINGS = {
    "voice_enabled": True,
    "activation_phrase_enabled": True,
    "wake_word": "hey helix",
    "wake_word_provider": "openwakeword",
    "wake_word_threshold": 0.5,
    "voice_tts_provider": "edge_tts",
    "voice_tts_voice": "en-US-AndrewMultilingualNeural",
    "voice_response_enabled": True,
    "vad_threshold": 250,
    "mcp_servers": [],
    "camera_enabled": False,
    "camera_device_index": 0,
    "gesture_sensitivity": 0.8,
    "gesture_window_sequence_enabled": True,
    "start_with_windows": True,
    "start_minimized": True,
    "default_model": "meta-llama/llama-3.2-3b-instruct:free",
    "preferred_provider": "free",
    "fallback_enabled": True,
    "cross_provider_fallback": True,
    "_cross_provider_failover_migrated": True,
    "auto_approve_up_to": "LOW_RISK",
    "permissions_mode": "SMART_APPROVAL",
    "permission_mode": "SMART_APPROVAL",
    "cost_preference": "balanced",
    "speed_preference": "balanced",
    "quality_preference": "balanced",
    "log_level": "INFO",
    "protected_paths": [],
    "protected_apps": [],
    "agent_ws_port": 8765,
    "display_index": 0,
    "screen_capture_interval_ms": 1000,
    "screen_context_enabled": False,
    "model_decides_screen_vision_enabled": False,
    "continuous_screen_vision_enabled": False,
    "continuous_screen_vision_interval_ms": DEFAULT_SCREEN_VISION_INTERVAL_MS,
    "complex_workflows_enabled": False,
    "subagents_enabled": True,
    "ocr_engine": "local",
    "mouse_move_duration_ms": 200,
    "keystroke_delay_ms": 30,
    "pyautogui_fail_safe": True,
    "shell_type": "powershell",
    "shell_timeout_seconds": 60,
    "block_elevated_execution": True,
    "browser_engine": "chromium",
    "browser_headless": True,
    "browser_control_mode": "playwright",
    "search_provider": "google",
    "research_depth": 2,
    "block_downloads": True,
    "block_untrusted_domains": True,
    "always_on_top": True,
    "floating_ui_mode": "full",
    "global_summon_shortcut": "Alt+Space",
    "emergency_stop_shortcut": "Control+Shift+Escape",
    "gesture_mappings": {
        "GESTURE_CONFIRM": {"action": "CONFIRM", "label": "Confirm pending action"},
        "GESTURE_REJECT": {"action": "REJECT", "label": "Reject pending action"},
        "GESTURE_SEARCH": {"action": "SEARCH", "label": "Autonomous web research"},
        "GESTURE_STOP": {"action": "STOP", "label": "Emergency task halt"},
        "GESTURE_CLOSE": {"action": "CLOSE", "label": "Hide assistant UI"},
        "GESTURE_OPEN": {"action": "OPEN", "label": "Focus HELIX"},
    },
    "hand_commands": [],
    "application_memory": {},
    "memory_context_limit": 20,
    "memory_compact_threshold": 10,
    "memory_auto_compaction": True,
    "model_request_timeout_seconds": 45,
    "embedding_model": "text-embedding-3-small",
    "memory_similarity_threshold": 0.75,
    "tool_verification_enabled": True,
}

MAX_USER_TEXT_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_AGENT_WEBSOCKET_MESSAGE_BYTES = 16 * 1024 * 1024


def safe_desktop_request_error(error: Exception) -> str:
    messages = {
        "MODEL_TEMPORARILY_UNAVAILABLE": (
            "The selected AI model is temporarily overloaded. Try again later "
            "or choose another model in AI settings."
        ),
        "TIMEOUT": (
            "The AI provider did not respond in time. Try again or choose "
            "another model in AI settings."
        ),
        "NETWORK_ERROR": (
            "HELIX could not reach the AI provider. Check your connection "
            "and try again."
        ),
        "RATE_LIMIT": (
            "The AI provider is rate-limiting requests. Wait briefly and try again."
        ),
        "QUOTA_EXCEEDED": (
            "The AI provider quota is exhausted for this key. Check provider "
            "usage or choose another key in AI settings."
        ),
        "AUTH_ERROR": (
            "The AI provider rejected its configured key. Validate the key "
            "in AI settings."
        ),
    }
    current: Optional[BaseException] = error
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = getattr(current, "code", None)
        if isinstance(code, str) and code in messages:
            return messages[code]
        current = current.__cause__ or current.__context__
    return "Internal agent request failed"


def _serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if hasattr(value, "__dataclass_fields__"):
        return {key: _serialize(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(item) for item in value]
    return value


def _serialize_task_for_desktop(task: Any) -> dict:
    """Expose only the task fields intended for the desktop summary UI.

    Raw task results and internal metadata can contain model context or tool
    output.  The UI receives the explicitly redacted execution summary instead.
    """
    serialized = _serialize(task)
    metadata = getattr(task, "metadata", {})
    if (
        isinstance(metadata, dict)
        and metadata.get("task_type") == "subagent"
    ):
        serialized["task_type"] = "subagent"
    serialized.pop("result", None)
    serialized.pop("metadata", None)
    if serialized.get("status") == "failed":
        provider = getattr(task, "provider", None)
        if isinstance(provider, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", provider):
            serialized["failure_category"] = "provider"
            serialized["failure_provider"] = provider
        else:
            serialized["failure_category"] = "internal"
    return serialized


def _safe_task_failure_message(error: Any, provider: Any = None) -> str | None:
    if not isinstance(error, str) or not error:
        return None
    if isinstance(provider, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", provider):
        return (
            f"The subagent could not complete its request with {provider}. "
            "Check provider availability and routing, then retry."
        )
    return "The subagent task failed. Retry or inspect the local agent logs."


class DesktopRequestHandler:
    def __init__(
        self,
        task_manager,
        provider_registry,
        capability_registry,
        key_manager,
        settings_path: Path,
        fallback_manager=None,
        react_loop=None,
        permission_manager=None,
        model_router=None,
        memory_manager=None,
        skill_registry=None,
        plugin_manager=None,
        agent_manager=None,
    ):
        self.task_manager = task_manager
        self.provider_registry = provider_registry
        self.capability_registry = capability_registry
        self.key_manager = key_manager
        self.settings_path = settings_path
        self.fallback_manager = fallback_manager
        self.react_loop = react_loop
        self.permission_manager = permission_manager
        self.model_router = model_router
        self.memory_manager = memory_manager
        self.skill_registry = skill_registry
        self.plugin_manager = plugin_manager
        self.agent_manager = agent_manager
        self.credentials_updated_callback = None
        self.mcp_status_provider = None
        self._desktop_streamer = None

    async def dispatch(self, message: dict) -> dict:
        message_type = message.get("type")
        payload = message.get("payload") or {}
        request_id = message.get("request_id")
        handlers = {
            "GET_TASKS": self._get_tasks,
            "GET_PROVIDERS": self._get_providers,
            "GET_MODELS": lambda: self._get_models(payload.get("requirements") or {}),
            "GET_SUBAGENT_PROFILES": self._get_subagent_profiles,
            "GET_SUBAGENT_STATUS": self._get_subagent_status,
            "GET_SUBAGENT_ROUTING_OPTIONS": self._get_subagent_routing_options,
            "SET_SUBAGENT_ROUTE": lambda: self._set_subagent_route(payload),
            "CREATE_SUBAGENT_PROFILE": lambda: self._create_subagent_profile(payload),
            "UPDATE_SUBAGENT_PROFILE": lambda: self._update_subagent_profile(payload),
            "CHAT_SUBAGENT": lambda: self._chat_subagent(payload),
            "GET_SUBAGENT_MEMORIES": lambda: self._get_subagent_memories(payload),
            "SAVE_SUBAGENT_MEMORY": lambda: self._save_subagent_memory(payload),
            "UPDATE_SUBAGENT_MEMORY": lambda: self._update_subagent_memory(payload),
            "DELETE_SUBAGENT_MEMORY": lambda: self._delete_subagent_memory(payload),
            "GET_SETTINGS": self._get_settings,
            "GET_CAPABILITIES": self._get_capabilities,
            "SAVE_SETTINGS": lambda: self._save_settings(payload.get("settings")),
            "TEST_TTS": lambda: self._test_tts(payload),
            "GET_MEMORY_STATUS": self._get_memory_status,
            "CLEAR_MEMORY": self._clear_memory,
            "GET_USER_MEMORIES": self._get_user_memories,
            "GET_USER_MEMORY_PROFILE": self._get_user_memory_profile,
            "UPDATE_USER_MEMORY_SUMMARY": lambda: self._update_user_memory_summary(payload),
            "UPDATE_USER_NOTES": lambda: self._update_user_notes(payload),
            "CLEAR_USER_MEMORY": self._clear_user_memory,
            "SAVE_USER_MEMORY": lambda: self._save_user_memory(payload),
            "UPDATE_USER_MEMORY": lambda: self._update_user_memory(payload),
            "DELETE_USER_MEMORY": lambda: self._delete_user_memory(payload),
            "VALIDATE_KEY": lambda: self._validate_key(payload),
            "GET_SKILLS": self._get_skills,
            "SAVE_SKILL": lambda: self._save_skill(payload.get("skill")),
            "DELETE_SKILL": lambda: self._delete_skill(payload.get("name")),
            "GET_MCP_SERVERS": self._get_mcp_servers,
            "LOAD_CAPABILITY_PACK": lambda: self._load_capability_pack(payload),
            "GET_LEARNING_STATS": self._get_learning_stats,
            "RUN_LEARNING_MAINTENANCE": self._run_learning_maintenance,
            "LIST_FREE_MODELS": self._list_free_models,
            "GET_MODEL_CATALOG": self._get_model_catalog,
            "GET_OLLAMA_STATUS": self._get_ollama_status,
            "PULL_OLLAMA_MODEL": lambda: self._pull_ollama_model(payload),
            "GET_LLAMA_SERVER_STATUS": self._get_llama_server_status,
            "START_LLAMA_SERVER": lambda: self._start_llama_server(payload),
            "STOP_LLAMA_SERVER": self._stop_llama_server,
            "DOWNLOAD_LLAMA_SERVER": self._download_llama_server,
            "DOWNLOAD_GGUF_MODEL": lambda: self._download_gguf_model(payload),
        }

        if request_id is None:
            await self._dispatch_event(message_type, payload)
            return {}

        handler = handlers.get(message_type)
        if handler is None:
            raise ValueError(f"Unsupported desktop request: {message_type}")

        result = await handler()
        return {"request_id": request_id, "payload": result}

    async def _load_capability_pack(self, payload: dict) -> dict:
        pack_id = payload.get("id")
        version = payload.get("version")
        expected_hash = payload.get("sha256")
        if (
            not isinstance(pack_id, str)
            or re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", pack_id) is None
            or not isinstance(version, str)
            or re.fullmatch(r"\d+\.\d+\.\d+", version) is None
            or not isinstance(expected_hash, str)
            or re.fullmatch(r"[a-fA-F0-9]{64}", expected_hash) is None
        ):
            raise ValueError("Capability pack identity is invalid")
        if self.plugin_manager is None:
            raise RuntimeError("Capability plugin manager is unavailable")

        pack_path = (
            self.settings_path.parent
            / "capabilities"
            / "packs"
            / pack_id
            / f"{version}.py"
        ).resolve(strict=True)
        trusted_root = (
            self.settings_path.parent / "capabilities" / "packs"
        ).resolve(strict=True)
        if not pack_path.is_relative_to(trusted_root) or not pack_path.is_file():
            raise ValueError("Capability pack path is outside the managed pack directory")
        actual_hash = hashlib.sha256(pack_path.read_bytes()).hexdigest()
        if actual_hash.casefold() != expected_hash.casefold():
            raise ValueError("Installed capability pack failed SHA-256 verification")

        name = await self.plugin_manager.load_installed_pack(str(pack_path))
        return {"loaded": True, "plugin": name}

    async def _dispatch_event(self, message_type: str, payload: dict) -> None:
        if message_type == "BROWSER_PAGE_UPDATE":
            self._update_browser_page(payload)
        elif message_type == "BROWSER_PAGE_CLEAR":
            clear_current_page()
        elif message_type == "BROWSER_SESSION_UPDATE":
            session_id = payload.get("session_id")
            url = payload.get("url")
            if (
                not isinstance(session_id, str)
                or not isinstance(url, str)
                or len(session_id) > 20
                or len(url) > 4096
            ):
                raise ValueError("BROWSER_SESSION_UPDATE contains invalid session data")
            parsed_url = urlparse(url)
            if (
                parsed_url.scheme not in {"http", "https"}
                or not parsed_url.netloc
                or parsed_url.username is not None
                or parsed_url.password is not None
            ):
                raise ValueError("BROWSER_SESSION_UPDATE requires a safe HTTP or HTTPS URL")
            try:
                from services.agent.tools.browser_control_tool import set_active_extension_session
            except ImportError:
                from ..tools.browser_control_tool import set_active_extension_session
            set_active_extension_session(session_id, url)
        elif message_type == "USER_TEXT":
            text = payload.get("text")
            if not isinstance(text, str) or (not text.strip() and not payload.get("attachments")):
                raise ValueError("USER_TEXT requires text or at least one attachment")
            input_source = payload.get("input_source")
            source_device_id = payload.get("source_device_id")
            if input_source is not None:
                if (
                    input_source != "mobile"
                    or not isinstance(source_device_id, str)
                    or re.fullmatch(r"[A-Za-z0-9_-]{20,64}", source_device_id) is None
                    or payload.get("conversation_id") != f"mobile_{source_device_id}"
                ):
                    raise ValueError("Mobile USER_TEXT metadata is invalid")
                if len(text) > 50_000:
                    raise ValueError("Mobile USER_TEXT exceeds the 50000-character limit")
            event_payload = {"text": text}
            if input_source == "mobile":
                event_payload.update({
                    "input_source": "mobile",
                    "source_device_id": source_device_id,
                })
            attachments = payload.get("attachments", [])
            if not isinstance(attachments, list) or len(attachments) > 10:
                raise ValueError("USER_TEXT attachments must be a list with at most 10 items")
            safe_attachments = []
            total_bytes = 0
            for attachment in attachments:
                if not isinstance(attachment, dict):
                    raise ValueError("USER_TEXT attachment must be an object")
                name = attachment.get("name")
                mime_type = attachment.get("mime_type")
                data = attachment.get("data_base64")
                if not isinstance(name, str) or not name or len(name) > 255:
                    raise ValueError("USER_TEXT attachment has an invalid name")
                if not isinstance(mime_type, str) or len(mime_type) > 127:
                    raise ValueError("USER_TEXT attachment has an invalid MIME type")
                if not isinstance(data, str) or len(data) > 12_000_000:
                    raise ValueError("USER_TEXT attachment is too large")
                try:
                    raw = base64.b64decode(data, validate=True)
                except (ValueError, TypeError):
                    raise ValueError("USER_TEXT attachment is not valid base64") from None
                total_bytes += len(raw)
                if total_bytes > MAX_USER_TEXT_ATTACHMENT_BYTES:
                    raise ValueError("USER_TEXT attachments exceed the 8 MB limit")
                safe_attachments.append({"name": name, "mime_type": mime_type, "data_base64": data})
            if safe_attachments:
                event_payload["attachments"] = safe_attachments
            conversation_id = payload.get("conversation_id")
            conversation_history = payload.get("conversation_history")
            if conversation_id is not None:
                if not isinstance(conversation_id, str) or not conversation_id:
                    raise ValueError("USER_TEXT conversation_id must be a non-empty string")
                if not isinstance(conversation_history, list):
                    raise ValueError("USER_TEXT conversation_history must be a list")
                history = []
                for message in conversation_history:
                    if (
                        not isinstance(message, dict)
                        or message.get("role") not in {"user", "assistant"}
                        or not isinstance(message.get("content"), str)
                    ):
                        raise ValueError("USER_TEXT conversation_history has an invalid message")
                    history.append({
                        "role": message["role"],
                        "content": message["content"],
                    })
                event_payload.update({
                    "conversation_id": conversation_id,
                    "conversation_history": history,
                })
            await self.task_manager.event_bus.publish("USER_TEXT", event_payload)
            # EventBus invokes subscribers as scheduled tasks; yield once so
            # request callers observe the event before dispatch returns.
            import asyncio
            await asyncio.sleep(0)
        elif message_type == "TASK_CANCEL":
            task_id = payload.get("task_id")
            if not isinstance(task_id, str) or not task_id:
                raise ValueError("TASK_CANCEL requires a task_id")
            await self.task_manager.cancel(task_id)
        elif message_type == "TASK_CANCEL_ALL":
            for task in await self.task_manager.get_running_tasks():
                await self.task_manager.cancel(task.id)
        elif message_type in {"CONFIRMATION_GRANTED", "CONFIRMATION_REJECTED", "CAPABILITY_RESOLVED"}:
            await self.task_manager.event_bus.publish(message_type, payload)
        elif message_type == "DESKTOP_STREAM_START":
            source_device_id = payload.get("source_device_id")
            if not isinstance(source_device_id, str) or re.fullmatch(r"[A-Za-z0-9_-]{20,64}", source_device_id) is None:
                raise ValueError("Invalid source_device_id for DESKTOP_STREAM_START")
            fps = payload.get("fps", 10)
            if not isinstance(fps, int) or fps < 1 or fps > 30:
                fps = 10
            streamer = self._get_or_create_desktop_streamer(fps=fps)
            streamer.start(source_device_id)
        elif message_type == "DESKTOP_STREAM_STOP":
            source_device_id = payload.get("source_device_id")
            if isinstance(source_device_id, str) and self._desktop_streamer:
                self._desktop_streamer.stop(source_device_id)
        elif message_type == "REMOTE_CONTROL_MOUSE":
            await self._handle_remote_mouse(payload)
        elif message_type == "REMOTE_CONTROL_KEYBOARD":
            await self._handle_remote_keyboard(payload)
        else:
            raise ValueError(f"Unsupported desktop event: {message_type}")

    def _get_or_create_desktop_streamer(self, fps: int = 10):
        if self._desktop_streamer is None:
            try:
                from services.agent.perception.screen_engine import ScreenEngine
                from services.agent.core.desktop_streamer import DesktopStreamer
            except ImportError:
                from ..perception.screen_engine import ScreenEngine
                from .desktop_streamer import DesktopStreamer
            screen_engine = ScreenEngine()
            async def publish_frame(event_name: str, frame_payload: dict):
                await self.task_manager.event_bus.publish(event_name, frame_payload)
            self._desktop_streamer = DesktopStreamer(publish_frame, screen_engine, fps=fps)
        return self._desktop_streamer

    async def _handle_remote_mouse(self, payload: dict) -> None:
        try:
            import pyautogui
        except Exception:
            return
        action = payload.get("action")
        x_ratio = payload.get("x_ratio")
        y_ratio = payload.get("y_ratio")
        button = payload.get("button", "left")
        scroll_amount = payload.get("amount", 0)

        screen_w, screen_h = pyautogui.size()
        if isinstance(x_ratio, (int, float)) and isinstance(y_ratio, (int, float)):
            target_x = max(0, min(screen_w - 1, int(x_ratio * screen_w)))
            target_y = max(0, min(screen_h - 1, int(y_ratio * screen_h)))
        else:
            target_x, target_y = None, None

        if action == "move" and target_x is not None:
            await asyncio.to_thread(pyautogui.moveTo, target_x, target_y)
        elif action == "click" and target_x is not None:
            btn = button if button in {"left", "middle", "right"} else "left"
            await asyncio.to_thread(pyautogui.click, x=target_x, y=target_y, button=btn)
        elif action == "double_click" and target_x is not None:
            await asyncio.to_thread(pyautogui.doubleClick, x=target_x, y=target_y)
        elif action == "right_click" and target_x is not None:
            await asyncio.to_thread(pyautogui.rightClick, x=target_x, y=target_y)
        elif action == "drag" and target_x is not None:
            await asyncio.to_thread(pyautogui.dragTo, target_x, target_y, duration=0.2, button="left")
        elif action == "scroll":
            if target_x is not None and target_y is not None:
                await asyncio.to_thread(pyautogui.moveTo, target_x, target_y)
            if isinstance(scroll_amount, int) and -10 <= scroll_amount <= 10:
                await asyncio.to_thread(pyautogui.scroll, scroll_amount * 100)

    async def _handle_remote_keyboard(self, payload: dict) -> None:
        try:
            import pyautogui
        except Exception:
            return
        text = payload.get("text")
        key = payload.get("key")
        if isinstance(text, str) and text:
            await asyncio.to_thread(pyautogui.write, text[:1000], 0.01)
        elif isinstance(key, str) and key:
            safe_key = key.lower().strip()
            allowed = {
                "enter", "tab", "esc", "backspace", "space", "up", "down",
                "left", "right", "home", "end", "delete", "return",
            }
            if safe_key in allowed:
                await asyncio.to_thread(pyautogui.press, safe_key)

    @staticmethod
    def _update_browser_page(payload: dict) -> None:
        title = payload.get("title")
        url = payload.get("url")
        text = payload.get("text")
        captured_at = payload.get("captured_at")
        if (
            not isinstance(title, str)
            or not isinstance(url, str)
            or not isinstance(text, str)
            or not isinstance(captured_at, str)
            or len(title) > 500
            or len(url) > 4096
            or len(text) > 80000
        ):
            raise ValueError("BROWSER_PAGE_UPDATE contains invalid page data")

        parsed_url = urlparse(url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("BROWSER_PAGE_UPDATE requires an HTTP or HTTPS page URL")

        raw_links = payload.get("links", [])
        raw_forms = payload.get("forms", [])
        if (
            not isinstance(raw_links, list)
            or len(raw_links) > 120
            or not isinstance(raw_forms, list)
            or len(raw_forms) > 80
        ):
            raise ValueError("BROWSER_PAGE_UPDATE contains too many links or form fields")

        links = []
        for link in raw_links:
            if not isinstance(link, dict):
                continue
            link_text = link.get("text")
            link_url = link.get("url")
            if (
                isinstance(link_text, str)
                and len(link_text) <= 300
                and isinstance(link_url, str)
                and len(link_url) <= 4096
                and urlparse(link_url).scheme in {"http", "https"}
            ):
                links.append({"text": link_text, "url": link_url})

        forms = []
        for form in raw_forms:
            if not isinstance(form, dict):
                continue
            label = form.get("label")
            field_type = form.get("type")
            if (
                isinstance(label, str)
                and len(label) <= 300
                and isinstance(field_type, str)
                and len(field_type) <= 40
            ):
                forms.append({"label": label, "type": field_type})

        update_current_page({
            "title": title,
            "url": url,
            "text": text,
            "links": links,
            "forms": forms,
            "captured_at": captured_at,
        })

    async def _get_tasks(self) -> list[dict]:
        tasks = await self.task_manager.get_tasks()
        result = []
        for task in tasks:
            serialized = _serialize_task_for_desktop(task)
            serialized["error"] = _safe_task_failure_message(
                getattr(task, "error", None),
                getattr(task, "provider", None),
            )
            result.append(serialized)
        return result

    async def _get_providers(self) -> list[dict]:
        result = []
        provider_ids = ["openai", "anthropic", "google", "groq", "openrouter"] + [
            provider_id
            for provider_id in self.provider_registry._providers
            if provider_id.startswith("custom_")
        ]
        for provider_id in provider_ids:
            provider = self.provider_registry.get_registered_provider(provider_id)
            keys = self.key_manager.keys.get(provider_id, [])
            states = self.key_manager.key_states.get(provider_id, {})
            configured = any(keys)
            models_available = len(self.capability_registry.get_models_for_provider(provider_id)) if configured else 0
            result.append({
                "id": provider_id,
                "name": provider.provider_name if provider else provider_id.title(),
                "configured": configured,
                "keys": [
                    {
                        "slot": slot + 1,
                        "health": states[slot]["health"].value.lower()
                        if slot in states else "unconfigured",
                        "configured": bool(key),
                    }
                    for slot, key in enumerate(keys)
                ],
                "models_available": models_available,
            })
        return result

    async def _get_models(self, requirements: dict) -> list[dict]:
        """Return all available models: BYOK-configured + free/ollama (always available)."""
        configured = set(self.key_manager.get_configured_providers())
        # Free and ollama providers are available regardless of key configuration
        always_available = {"free", "ollama", "llama_server"}
        all_provider_filter = list(configured | always_available)
        required = {
            name: True
            for name, value in requirements.items()
            if value is True
        }
        models = self.capability_registry.filter_by_capabilities(
            required,
            provider_filter=all_provider_filter,
        )
        return [_serialize(model) for model in models]

    async def _get_model_catalog(self) -> dict:
        """Return the full model catalog with access metadata for the UI."""
        configured = set(self.key_manager.get_configured_providers())
        ollama_mgr = get_ollama_manager()
        ollama_running = await ollama_mgr.is_running()
        ollama_installed_names: set = set()
        if ollama_running:
            installed = await ollama_mgr.list_installed()
            ollama_installed_names = {m.name for m in installed}

        categories: dict = {"byok": [], "free_tier": [], "local": []}
        for entry in MODEL_CATALOG:
            provider = entry.get("provider", "")
            item = {
                "id": entry.get("id"),
                "display_name": entry.get("display_name"),
                "provider": provider,
                "model_type": entry.get("model_type", ""),
                "access_type": entry.get("access_type", ""),
                "weight_source": entry.get("weight_source"),
                "size_gb": entry.get("size_gb"),
                "note": entry.get("note"),
                "capabilities": entry.get("capabilities", {}),
                "status": "AVAILABLE",
            }
            if provider == "ollama":
                model_id = entry.get("id", "")
                item["ollama_running"] = ollama_running
                item["installed"] = model_id in ollama_installed_names
                item["status"] = (
                    "READY" if item["installed"]
                    else ("AVAILABLE" if ollama_running else "UNAVAILABLE")
                )
                categories["local"].append(item)
            elif provider == "free":
                has_key = "free" in configured or bool(os.environ.get("OPENROUTER_API_KEY"))
                item["status"] = "AVAILABLE" if has_key else "AUTH_REQUIRED"
                item["auth_note"] = "Requiere tu propia OPENROUTER_API_KEY"
                categories["free_tier"].append(item)
            else:
                item["configured"] = provider in configured
                item["status"] = "AVAILABLE" if provider in configured else "AUTH_REQUIRED"
                categories["byok"].append(item)

        return {
            "categories": categories,
            "ollama_status": {
                "installed": ollama_mgr.is_installed(),
                "running": ollama_running,
                "install_hint": ollama_mgr.get_install_command() if not ollama_mgr.is_installed() else None,
            },
        }

    async def _get_ollama_status(self) -> dict:
        """Return Ollama runtime status for the UI."""
        return await get_ollama_manager().get_status()

    async def _pull_ollama_model(self, payload: dict) -> dict:
        """Start or cancel an Ollama model pull."""
        model_name = payload.get("model")
        action = payload.get("action", "start")
        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError("model name is required")
        model_name = model_name.strip()
        mgr = get_ollama_manager()

        if action == "cancel":
            cancelled = mgr.cancel_pull(model_name)
            return {"model": model_name, "action": "cancel", "cancelled": cancelled}

        if mgr.is_pulling(model_name):
            return {"model": model_name, "status": "INSTALLING", "message": "Ya hay una descarga en curso."}

        size_gb = 0.0
        for entry in MODEL_CATALOG:
            if entry.get("id") == model_name and entry.get("provider") == "ollama":
                size_gb = float(entry.get("size_gb") or 0)
                break
        if size_gb > 0:
            hw = mgr.check_hardware(size_gb)
            if not hw.ok:
                return {
                    "model": model_name,
                    "status": "INCOMPATIBLE",
                    "issues": hw.issues,
                    "free_disk_gb": hw.free_disk_gb,
                    "free_ram_gb": hw.free_ram_gb,
                }

        mgr.start_pull_task(model_name)
        return {"model": model_name, "status": "INSTALLING", "size_gb": size_gb}

    async def _get_subagent_profiles(self) -> list[dict]:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        return [
            profile.public_dict()
            for profile in self.agent_manager.profile_store.list_profiles()
        ]

    async def _get_subagent_status(self) -> list[dict]:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        records = await self.agent_manager.get_all_statuses()
        safe_fields = (
            "agent_id", "parent_id", "profile_id", "name", "color", "role",
            "status", "created_at", "started_at", "completed_at",
        )
        task_progress = (
            await self.task_manager.get_task_progress(
                record["agent_id"] for record in records
            )
            if self.task_manager is not None
            else {}
        )
        result = []
        for record in records:
            status = {key: record[key] for key in safe_fields if key in record}
            if record.get("status") == "failed":
                status["error"] = _safe_task_failure_message(
                    record.get("error"),
                    record.get("provider"),
                )
            task = task_progress.get(record["agent_id"])
            if task is not None:
                status["progress"] = max(0, min(100, int(task["progress"])))
                if "current_action" in task:
                    status["current_action"] = task["current_action"]
            result.append(status)
        return result

    async def _get_subagent_routing_options(self) -> dict:
        providers = []
        models = []
        configured = set(self.key_manager.get_configured_providers())
        # Include free and ollama providers alongside BYOK providers
        no_key_providers = {"free", "ollama", "llama_server"}
        all_providers = sorted(configured | no_key_providers)
        for provider_id in all_providers:
            provider_obj = self.provider_registry.get_registered_provider(provider_id)
            if provider_id in no_key_providers:
                # No key slots for keyless providers
                providers.append({
                    "id": provider_id,
                    "name": provider_obj.provider_name if provider_obj else provider_id,
                    "key_slots": [],
                    "no_key_required": True,
                })
            else:
                slots = [
                    slot
                    for slot, _secret in self.key_manager.get_available_keys(provider_id)
                ]
                providers.append({
                    "id": provider_id,
                    "name": provider_obj.provider_name if provider_obj else provider_id,
                    "key_slots": slots,
                })
            if self.provider_registry.is_provider_available(provider_id):
                models.extend(
                    {
                        "id": model.id,
                        "name": model.display_name,
                        "provider": model.provider,
                        "access_type": getattr(model, "access_type", None),
                    }
                    for model in self.capability_registry.get_models_for_provider(provider_id)
                    if model.enabled
                )
        return {"providers": providers, "models": models}

    async def _set_subagent_route(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        provider = payload.get("provider")
        model_id = payload.get("model")
        key_slot = payload.get("key_slot")
        if not isinstance(profile_id, str):
            raise ValueError("Subagent profile id is required.")
        if provider is None and model_id is None and key_slot is None:
            profile = self.agent_manager.profile_store.assign_route(
                profile_id, None, None, None
            )
            return profile.public_dict()
        no_key_providers = {"free", "ollama", "llama_server"}
        if not isinstance(provider, str) or not isinstance(model_id, str):
            raise ValueError("A model route requires provider and model.")
        if provider in no_key_providers:
            # Keyless providers use slot 0 by convention
            key_slot = 0
        else:
            if (
                not isinstance(key_slot, int)
                or isinstance(key_slot, bool)
                or key_slot < 0
            ):
                raise ValueError("A model route requires provider, model, and key slot.")
        if not any(
            model.id == model_id and model.provider == provider and model.enabled
            for model in self.capability_registry.get_models_for_provider(provider)
        ):
            raise ValueError("The selected model is not available for that provider.")
        if provider not in no_key_providers and not any(
            slot == key_slot
            for slot, _secret in self.key_manager.get_available_keys(provider)
        ):
            raise ValueError("The selected API key slot is not currently available.")
        profile = self.agent_manager.profile_store.assign_route(
            profile_id, provider, model_id, key_slot
        )
        return profile.public_dict()

    async def _create_subagent_profile(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        return self.agent_manager.create_profile(
            name=payload.get("name", ""),
            role=payload.get("role", ""),
            description=payload.get("description", ""),
            capabilities=payload.get("capabilities", []),
            color=payload.get("color", ""),
            instructions=payload.get("instructions", ""),
            created_by="user",
        )

    async def _update_subagent_profile(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        if not isinstance(profile_id, str):
            raise ValueError("Subagent profile id is required.")
        return self.agent_manager.update_profile(
            profile_id,
            name=payload.get("name", ""),
            role=payload.get("role", ""),
            description=payload.get("description", ""),
            capabilities=payload.get("capabilities", []),
            color=payload.get("color", ""),
            instructions=payload.get("instructions", ""),
        )

    async def _chat_subagent(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        message = payload.get("message")
        if not isinstance(profile_id, str) or not isinstance(message, str):
            raise ValueError("A subagent profile and message are required.")
        return await self.agent_manager.chat_with_agent(profile_id, message)

    async def _get_subagent_memories(self, payload: dict) -> list[dict]:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        if not isinstance(profile_id, str):
            raise ValueError("Subagent profile id is required.")
        return self.agent_manager.get_profile_memories(profile_id)

    async def _save_subagent_memory(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        text = payload.get("text")
        category = payload.get("category", "general")
        if not isinstance(profile_id, str) or not isinstance(text, str) or not isinstance(category, str):
            raise ValueError("Subagent memory fields are invalid.")
        return self.agent_manager.save_profile_memory(profile_id, text, category)

    async def _update_subagent_memory(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        memory_id = payload.get("memory_id")
        text = payload.get("text")
        category = payload.get("category", "general")
        if (
            not isinstance(profile_id, str)
            or not isinstance(memory_id, str)
            or not isinstance(text, str)
            or not isinstance(category, str)
        ):
            raise ValueError("Subagent memory fields are invalid.")
        updated = self.agent_manager.update_profile_memory(
            profile_id, memory_id, text, category
        )
        if updated is None:
            raise ValueError(f"Subagent memory {memory_id} does not exist.")
        return updated

    async def _delete_subagent_memory(self, payload: dict) -> dict:
        if self.agent_manager is None:
            raise RuntimeError("Subagent management is unavailable.")
        profile_id = payload.get("profile_id")
        memory_id = payload.get("memory_id")
        if not isinstance(profile_id, str) or not isinstance(memory_id, str):
            raise ValueError("Subagent profile and memory ids are required.")
        deleted = self.agent_manager.delete_profile_memory(profile_id, memory_id)
        if not deleted:
            raise ValueError(f"Subagent memory {memory_id} does not exist.")
        return {"deleted": True, "memory_id": memory_id}

    def get_settings(self) -> dict:
        settings = dict(DEFAULT_SETTINGS)
        settings["camera_enabled"] = os.environ.get(
            "CAMERA_ENABLED",
            os.environ.get("HELIX_CAMERA_ENABLED_BY_DEFAULT", "false"),
        ).lower() == "true"
        try:
            settings["camera_device_index"] = int(os.environ.get("CAMERA_DEVICE_INDEX", "0"))
        except ValueError:
            raise ValueError("CAMERA_DEVICE_INDEX must be an integer") from None
        try:
            settings["gesture_sensitivity"] = float(os.environ.get("GESTURE_SENSITIVITY", "0.8"))
        except ValueError:
            raise ValueError("GESTURE_SENSITIVITY must be a number") from None
        if self.settings_path.exists():
            with self.settings_path.open("r", encoding="utf-8") as settings_file:
                saved = json.load(settings_file)
            if not isinstance(saved, dict):
                raise ValueError("Saved settings must be a JSON object")
            settings.update(saved)
            interval = settings.get("continuous_screen_vision_interval_ms")
            if (
                isinstance(interval, int)
                and not isinstance(interval, bool)
                and interval < MIN_SCREEN_VISION_INTERVAL_MS
            ):
                settings["continuous_screen_vision_interval_ms"] = (
                    MIN_SCREEN_VISION_INTERVAL_MS
                )
            if not saved.get("_cross_provider_failover_migrated"):
                settings["cross_provider_fallback"] = True
                settings["_cross_provider_failover_migrated"] = True
            # Older builds accepted endpoint API keys directly in settings.
            # Never return those values to the renderer or keep them in the
            # JSON file; credentials belong in the OS credential vault.
            settings["custom_endpoints"] = self._redact_custom_endpoint_keys(
                settings.get("custom_endpoints", [])
            )
            # Accept both names so settings written by older/newer desktop
            # clients continue to control the same runtime policy.
            if "permission_mode" not in saved and "permissions_mode" in saved:
                settings["permission_mode"] = saved["permissions_mode"]
            elif "permissions_mode" not in saved and "permission_mode" in saved:
                settings["permissions_mode"] = saved["permission_mode"]
        self._apply_runtime_settings(settings)
        settings["subagents_available"] = True
        return settings

    def _apply_runtime_settings(self, settings: dict) -> None:
        for setting in (
            "screen_context_enabled",
            "model_decides_screen_vision_enabled",
            "continuous_screen_vision_enabled",
            "complex_workflows_enabled",
            "gesture_window_sequence_enabled",
        ):
            if not isinstance(settings.get(setting, False), bool):
                raise ValueError(f"{setting} must be a boolean")
        if not isinstance(settings.get("activation_phrase_enabled", True), bool):
            raise ValueError("activation_phrase_enabled must be a boolean")
        if settings.get("floating_ui_mode", "full") not in {"full", "suppressed"}:
            raise ValueError("floating_ui_mode must be full or suppressed")
        validate_screen_vision_interval_ms(
            settings.get(
                "continuous_screen_vision_interval_ms",
                DEFAULT_SCREEN_VISION_INTERVAL_MS,
            )
        )
        wake_word_threshold = settings.get("wake_word_threshold", 0.5)
        if (
            isinstance(wake_word_threshold, bool)
            or not isinstance(wake_word_threshold, (int, float))
            or not 0.1 <= wake_word_threshold <= 0.9
        ):
            raise ValueError("wake_word_threshold must be between 0.1 and 0.9")
        sensitivity = settings.get("gesture_sensitivity", 0.8)
        if (
            isinstance(sensitivity, bool)
            or not isinstance(sensitivity, (int, float))
            or not 0.5 <= sensitivity <= 1.0
        ):
            raise ValueError("gesture_sensitivity must be between 0.5 and 1.0")
        mode = str(settings.get("permission_mode", settings.get("permissions_mode", "SMART_APPROVAL"))).upper()
        if mode not in {"ALWAYS_ASK", "AUTO_APPROVE", "SMART_APPROVAL"}:
            raise ValueError(
                "permissions_mode must be ALWAYS_ASK, AUTO_APPROVE, or SMART_APPROVAL"
            )
        model_request_timeout = settings.get("model_request_timeout_seconds", 90)
        if (
            isinstance(model_request_timeout, bool)
            or not isinstance(model_request_timeout, (int, float))
            or not 15 <= model_request_timeout <= 300
        ):
            raise ValueError(
                "model_request_timeout_seconds must be between 15 and 300"
            )
        if self.fallback_manager is not None:
            self.fallback_manager.fallback_enabled = bool(
                settings.get("fallback_enabled", True)
            )
            self.fallback_manager.cross_provider_fallback = bool(
                settings.get("cross_provider_fallback", True)
            )
        if self.model_router is not None:
            self.model_router.default_cost_preference = settings.get(
                "cost_preference", "balanced"
            )
            self.model_router.default_speed_preference = settings.get(
                "speed_preference", "balanced"
            )
            self.model_router.default_quality_preference = settings.get(
                "quality_preference", "balanced"
            )
            self.model_router.default_provider = settings.get("preferred_provider")
            self.model_router.default_model = settings.get("default_model")
        self._configure_custom_endpoints(settings)
        self._configure_custom_models(settings)
        browser_mode = settings.get("browser_control_mode")
        if browser_mode in {"playwright", "extension"}:
            import os
            os.environ["HELIX_BROWSER_CONTROL_MODE"] = browser_mode
        if self.memory_manager is not None:
            self.memory_manager.configure(settings)
        if self.react_loop is not None:
            self.react_loop.on_demand_screen_context_enabled = settings.get(
                "screen_context_enabled", False
            )
            self.react_loop.screen_context_enabled = settings.get(
                "screen_context_enabled", False
            )
            self.react_loop.continuous_screen_vision_enabled = settings.get(
                "continuous_screen_vision_enabled", False
            )
            self.react_loop.complex_workflows_enabled = settings.get(
                "complex_workflows_enabled",
                False,
            )
            self.react_loop.model_decides_screen_vision_enabled = settings.get(
                "model_decides_screen_vision_enabled", False
            )
            ceiling = settings.get("auto_approve_up_to", "LOW_RISK")
            if ceiling not in {"READ_ONLY", "LOW_RISK", "MODIFY"}:
                raise ValueError(
                    "auto_approve_up_to must be READ_ONLY, LOW_RISK, or MODIFY"
                )
            self.react_loop.auto_approve_up_to = ceiling
            self.react_loop.permissions_mode = mode
            self.react_loop.tool_verification_enabled = bool(
                settings.get("tool_verification_enabled", True)
            )
            self.react_loop.model_request_timeout_seconds = int(model_request_timeout)
        if self.permission_manager is not None:
            self.permission_manager.configure(
                mode=mode,
                protected_paths=settings.get("protected_paths", []),
                protected_apps=settings.get("protected_apps", []),
            )

    def _configure_custom_endpoints(self, settings: dict) -> None:
        endpoints = settings.get("custom_endpoints", [])
        if not isinstance(endpoints, list):
            return
        active_ids = set()
        for endpoint in endpoints:
            if not isinstance(endpoint, dict) or endpoint.get("enabled", True) is False:
                continue
            endpoint_id = endpoint.get("id")
            base_url = endpoint.get("baseUrl") or endpoint.get("base_url")
            if not isinstance(endpoint_id, str) or not isinstance(base_url, str):
                continue
            self.key_manager.configure_custom_endpoint(endpoint_id, allow_empty=True)
            self.provider_registry.register_provider(
                OpenAICompatibleProvider(
                    endpoint_id,
                    str(endpoint.get("name") or endpoint_id),
                    base_url,
                )
            )
            active_ids.add(endpoint_id)
        for provider_id in list(self.key_manager.keys):
            if provider_id.startswith("custom_") and provider_id not in active_ids:
                self.key_manager.keys.pop(provider_id, None)
                self.key_manager.key_states.pop(provider_id, None)

    def _configure_custom_models(self, settings: dict) -> None:
        for provider_id in list(self.provider_registry._providers):
            if provider_id.startswith("custom_"):
                self.capability_registry.remove_provider_models(provider_id)
        models = settings.get("custom_models", [])
        if not isinstance(models, list):
            return
        parsed = []
        for raw in models:
            if not isinstance(raw, dict) or not raw.get("id") or not raw.get("provider"):
                continue
            caps = raw.get("capabilities") if isinstance(raw.get("capabilities"), dict) else {}
            parsed.append(ModelDefinition(
                id=str(raw["id"]),
                provider=str(raw["provider"]),
                display_name=str(raw.get("display_name") or raw["id"]),
                capabilities=ModelCapabilities(**{
                    field: caps[field]
                    for field in ModelCapabilities.__dataclass_fields__
                    if field in caps
                }),
                priority=int(raw.get("priority", 0)),
                enabled=bool(raw.get("enabled", True)),
                fallback_group=raw.get("fallback_group"),
            ))
        self.capability_registry.register_models(parsed)
        for provider_id in {model.provider for model in parsed}:
            provider = self.provider_registry.get_registered_provider(provider_id)
            if isinstance(provider, OpenAICompatibleProvider):
                provider._models = [model for model in parsed if model.provider == provider_id]

    async def _get_settings(self) -> dict:
        return self.get_settings()

    async def _test_tts(self, payload: dict) -> dict:
        settings = self.get_settings()
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip():
            text = "HELIX audio output test. Your configured voice pipeline is active."
        provider = {
            "openai_tts": "openai",
            "elevenlabs": "elevenlabs",
            "edge_tts": "edge_tts",
            "windows_sapi": "system",
        }.get(settings.get("voice_tts_provider", "edge_tts"), "edge_tts")
        voice_id = settings.get("voice_tts_voice", "en-US-AndrewMultilingualNeural")
        model = settings.get("tts_model", os.environ.get("TTS_MODEL", "tts-1"))
        try:
            from services.agent.perception.text_to_speech import TextToSpeech
        except ImportError:
            from perception.text_to_speech import TextToSpeech
        key_info = self.key_manager.get_available_key("openai")
        api_key = key_info[1] if key_info else None
        if provider == "elevenlabs":
            api_key = os.environ.get("ELEVENLABS_API_KEY")
        tts = TextToSpeech(
            provider=provider,
            model=model,
            api_key=api_key,
            voice_id=voice_id,
        )
        fallback_used = getattr(tts, "provider", provider) != provider
        if fallback_used:
            await tts.speak(text)
            return {
                "ok": True,
                "provider": getattr(tts, "provider", "system"),
                "fallback_used": True,
                "error": f"The configured {provider} provider has no API key.",
            }
        try:
            await tts.speak(text)
        except Exception as error:
            if getattr(tts, "provider", provider) == "system":
                raise
            fallback_used = True
            fallback = TextToSpeech(provider="system")
            await fallback.speak(text)
            return {
                "ok": True,
                "provider": "system",
                "fallback_used": fallback_used,
                "error": str(error),
            }
        return {"ok": True, "provider": getattr(tts, "provider", provider), "fallback_used": fallback_used}

    async def _get_memory_status(self) -> dict:
        if self.memory_manager is None:
            return {
                "pgvector_ready": False,
                "provider": "local",
                "embedding_model": "none",
                "similarity_threshold": 0,
                "dimensions": None,
                "message": "Memory manager is not available.",
            }
        status = getattr(self.memory_manager, "status", None)
        if callable(status):
            result = status()
            return await result if asyncio.iscoroutine(result) else result
        return {
            "pgvector_ready": False,
            "provider": "local",
            "embedding_model": getattr(self.memory_manager, "embedding_model", "unknown"),
            "similarity_threshold": getattr(self.memory_manager, "similarity_threshold", 0),
            "dimensions": None,
            "message": "Memory manager does not expose pgvector status.",
        }

    async def _get_learning_stats(self) -> dict:
        """Returns adaptive learning harness statistics for the CLI /memory command."""
        try:
            try:
                from services.agent.learning.adaptive_harness import AdaptiveLearningHarness
            except ImportError:
                from ..learning.adaptive_harness import AdaptiveLearningHarness

            harness = AdaptiveLearningHarness.get_instance()

            ep_count = 0
            try:
                ep_count = harness.episodic_memory.get_episode_count()
            except Exception:
                pass

            profile = harness.procedural_memory.load_profile()
            rules_raw = profile.get("learned_rules", [])
            rule_count = len(rules_raw)
            correction_count = sum(1 for r in rules_raw if r.get("category") == "correction")

            top_rules = []
            for r in sorted(rules_raw, key=lambda x: x.get("confidence", 0), reverse=True)[:10]:
                top_rules.append({
                    "category": r.get("category", "general"),
                    "rule": r.get("rule_text", r.get("rule", "")),
                    "confidence": round(float(r.get("confidence", 0)), 2),
                    "uses": int(r.get("usage_count", r.get("uses", 0))),
                })

            skill_count = 0
            try:
                skill_count = len(list(harness.skill_manager.skills_dir.glob("*.json")))
            except Exception:
                pass

            last_episode_at = None
            try:
                last_episode_at = harness.episodic_memory.get_last_episode_timestamp()
            except Exception:
                pass

            user_md_exists = harness.feedforward_guide.user_md_path.exists()

            return {
                "episode_count": ep_count,
                "rule_count": rule_count,
                "correction_count": correction_count,
                "skill_count": skill_count,
                "top_rules": top_rules,
                "last_episode_at": last_episode_at,
                "user_md_exists": user_md_exists,
            }
        except Exception as e:
            return {
                "episode_count": 0,
                "rule_count": 0,
                "correction_count": 0,
                "skill_count": 0,
                "top_rules": [],
                "user_md_exists": False,
                "error": str(e),
            }

    async def _run_learning_maintenance(self) -> dict:
        """Runs the pruning / maintenance cycle of the adaptive learning harness."""
        try:
            try:
                from services.agent.learning.adaptive_harness import AdaptiveLearningHarness
            except ImportError:
                from ..learning.adaptive_harness import AdaptiveLearningHarness
            harness = AdaptiveLearningHarness.get_instance()
            result = harness.run_maintenance()
            return result
        except Exception as e:
            return {"error": str(e)}

    async def _list_free_models(self) -> dict:
        """Returns the catalog of 0-cost free models available via OpenRouter."""
        FREE_MODELS = [
            {"id": "meta-llama/llama-3.2-3b-instruct:free", "label": "Llama 3.2 3B Instruct", "provider": "free"},
            {"id": "qwen/qwen-2.5-coder-32b-instruct:free", "label": "Qwen 2.5 Coder 32B", "provider": "free"},
            {"id": "deepseek/deepseek-r1:free", "label": "DeepSeek R1", "provider": "free"},
            {"id": "google/gemini-flash-1.5:free", "label": "Gemini Flash 1.5", "provider": "free"},
        ]
        return {"models": FREE_MODELS}

    async def _clear_memory(self) -> dict:
        if self.memory_manager is None:
            raise RuntimeError("Memory manager is not available.")
        await self.memory_manager.clear_conversation_memory()
        return {"cleared": True}

    async def _get_user_memories(self) -> list[dict]:
        return UserMemoryManager.get_instance().load_all()

    async def _save_user_memory(self, payload: dict) -> dict:
        text = payload.get("text")
        category = payload.get("category", "general")
        if not isinstance(text, str) or not isinstance(category, str):
            raise ValueError("A memory text and category are required.")
        return UserMemoryManager.get_instance().add_memory(text, category)

    async def _update_user_memory(self, payload: dict) -> dict:
        memory_id = payload.get("memory_id")
        text = payload.get("text")
        category = payload.get("category")
        if not isinstance(memory_id, str) or not isinstance(text, str):
            raise ValueError("A memory ID and text are required.")
        if category is not None and not isinstance(category, str):
            raise ValueError("Memory category must be text.")
        memory = UserMemoryManager.get_instance().update_memory(
            memory_id, text, category
        )
        if memory is None:
            raise ValueError(f"Memory {memory_id} was not found.")
        return memory

    async def _delete_user_memory(self, payload: dict) -> dict:
        memory_id = payload.get("memory_id")
        if not isinstance(memory_id, str) or not memory_id.strip():
            raise ValueError("A memory ID is required.")
        deleted = UserMemoryManager.get_instance().delete_memory(memory_id)
        if not deleted:
            raise ValueError(f"Memory {memory_id} was not found.")
        return {"deleted": True, "memory_id": memory_id}

    async def _get_user_memory_profile(self) -> dict:
        """Return the unified user memory profile {summary, user_notes, updated_at}."""
        return UserMemoryManager.get_instance().get_profile()

    async def _update_user_memory_summary(self, payload: dict) -> dict:
        """Update the auto-generated Helix summary about the user."""
        summary = payload.get("summary", "")
        if not isinstance(summary, str):
            raise ValueError("summary must be a string.")
        return UserMemoryManager.get_instance().update_summary(summary)

    async def _update_user_notes(self, payload: dict) -> dict:
        """Update the user-written notes field."""
        notes = payload.get("notes", "")
        if not isinstance(notes, str):
            raise ValueError("notes must be a string.")
        return UserMemoryManager.get_instance().update_user_notes(notes)

    async def _clear_user_memory(self) -> dict:
        """Wipe all user memory (summary + notes)."""
        return UserMemoryManager.get_instance().clear_all()

    def _custom_skills_dir(self) -> Path:
        return self.settings_path.parent / "skills"

    @staticmethod
    def _skill_summary(skill, custom: bool) -> dict:
        return {
            "name": skill.name,
            "description": skill.description,
            "version": skill.version,
            "triggers": skill.triggers,
            "tools": skill.tools,
            "instructions": skill.instructions,
            "custom": custom,
        }

    async def _get_skills(self) -> list[dict]:
        if self.skill_registry is None:
            raise RuntimeError("Skill management is unavailable")
        custom_names = {
            path.parent.name
            for path in self._custom_skills_dir().glob("*/SKILL.md")
        }
        skills = self.skill_registry.get_all_skills()
        return [
            self._skill_summary(skill, skill.name in custom_names)
            for skill in sorted(skills, key=lambda item: item.name.casefold())
        ]

    async def _get_mcp_servers(self) -> list[dict]:
        servers = self.get_settings().get("mcp_servers", [])
        if self.mcp_status_provider is None:
            return servers
        return self.mcp_status_provider(servers)

    async def _get_capabilities(self) -> dict:
        settings = self.get_settings()
        return {
            "subagents_enabled": bool(settings.get("subagents_enabled", True)),
            "subagents_available": bool(settings.get("subagents_available", True)),
            "sandbox_enabled": bool(settings.get("sandbox_enabled", False)),
            "sandbox_mode": settings.get("sandbox_mode", "restricted"),
            "browser_engine": settings.get("browser_engine", "chromium"),
            "browser_headless": settings.get("browser_headless", True),
            "voice_enabled": bool(settings.get("voice_enabled", True)),
            "voice_response_enabled": bool(settings.get("voice_response_enabled", True)),
        }

    async def _save_skill(self, raw_skill: dict) -> dict:
        if self.skill_registry is None:
            raise RuntimeError("Skill management is unavailable")
        if not isinstance(raw_skill, dict):
            raise ValueError("SAVE_SKILL requires a skill object")

        name = raw_skill.get("name")
        description = raw_skill.get("description")
        instructions = raw_skill.get("instructions")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", name):
            raise ValueError("Skill name must be a lowercase slug (letters, numbers, _ or -)")
        if not isinstance(description, str) or not description.strip():
            raise ValueError("Skill description is required")
        if not isinstance(instructions, str) or not instructions.strip():
            raise ValueError("Skill instructions are required")

        custom_path = self._custom_skills_dir() / name / "SKILL.md"
        current_skill = self.skill_registry.get_skill(name)
        if current_skill and not custom_path.is_file():
            raise ValueError(f"Cannot replace built-in skill '{name}'")
        triggers = raw_skill.get("triggers", [])
        tools = raw_skill.get("tools", [])
        if not isinstance(triggers, list) or not all(isinstance(item, str) for item in triggers):
            raise ValueError("Skill triggers must be a list of strings")
        if not isinstance(tools, list) or not all(isinstance(item, str) for item in tools):
            raise ValueError("Skill tools must be a list of strings")

        frontmatter = [
            "---",
            f"name: {json.dumps(name)}",
            f"description: {json.dumps(description.strip())}",
            'version: "1.0.0"',
            f"triggers: {json.dumps(triggers, ensure_ascii=False)}",
            f"tools: {json.dumps(tools, ensure_ascii=False)}",
            "permissions: []",
            "---",
            "",
            instructions.strip(),
            "",
        ]
        custom_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = custom_path.with_suffix(".md.tmp")
        temporary_path.write_text("\n".join(frontmatter), encoding="utf-8")
        temporary_path.replace(custom_path)
        loaded_skill = self.skill_registry.skill_loader.load_from_file(str(custom_path))
        self.skill_registry.register_skill(loaded_skill)
        return self._skill_summary(loaded_skill, True)

    async def _delete_skill(self, name: str) -> None:
        if self.skill_registry is None:
            raise RuntimeError("Skill management is unavailable")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", name):
            raise ValueError("Invalid skill name")
        custom_path = self._custom_skills_dir() / name / "SKILL.md"
        if not custom_path.is_file():
            raise ValueError(f"'{name}' is not a custom skill")
        custom_path.unlink()
        try:
            custom_path.parent.rmdir()
        except OSError:
            pass
        self.skill_registry.unregister_skill(name)

    async def _save_settings(self, settings: dict) -> dict:
        if not isinstance(settings, dict):
            raise ValueError("SAVE_SETTINGS requires a settings object")
        if "subagents_enabled" in settings:
            if not isinstance(settings["subagents_enabled"], bool):
                raise ValueError("subagents_enabled must be a boolean")
        if "mcp_servers" in settings:
            servers = settings["mcp_servers"]
            if not isinstance(servers, list):
                raise ValueError("mcp_servers must be a list")
            names = set()
            for server in servers:
                if not isinstance(server, dict):
                    raise ValueError("Each MCP server must be an object")
                if "url" in server or "server_url" in server:
                    raise ValueError(
                        "MCP URL transport is not supported; configure a local stdio launch command."
                    )
                name = server.get("name")
                command = server.get("command")
                if (
                    not isinstance(name, str)
                    or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", name)
                ):
                    raise ValueError("MCP server names must be simple alphanumeric identifiers")
                if name in names:
                    raise ValueError(f"Duplicate MCP server name: {name}")
                names.add(name)
                if not isinstance(command, str) or not command.strip():
                    raise ValueError(f"MCP server '{name}' requires a launch command")
                if not isinstance(server.get("enabled", True), bool):
                    raise ValueError(f"MCP server '{name}' enabled must be a boolean")
        if "auto_approve_up_to" in settings and settings["auto_approve_up_to"] not in {
            "READ_ONLY",
            "LOW_RISK",
            "MODIFY",
        }:
            raise ValueError(
                "auto_approve_up_to must be READ_ONLY, LOW_RISK, or MODIFY"
            )
        requested_mode = settings.get("permission_mode", settings.get("permissions_mode"))
        if requested_mode is not None and str(requested_mode).upper() not in {
            "ALWAYS_ASK", "AUTO_APPROVE", "SMART_APPROVAL"
        }:
            raise ValueError(
                "permissions_mode must be ALWAYS_ASK, AUTO_APPROVE, or SMART_APPROVAL"
            )
        if "permission_mode" in settings and "permissions_mode" not in settings:
            settings = dict(settings)
            settings["permissions_mode"] = settings["permission_mode"]
        elif "permissions_mode" in settings and "permission_mode" not in settings:
            settings = dict(settings)
            settings["permission_mode"] = settings["permissions_mode"]
        incoming = deepcopy(settings)
        incoming.pop("subagents_available", None)
        for endpoint in incoming.get("custom_endpoints", []):
            if not isinstance(endpoint, dict):
                continue
            api_key = endpoint.pop("apiKey", None)
            if api_key:
                self.key_manager.save_custom_endpoint_key(endpoint.get("id", ""), api_key)
            endpoint.pop("api_key", None)
        merged = self.get_settings()
        merged.update(incoming)
        merged["subagents_available"] = True
        merged["custom_endpoints"] = self._redact_custom_endpoint_keys(
            merged.get("custom_endpoints", [])
        )
        self._apply_runtime_settings(merged)
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.settings_path.with_suffix(f"{self.settings_path.suffix}.tmp")
        with temporary_path.open("w", encoding="utf-8") as settings_file:
            persisted_settings = dict(merged)
            persisted_settings.pop("subagents_available", None)
            json.dump(persisted_settings, settings_file, indent=2)
        temporary_path.replace(self.settings_path)
        
        await self.task_manager.event_bus.publish("SETTINGS_UPDATED", merged)
        
        return merged

    def _redact_custom_endpoint_keys(self, endpoints: object) -> list[dict]:
        if not isinstance(endpoints, list):
            return []
        redacted = []
        for endpoint in endpoints:
            if not isinstance(endpoint, dict):
                continue
            safe_endpoint = {
                key: value
                for key, value in endpoint.items()
                if key not in {"apiKey", "api_key"}
            }
            endpoint_id = safe_endpoint.get("id")
            safe_endpoint["api_key_configured"] = bool(
                self.key_manager.has_custom_endpoint_key(endpoint_id)
            )
            redacted.append(safe_endpoint)
        return redacted

    async def _get_llama_server_status(self) -> dict:
        """Return llama-server runtime status, binary detection and local GGUF models."""
        return await get_llama_server_manager().get_status()

    async def _start_llama_server(self, payload: dict) -> dict:
        """Launch llama-server with the specified GGUF model."""
        model = payload.get("model")
        if not isinstance(model, str) or not model.strip():
            raise ValueError("Model path or name is required")
        context_size = int(payload.get("context_size", 4096))
        mgr = get_llama_server_manager()
        success = await mgr.start_server(model.strip(), context_size=context_size)
        return {"success": success, "status": await mgr.get_status()}

    async def _stop_llama_server(self) -> dict:
        """Stop the background llama-server process."""
        mgr = get_llama_server_manager()
        success = await mgr.stop_server()
        return {"success": success, "status": await mgr.get_status()}

    async def _download_llama_server(self) -> dict:
        """Download official llama-server portable binary."""
        mgr = get_llama_server_manager()
        progress = await mgr.download_binary()
        return {"status": progress.status, "done": progress.done, "error": progress.error, "server_status": await mgr.get_status()}

    async def _download_gguf_model(self, payload: dict) -> dict:
        """Download curated GGUF model directly from Hugging Face."""
        model_id = payload.get("model_id")
        if not isinstance(model_id, str) or not model_id.strip():
            raise ValueError("model_id is required")
        mgr = get_llama_server_manager()
        progress = await mgr.download_gguf_model(model_id.strip())
        return {"model_id": model_id, "status": progress.status, "done": progress.done, "error": progress.error, "server_status": await mgr.get_status()}

    async def _validate_key(self, payload: dict) -> str:
        provider_id = payload.get("provider")
        slot = payload.get("slot")
        api_key = payload.get("key")
        if provider_id not in {"openai", "anthropic", "google", "groq", "openrouter"}:
            raise ValueError("Unsupported API key provider")
        # The first three slots are the UI minimum, not a storage limit.  The
        # key manager supports an unbounded pool and the desktop UI can add
        # more slots as needed.
        if isinstance(slot, bool) or not isinstance(slot, int) or slot < 1:
            raise ValueError("API key slot must be a positive integer")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("A non-empty API key is required")

        provider = self.provider_registry.get_registered_provider(provider_id)
        if provider is None:
            raise ValueError(f"Provider is not registered: {provider_id}")
        health = await provider.validate_key(api_key)
        if getattr(health, "value", health).casefold() == "healthy":
            self.key_manager.save_key(provider_id, slot - 1, api_key)
            if callable(self.credentials_updated_callback):
                self.credentials_updated_callback()
        return health.value.lower()
