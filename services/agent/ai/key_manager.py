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
            self.keys[provider] = []
            for i in range(1, 4):
                key = os.environ.get(f"{prefix}_API_KEY_{i}")
                self.keys[provider].append(key.strip() if key and key.strip() else None)

    def get_available_key(self, provider: str) -> Optional[Tuple[int, str]]:
        available_keys = self.get_available_keys(provider)
        return available_keys[0] if available_keys else None

    def get_available_keys(self, provider: str) -> List[Tuple[int, str]]:
        if provider not in self.keys:
            return []
        now = time.time()
        available = []
        for slot, key in enumerate(self.keys[provider]):
            if not key:
                continue
            state = self.key_states[provider][slot]
            if state["cooldown_until"] > now:
                continue
            if state["health"] in [KeyHealth.AUTH_ERROR, KeyHealth.UNCONFIGURED]:
                continue
            available.append((slot, key))
        return available

    def get_key(self, provider: str, slot: int) -> Optional[str]:
        keys = self.keys.get(provider)
        if keys is None or slot < 0 or slot >= len(keys):
            return None
        return keys[slot]

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
        if error_code in {
            "INTERNAL_CLIENT_ERROR",
            "INVALID_REQUEST",
            "CONTENT_POLICY",
            "MODEL_UNAVAILABLE",
            "UNKNOWN",
        }:
            return
        state = self.key_states[provider][slot]
        state["failures"] += 1
        logger.warning(
            "Key failure for provider %s slot %d: %s",
            provider,
            slot + 1,
            error_code,
        )
        
        if error_code == "RATE_LIMIT":
            state["health"] = KeyHealth.RATE_LIMITED
            state["cooldown_until"] = time.time() + 60
        elif error_code in {"QUOTA_EXCEEDED", "BILLING_EXHAUSTED"}:
            state["health"] = KeyHealth.QUOTA_EXCEEDED
            state["cooldown_until"] = 0
        elif error_code == "AUTH_ERROR":
            state["health"] = KeyHealth.AUTH_ERROR
            state["cooldown_until"] = time.time() + 999999999
        elif error_code in {
            "NETWORK_ERROR",
            "TIMEOUT",
            "TEMPORARY_PROVIDER_ERROR",
        }:
            state["health"] = KeyHealth.UNAVAILABLE
            state["cooldown_until"] = time.time() + 30

    def mark_key_success(self, provider: str, slot: int):
        if provider not in self.key_states: return
        state = self.key_states[provider][slot]
        state["failures"] = 0
        state["health"] = KeyHealth.HEALTHY
        state["cooldown_until"] = 0

    def is_provider_configured(self, provider: str) -> bool:
        return any(k for k in self.keys.get(provider, []))

    def get_configured_providers(self) -> List[str]:
        return [p for p in self.keys.keys() if self.is_provider_configured(p)]
