import os
import re
import time
import logging
from typing import Optional, Tuple, List
import keyring
from .base_provider import KeyHealth

logger = logging.getLogger(__name__)

class KeyManager:
    KEYRING_SERVICE = "helix_agent"
    CUSTOM_ENDPOINT_PREFIX = "custom_endpoint_api_key_"

    def __init__(self):
        self.keys = {"openai": [], "anthropic": [], "google": []}
        self._load_keys()
        self.key_states = {p: {i: {"health": KeyHealth.HEALTHY if k else KeyHealth.UNCONFIGURED, "failures": 0, "cooldown_until": 0} for i, k in enumerate(slots)} for p, slots in self.keys.items()}

    def configure_custom_endpoint(self, endpoint_id: str, api_key: str | None = None, allow_empty: bool = True) -> None:
        """Expose a custom endpoint as a normal one-key provider pool."""
        if not isinstance(endpoint_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", endpoint_id):
            raise ValueError("Custom endpoint id contains unsupported characters")
        stored = api_key.strip() if isinstance(api_key, str) and api_key.strip() else None
        if stored:
            self.save_custom_endpoint_key(endpoint_id, stored)
        if not stored:
            try:
                stored = keyring.get_password(
                    self.KEYRING_SERVICE,
                    f"{self.CUSTOM_ENDPOINT_PREFIX}{endpoint_id}",
                )
            except Exception:
                stored = None
        if not stored and allow_empty:
            # OpenAI-compatible local servers ignore the token, but the SDK
            # requires a non-empty value.
            stored = "helix-local-endpoint"
        self.keys[endpoint_id] = [stored] if stored else []
        self.key_states[endpoint_id] = {
            0: {
                "health": KeyHealth.HEALTHY if stored else KeyHealth.UNCONFIGURED,
                "failures": 0,
                "cooldown_until": 0,
            }
        }

    def _load_keys(self):
        for provider in self.keys.keys():
            prefix = provider.upper()
            # Three slots remain the minimum for compatibility, but the pool is
            # intentionally unbounded.  Keyring-backed slots beyond three are
            # discovered through the persisted count; environment slots are
            # discovered by name so deployments can provide any number.
            count = 3
            try:
                saved_count = keyring.get_password(
                    self.KEYRING_SERVICE, f"{provider}_api_key_count"
                )
                if saved_count and saved_count.isdigit():
                    count = max(count, int(saved_count))
            except Exception as error:
                logger.warning("Could not read key count for %s (%s)", provider, type(error).__name__)
            env_slots = [
                int(match.group(1))
                for name in os.environ
                if (match := re.fullmatch(rf"{re.escape(prefix)}_API_KEY_(\d+)", name))
            ]
            if env_slots:
                count = max(count, max(env_slots))
            self.keys[provider] = []
            for i in range(1, count + 1):
                try:
                    key = keyring.get_password(
                        self.KEYRING_SERVICE,
                        f"{provider}_api_key_{i}",
                    )
                except Exception as error:
                    logger.warning(
                        "Could not read saved API key for %s slot %s (%s)",
                        provider,
                        i,
                        type(error).__name__,
                    )
                    key = None
                key = key or os.environ.get(f"{prefix}_API_KEY_{i}")
                self.keys[provider].append(key.strip() if key and key.strip() else None)

    def save_key(self, provider: str, slot: int, value: str) -> None:
        if provider not in self.keys:
            raise ValueError(f"Unsupported API key provider: {provider}")
        if isinstance(slot, bool) or not isinstance(slot, int) or slot < 0:
            raise ValueError("API key slot must be a non-negative integer")
        if not isinstance(value, str) or not value.strip():
            raise ValueError("A non-empty API key is required")

        normalized_key = value.strip()
        try:
            keyring.set_password(
                self.KEYRING_SERVICE,
                f"{provider}_api_key_{slot + 1}",
                normalized_key,
            )
            if slot >= 3:
                keyring.set_password(
                    self.KEYRING_SERVICE,
                    f"{provider}_api_key_count",
                    str(max(len(self.keys[provider]), slot + 1)),
                )
        except Exception as error:
            logger.exception("Could not securely store API key for %s slot %s", provider, slot + 1)
            raise RuntimeError(
                "Could not save the API key in Windows Credential Manager."
            ) from error

        if slot >= len(self.keys[provider]):
            self.keys[provider].extend([None] * (slot + 1 - len(self.keys[provider])))
            for new_slot in range(len(self.key_states.get(provider, {})), slot + 1):
                self.key_states.setdefault(provider, {})[new_slot] = {
                    "health": KeyHealth.HEALTHY,
                    "failures": 0,
                    "cooldown_until": 0,
                }
        self.keys[provider][slot] = normalized_key
        state = self.key_states[provider][slot]
        state.update(
            health=KeyHealth.HEALTHY,
            failures=0,
            cooldown_until=0,
        )

    def save_custom_endpoint_key(self, endpoint_id: str, value: str) -> None:
        """Store a custom endpoint credential in the OS credential vault."""
        if not isinstance(endpoint_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", endpoint_id):
            raise ValueError("Custom endpoint id contains unsupported characters")
        if not isinstance(value, str) or not value.strip():
            raise ValueError("A non-empty endpoint API key is required")
        try:
            keyring.set_password(
                self.KEYRING_SERVICE,
                f"{self.CUSTOM_ENDPOINT_PREFIX}{endpoint_id}",
                value.strip(),
            )
        except Exception as error:
            logger.exception("Could not securely store custom endpoint key")
            raise RuntimeError(
                "Could not save the custom endpoint key in Windows Credential Manager."
            ) from error

    def has_custom_endpoint_key(self, endpoint_id: str) -> bool:
        if not isinstance(endpoint_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", endpoint_id):
            return False
        try:
            return bool(keyring.get_password(
                self.KEYRING_SERVICE,
                f"{self.CUSTOM_ENDPOINT_PREFIX}{endpoint_id}",
            ))
        except Exception:
            return False

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
            if state["health"] in [
                KeyHealth.AUTH_ERROR,
                KeyHealth.BILLING_EXHAUSTED,
                KeyHealth.UNCONFIGURED,
            ]:
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

    def mark_key_failure(
        self,
        provider: str,
        slot: int,
        error_code: str,
        cooldown_seconds: Optional[float] = None,
    ):
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
            state["cooldown_until"] = time.time() + (
                cooldown_seconds if cooldown_seconds is not None else 60
            )
        elif error_code in {"QUOTA_EXCEEDED", "BILLING_EXHAUSTED"}:
            state["health"] = (
                KeyHealth.BILLING_EXHAUSTED
                if error_code == "BILLING_EXHAUSTED"
                else KeyHealth.QUOTA_EXCEEDED
            )
            state["cooldown_until"] = (
                time.time() + cooldown_seconds
                if cooldown_seconds is not None
                else 0
            )
        elif error_code == "AUTH_ERROR":
            state["health"] = KeyHealth.AUTH_ERROR
            state["cooldown_until"] = time.time() + 999999999
        elif error_code in {
            "NETWORK_ERROR",
            "TIMEOUT",
            "TEMPORARY_PROVIDER_ERROR",
        }:
            state["health"] = KeyHealth.UNAVAILABLE
            state["cooldown_until"] = time.time() + (
                cooldown_seconds if cooldown_seconds is not None else 30
            )

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
