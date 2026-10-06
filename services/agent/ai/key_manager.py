import os
import time
import logging
from typing import Optional, Tuple, List
from .base_provider import KeyHealth

logger = logging.getLogger(__name__)

class KeyManager:
    def __init__(self):
        self.keys = {
            "openai": [],
            "anthropic": [],
            "google": []
        }
        self._load_keys()
        self.key_states = {p: {i: {"health": KeyHealth.HEALTHY if k else KeyHealth.UNCONFIGURED, "failures": 0, "cooldown_until": 0} for i, k in enumerate(slots)} for p, slots in self.keys.items()}

    def _load_keys(self):
        for provider in self.keys.keys():
            prefix = provider.upper()
            for i in range(1, 4):
                key = os.environ.get(f"{prefix}_API_KEY_{i}")
                self.keys[provider].append(key)

    def get_available_key(self, provider: str) -> Optional[Tuple[int, str]]:
        if provider not in self.keys:
            return None
        now = time.time()
        for slot, key in enumerate(self.keys[provider]):
            if not key:
                continue
            state = self.key_states[provider][slot]
            if state["cooldown_until"] > now:
                continue
            if state["health"] in [KeyHealth.AUTH_ERROR, KeyHealth.UNCONFIGURED]:
                continue
            return slot, key
        return None

    def get_all_keys_for_provider(self, provider: str) -> List[Tuple[int, str, KeyHealth]]:
        result = []
        for slot, key in enumerate(self.keys.get(provider, [])):
            health = self.key_states[provider][slot]["health"]
            if key:
                # Intentionally omitting key value from log records. Returning tuple for usage.
                result.append((slot, key, health))
        return result

    def mark_key_failure(self, provider: str, slot: int, error_code: str):
        if provider not in self.key_states: return
        state = self.key_states[provider][slot]
        state["failures"] += 1
        logger.warning(f"Key failure for provider {provider} slot {slot}: {error_code}")
        
        if error_code == "RATE_LIMIT":
            state["health"] = KeyHealth.RATE_LIMITED
            state["cooldown_until"] = time.time() + 60
        elif error_code == "QUOTA_EXCEEDED":
            state["health"] = KeyHealth.QUOTA_EXCEEDED
            state["cooldown_until"] = time.time() + 3600
        elif error_code == "AUTH_ERROR":
            state["health"] = KeyHealth.AUTH_ERROR
            state["cooldown_until"] = time.time() + 999999999
        else:
            state["health"] = KeyHealth.UNAVAILABLE
            state["cooldown_until"] = time.time() + 30

    def mark_key_success(self, provider: str, slot: int):
        if provider not in self.key_states: return
        state = self.key_states[provider][slot]
        state["failures"] = 0
        state["health"] = KeyHealth.HEALTHY
        state["cooldown_until"] = 0

    def is_provider_configured(self, provider: str) -> bool:
        return any(k is not None for k in self.keys.get(provider, []))

    def get_configured_providers(self) -> List[str]:
        return [p for p in self.keys.keys() if self.is_provider_configured(p)]
