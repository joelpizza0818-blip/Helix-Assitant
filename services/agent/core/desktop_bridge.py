import json
import os
from dataclasses import asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


DEFAULT_SETTINGS = {
    "voice_enabled": True,
    "wake_word": "hey helix",
    "wake_word_provider": "openwakeword",
    "camera_enabled": False,
    "camera_device_index": 0,
    "gesture_sensitivity": 0.8,
    "start_with_windows": True,
    "default_model": None,
    "preferred_provider": None,
    "fallback_enabled": True,
    "cross_provider_fallback": False,
    "cost_preference": "balanced",
    "speed_preference": "balanced",
    "quality_preference": "balanced",
    "log_level": "INFO",
    "protected_paths": [],
    "protected_apps": [],
    "agent_ws_port": 8765,
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


class DesktopRequestHandler:
    def __init__(
        self,
        task_manager,
        provider_registry,
        capability_registry,
        key_manager,
        settings_path: Path,
    ):
        self.task_manager = task_manager
        self.provider_registry = provider_registry
        self.capability_registry = capability_registry
        self.key_manager = key_manager
        self.settings_path = settings_path

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
            "VALIDATE_KEY": lambda: self._validate_key(payload),
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
        if message_type == "USER_TEXT":
            text = payload.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("USER_TEXT requires a non-empty text value")
            event_payload = {"text": text}
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
        elif message_type == "TASK_CANCEL":
            task_id = payload.get("task_id")
            if not isinstance(task_id, str) or not task_id:
                raise ValueError("TASK_CANCEL requires a task_id")
            await self.task_manager.cancel(task_id)
        elif message_type in {"CONFIRMATION_GRANTED", "CONFIRMATION_REJECTED"}:
            await self.task_manager.event_bus.publish(message_type, payload)
        else:
            raise ValueError(f"Unsupported desktop event: {message_type}")

    async def _get_tasks(self) -> list[dict]:
        tasks = await self.task_manager.get_tasks()
        result = []
        for task in tasks:
            serialized = _serialize(task)
            serialized["error"] = None
            result.append(serialized)
        return result

    async def _get_providers(self) -> list[dict]:
        result = []
        for provider_id in ("openai", "anthropic", "google"):
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
        return settings

    async def _get_settings(self) -> dict:
        return self.get_settings()

    async def _save_settings(self, settings: dict) -> dict:
        if not isinstance(settings, dict):
            raise ValueError("SAVE_SETTINGS requires a settings object")
        merged = self.get_settings()
        merged.update(settings)
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.settings_path.with_suffix(f"{self.settings_path.suffix}.tmp")
        with temporary_path.open("w", encoding="utf-8") as settings_file:
            json.dump(merged, settings_file, indent=2)
        temporary_path.replace(self.settings_path)
        
        await self.task_manager.event_bus.publish("SETTINGS_UPDATED", merged)
        
        return merged

    async def _validate_key(self, payload: dict) -> str:
        provider_id = payload.get("provider")
        slot = payload.get("slot")
        api_key = payload.get("key")
        if provider_id not in {"openai", "anthropic", "google"}:
            raise ValueError("Unsupported API key provider")
        if not isinstance(slot, int) or slot not in (1, 2, 3):
            raise ValueError("API key slot must be between 1 and 3")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("A non-empty API key is required")

        provider = self.provider_registry.get_registered_provider(provider_id)
        if provider is None:
            raise ValueError(f"Provider is not registered: {provider_id}")
        health = await provider.validate_key(api_key)
        return health.value.lower()
