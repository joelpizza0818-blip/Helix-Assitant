from typing import List, Dict, Optional
from .base_provider import ModelDefinition, ModelCapabilities

_MODELS = [
    # OpenAI
    ModelDefinition("gpt-4o", "openai", "GPT-4o", ModelCapabilities(text=True, vision=True, tool_calling=True, function_calling=True, structured_output=True, coding=True, reasoning=True, streaming=True, context_window=128000, cost_tier="high")),
    ModelDefinition("gpt-4o-mini", "openai", "GPT-4o Mini", ModelCapabilities(text=True, vision=True, tool_calling=True, streaming=True, coding=True, context_window=128000, cost_tier="low")),
    ModelDefinition("gpt-4-turbo", "openai", "GPT-4 Turbo", ModelCapabilities(text=True, vision=True, tool_calling=True, coding=True, streaming=True, context_window=128000, cost_tier="high")),
    ModelDefinition("o1-preview", "openai", "o1 Preview", ModelCapabilities(text=True, reasoning=True, context_window=128000, cost_tier="premium")),
    ModelDefinition("o1-mini", "openai", "o1 Mini", ModelCapabilities(text=True, reasoning=True, coding=True, context_window=128000, cost_tier="medium")),
    ModelDefinition("o3-mini", "openai", "o3 Mini", ModelCapabilities(text=True, reasoning=True, coding=True, context_window=200000, cost_tier="medium")),
    ModelDefinition("gpt-4o-realtime-preview", "openai", "GPT-4o Realtime", ModelCapabilities(text=True, audio=True, realtime=True, low_latency=True, streaming=True, cost_tier="premium")),
    ModelDefinition("whisper-1", "openai", "Whisper 1", ModelCapabilities(speech_to_text=True, cost_tier="low")),
    ModelDefinition("tts-1", "openai", "TTS 1", ModelCapabilities(text_to_speech=True, low_latency=True, cost_tier="low")),
    ModelDefinition("tts-1-hd", "openai", "TTS 1 HD", ModelCapabilities(text_to_speech=True, cost_tier="medium")),

    # Anthropic
    ModelDefinition("claude-3-5-sonnet-20241022", "anthropic", "Claude 3.5 Sonnet", ModelCapabilities(text=True, vision=True, tool_calling=True, computer_use=True, coding=True, reasoning=True, streaming=True, context_window=200000, cost_tier="high")),
    ModelDefinition("claude-3-5-haiku-20241022", "anthropic", "Claude 3.5 Haiku", ModelCapabilities(text=True, vision=True, tool_calling=True, coding=True, streaming=True, context_window=200000, cost_tier="low")),
    ModelDefinition("claude-3-opus-20240229", "anthropic", "Claude 3 Opus", ModelCapabilities(text=True, vision=True, tool_calling=True, coding=True, reasoning=True, streaming=True, context_window=200000, cost_tier="premium")),
    ModelDefinition("claude-3-sonnet-20240229", "anthropic", "Claude 3 Sonnet", ModelCapabilities(text=True, vision=True, tool_calling=True, streaming=True, context_window=200000, cost_tier="medium")),
    ModelDefinition("claude-3-haiku-20240307", "anthropic", "Claude 3 Haiku", ModelCapabilities(text=True, vision=True, tool_calling=True, streaming=True, context_window=200000, cost_tier="low")),

    # Google
    ModelDefinition("gemini-2.0-flash", "google", "Gemini 2.0 Flash", ModelCapabilities(text=True, vision=True, tool_calling=True, coding=True, streaming=True, context_window=1048576, cost_tier="low")),
    ModelDefinition("gemini-2.0-flash-lite", "google", "Gemini 2.0 Flash Lite", ModelCapabilities(text=True, vision=True, streaming=True, context_window=1048576, cost_tier="low")),
    ModelDefinition("gemini-1.5-pro", "google", "Gemini 1.5 Pro", ModelCapabilities(text=True, vision=True, audio=True, tool_calling=True, coding=True, reasoning=True, streaming=True, long_context=True, context_window=2097152, cost_tier="high")),
    ModelDefinition("gemini-1.5-flash", "google", "Gemini 1.5 Flash", ModelCapabilities(text=True, vision=True, audio=True, tool_calling=True, streaming=True, context_window=1048576, cost_tier="low")),
    ModelDefinition("gemini-1.5-flash-8b", "google", "Gemini 1.5 Flash 8B", ModelCapabilities(text=True, vision=True, streaming=True, context_window=1048576, cost_tier="low")),
    ModelDefinition("gemini-2.0-flash-thinking-exp", "google", "Gemini 2.0 Flash Thinking", ModelCapabilities(text=True, reasoning=True, coding=True, streaming=True, context_window=32768, cost_tier="medium")),
]

class CapabilityRegistry:
    def __init__(self):
        self.models = {m.id: m for m in _MODELS}

    def filter_by_capabilities(self, required: dict, provider_filter: Optional[List[str]] = None) -> List[ModelDefinition]:
        results = []
        for m in self.models.values():
            if provider_filter and m.provider not in provider_filter:
                continue
            match = True
            for req_cap, req_val in required.items():
                if hasattr(m.capabilities, req_cap) and getattr(m.capabilities, req_cap) != req_val:
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
