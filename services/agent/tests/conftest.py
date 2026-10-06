import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from services.agent.ai.key_manager import KeyManager
from services.agent.ai.capability_registry import CapabilityRegistry
from services.agent.ai.provider_registry import ProviderRegistry
from services.agent.ai.model_router import ModelRouter
from services.agent.ai.fallback_manager import FallbackManager
from services.agent.security.permission_manager import PermissionManager
from services.agent.security.confirmation_manager import ConfirmationManager
from services.agent.core.event_bus import EventBus

@pytest.fixture
def mock_event_bus():
    bus = MagicMock(spec=EventBus)
    bus.publish = AsyncMock()
    bus.subscribe = MagicMock()
    bus.unsubscribe = MagicMock()
    return bus

@pytest.fixture
def clean_env(monkeypatch):
    providers = ["OPENAI", "ANTHROPIC", "GOOGLE"]
    for p in providers:
        for i in range(1, 4):
            monkeypatch.delenv(f"{p}_API_KEY_{i}", raising=False)

@pytest.fixture
def google_only_env(clean_env, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY_1", "test-google-key-1")

@pytest.fixture
def openai_only_env(clean_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY_1", "test-openai-key-1")

@pytest.fixture
def anthropic_only_env(clean_env, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY_1", "test-anthropic-key-1")

@pytest.fixture
def all_providers_env(clean_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY_1", "test-openai-key-1")
    monkeypatch.setenv("ANTHROPIC_API_KEY_1", "test-anthropic-key-1")
    monkeypatch.setenv("GOOGLE_API_KEY_1", "test-google-key-1")

@pytest.fixture
def capability_registry():
    return CapabilityRegistry()

@pytest.fixture
def key_manager():
    return KeyManager()

@pytest.fixture
def provider_registry(key_manager):
    return ProviderRegistry(key_manager)

@pytest.fixture
def model_router(capability_registry, provider_registry, key_manager):
    return ModelRouter(capability_registry, provider_registry, key_manager)

@pytest.fixture
def fallback_manager(model_router, key_manager, mock_event_bus):
    return FallbackManager(model_router, key_manager, mock_event_bus)

@pytest.fixture
def permission_manager():
    return PermissionManager()

@pytest.fixture
def confirmation_manager():
    return ConfirmationManager()
