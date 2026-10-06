import logging
from typing import List, Optional
from .base_provider import BaseAIProvider, ModelDefinition
from .key_manager import KeyManager

logger = logging.getLogger(__name__)

class ProviderRegistry:
    def __init__(self, key_manager: KeyManager):
        self._providers = {}
        self.key_manager = key_manager

    def register_provider(self, provider: BaseAIProvider):
        self._providers[provider.provider_id] = provider
        logger.info(f"Registered provider: {provider.provider_id}")

    def get_provider(self, provider_id: str) -> Optional[BaseAIProvider]:
        if not self.is_provider_available(provider_id):
            return None
        return self._providers.get(provider_id)

    def get_registered_provider(self, provider_id: str) -> Optional[BaseAIProvider]:
        return self._providers.get(provider_id)

    def get_available_providers(self) -> List[BaseAIProvider]:
        available = []
        for pid, provider in self._providers.items():
            if self.is_provider_available(pid):
                available.append(provider)
        return available

    def is_provider_available(self, provider_id: str) -> bool:
        if provider_id not in self._providers:
            return False
        return self.key_manager.is_provider_configured(provider_id)

    def get_provider_health(self, provider_id: str) -> dict:
        if provider_id not in self._providers:
            return {"status": "NOT_FOUND"}
        keys = self.key_manager.get_all_keys_for_provider(provider_id)
        return {
            "status": "CONFIGURED" if keys else "UNCONFIGURED",
            "keys": [{"slot": slot, "health": health.value} for slot, key, health in keys]
        }

    def get_available_models(self, task_requirements: dict = None) -> List[ModelDefinition]:
        models = []
        for provider in self.get_available_providers():
            provider_models = provider.get_available_models()
            for m in provider_models:
                models.append(m)
        return models
