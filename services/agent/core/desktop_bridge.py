import json
import os
import re
import base64
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from services.agent.core.browser_page_context import update_current_page

try:
    from ..ai.base_provider import ModelDefinition, ModelCapabilities
    from ..ai.custom_provider import OpenAICompatibleProvider
except ImportError:
    from ai.base_provider import ModelDefinition, ModelCapabilities
    from ai.custom_provider import OpenAICompatibleProvider


DEFAULT_SETTINGS = {
    "voice_enabled": True,
    "wake_word": "hey helix",
    "wake_word_provider": "openwakeword",
    "wake_word_threshold": 0.5,
    "voice_tts_provider": "edge_tts",
    "voice_tts_voice": "en-US-AndrewMultilingualNeural",
    "vad_threshold": 250,
    "mcp_servers": [],
    "camera_enabled": False,
    "camera_device_index": 0,
    "gesture_sensitivity": 0.8,
    "start_with_windows": True,
    "start_minimized": True,
    "default_model": None,
    "preferred_provider": None,
    "fallback_enabled": True,
    "cross_provider_fallback": False,
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
    "ocr_engine": "local",
    "mouse_move_duration_ms": 200,
    "keystroke_delay_ms": 30,
    "pyautogui_fail_safe": True,
    "shell_type": "powershell",
    "shell_timeout_seconds": 60,
    "block_elevated_execution": True,
    "browser_engine": "chromium",
    "browser_headless": True,
    "search_provider": "google",
    "research_depth": 2,
    "block_downloads": True,
    "block_untrusted_domains": True,
    "always_on_top": True,
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
    "memory_auto_compaction": True,
    "embedding_model": "text-embedding-3-small",
    "memory_similarity_threshold": 0.75,
}


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
    serialized.pop("result", None)
    serialized.pop("metadata", None)
    return serialized


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
        self.mcp_status_provider = None

    async def dispatch(self, message: dict) -> dict:
        message_type = message.get("type")
        payload = message.get("payload") or {}
        request_id = message.get("request_id")
        handlers = {
            "GET_TASKS": self._get_tasks,
            "GET_PROVIDERS": self._get_providers,
            "GET_MODELS": lambda: self._get_models(payload.get("requirements") or {}),
            "GET_SETTINGS": self._get_settings,
            "SAVE_SETTINGS": lambda: self._save_settings(payload.get("settings")),
            "TEST_TTS": lambda: self._test_tts(payload),
            "GET_MEMORY_STATUS": self._get_memory_status,
            "CLEAR_MEMORY": self._clear_memory,
            "VALIDATE_KEY": lambda: self._validate_key(payload),
            "GET_SKILLS": self._get_skills,
            "SAVE_SKILL": lambda: self._save_skill(payload.get("skill")),
            "DELETE_SKILL": lambda: self._delete_skill(payload.get("name")),
            "GET_MCP_SERVERS": self._get_mcp_servers,
        }

        if request_id is None:
            await self._dispatch_event(message_type, payload)
            return {}

        handler = handlers.get(message_type)
        if handler is None:
            raise ValueError(f"Unsupported desktop request: {message_type}")

        result = await handler()
        return {"request_id": request_id, "payload": result}

    async def _dispatch_event(self, message_type: str, payload: dict) -> None:
        if message_type == "BROWSER_PAGE_UPDATE":
            self._update_browser_page(payload)
        elif message_type == "USER_TEXT":
            text = payload.get("text")
            if not isinstance(text, str) or (not text.strip() and not payload.get("attachments")):
                raise ValueError("USER_TEXT requires text or at least one attachment")
            event_payload = {"text": text}
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
                if total_bytes > 8 * 1024 * 1024:
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
        elif message_type in {"CONFIRMATION_GRANTED", "CONFIRMATION_REJECTED"}:
            await self.task_manager.event_bus.publish(message_type, payload)
        else:
            raise ValueError(f"Unsupported desktop event: {message_type}")

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
            serialized["error"] = None
            result.append(serialized)
        return result

    async def _get_providers(self) -> list[dict]:
        result = []
        provider_ids = ["openai", "anthropic", "google"] + [
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
        configured = set(self.key_manager.get_configured_providers())
        if not configured:
            return []
        required = {
            name: True
            for name, value in requirements.items()
            if value is True
        }
        models = self.capability_registry.filter_by_capabilities(
            required,
            provider_filter=list(configured),
        )
        return [_serialize(model) for model in models]

    def get_settings(self) -> dict:
        settings = dict(DEFAULT_SETTINGS)
        settings["camera_enabled"] = os.environ.get("CAMERA_ENABLED", "false").lower() == "true"
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
        return settings

    def _apply_runtime_settings(self, settings: dict) -> None:
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
        if self.fallback_manager is not None:
            self.fallback_manager.fallback_enabled = bool(
                settings.get("fallback_enabled", True)
            )
            self.fallback_manager.cross_provider_fallback = bool(
                settings.get("cross_provider_fallback", False)
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
        if self.memory_manager is not None:
            self.memory_manager.configure(settings)
        if self.react_loop is not None:
            ceiling = settings.get("auto_approve_up_to", "LOW_RISK")
            if ceiling not in {"READ_ONLY", "LOW_RISK", "MODIFY"}:
                raise ValueError(
                    "auto_approve_up_to must be READ_ONLY, LOW_RISK, or MODIFY"
                )
            self.react_loop.auto_approve_up_to = ceiling
            self.react_loop.permissions_mode = mode
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

    async def _clear_memory(self) -> dict:
        if self.memory_manager is None:
            raise RuntimeError("Memory manager is not available.")
        await self.memory_manager.clear_conversation_memory()
        return {"cleared": True}

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
        if "mcp_servers" in settings:
            servers = settings["mcp_servers"]
            if not isinstance(servers, list):
                raise ValueError("mcp_servers must be a list")
            names = set()
            for server in servers:
                if not isinstance(server, dict):
                    raise ValueError("Each MCP server must be an object")
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
        for endpoint in incoming.get("custom_endpoints", []):
            if not isinstance(endpoint, dict):
                continue
            api_key = endpoint.pop("apiKey", None)
            if api_key:
                self.key_manager.save_custom_endpoint_key(endpoint.get("id", ""), api_key)
            endpoint.pop("api_key", None)
        merged = self.get_settings()
        merged.update(incoming)
        merged["custom_endpoints"] = self._redact_custom_endpoint_keys(
            merged.get("custom_endpoints", [])
        )
        self._apply_runtime_settings(merged)
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.settings_path.with_suffix(f"{self.settings_path.suffix}.tmp")
        with temporary_path.open("w", encoding="utf-8") as settings_file:
            json.dump(merged, settings_file, indent=2)
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

    async def _validate_key(self, payload: dict) -> str:
        provider_id = payload.get("provider")
        slot = payload.get("slot")
        api_key = payload.get("key")
        if provider_id not in {"openai", "anthropic", "google"}:
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
        return health.value.lower()
