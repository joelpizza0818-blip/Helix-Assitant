from typing import List, Dict, Optional
from .base_provider import ModelDefinition, ModelCapabilities
from .model_catalog_generated import MODEL_CATALOG

_MODELS = [
    ModelDefinition(
        model["id"],
        model["provider"],
        model["display_name"],
        ModelCapabilities(**model.get("capabilities", {})),
        priority=model.get("priority", 0),
        enabled=model.get("enabled", True),
        fallback_group=model.get("fallback_group"),
    )
    for model in MODEL_CATALOG
]

class CapabilityRegistry:
    def __init__(self):
        self.models = {m.id: m for m in _MODELS}

    def register_models(self, models: List[ModelDefinition]) -> None:
        for model in models:
            if isinstance(model, ModelDefinition) and model.id and model.provider:
                self.models[f"{model.provider}:{model.id}"] = model

    def remove_provider_models(self, provider_id: str) -> None:
        self.models = {
            key: model
            for key, model in self.models.items()
            if model.provider != provider_id
        }

    def filter_by_capabilities(self, required: dict, provider_filter: Optional[List[str]] = None) -> List[ModelDefinition]:
        results = []
        for m in self.models.values():
            if not m.enabled:
                continue
            if provider_filter and m.provider not in provider_filter:
                continue
            match = True
            for req_cap, req_val in required.items():
                if not hasattr(m.capabilities, req_cap) or getattr(m.capabilities, req_cap) != req_val:
                    match = False
                    break
            if match:
                results.append(m)
        return results

    def get_model(self, model_id: str) -> Optional[ModelDefinition]:
        return self.models.get(model_id)

    def get_models_for_provider(self, provider_id: str) -> List[ModelDefinition]:
        return [m for m in self.models.values() if m.provider == provider_id]

    def get_all_models(self) -> List[ModelDefinition]:
        return list(self.models.values())
