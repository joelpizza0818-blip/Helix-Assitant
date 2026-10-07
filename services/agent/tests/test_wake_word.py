import asyncio
import importlib.machinery
import sys
from types import ModuleType
from unittest.mock import AsyncMock
import numpy as np

from services.agent.perception import wake_word


def test_custom_phrase_requires_a_trained_model(tmp_path, monkeypatch):
    monkeypatch.setattr(
        wake_word.importlib.util,
        "find_spec",
        lambda _name: importlib.machinery.ModuleSpec("openwakeword", loader=None),
    )

    detector = wake_word.WakeWordDetector(
        wake_word="hey helix",
        model_path=tmp_path / "hey_helix.onnx",
    )

    assert detector.wake_word == "hey helix"
    assert detector.threshold == 0.05
    assert detector.provider is None
    assert detector._model is None


def test_custom_onnx_model_is_loaded(tmp_path, monkeypatch):
    model_path = tmp_path / "hey_helix.onnx"
    model_path.touch()
    loaded = {}

    package = ModuleType("openwakeword")
    package.__path__ = []
    model_module = ModuleType("openwakeword.model")
    utils_module = ModuleType("openwakeword.utils")
    utils_module.download_models = lambda **_kwargs: None

    class FakeModel:
        def __init__(self, **kwargs):
            loaded.update(kwargs)

    model_module.Model = FakeModel
    monkeypatch.setitem(sys.modules, "openwakeword.utils", utils_module)
    monkeypatch.setitem(sys.modules, "openwakeword", package)
    monkeypatch.setitem(sys.modules, "openwakeword.model", model_module)
    monkeypatch.setattr(
        wake_word.importlib.util,
        "find_spec",
        lambda _name: importlib.machinery.ModuleSpec("openwakeword", loader=None),
    )

    detector = wake_word.WakeWordDetector(
        wake_word="hey helix",
        model_path=model_path,
    )

    assert detector.provider == "openwakeword"
    assert loaded == {
        "wakeword_models": [str(model_path)],
        "inference_framework": "onnx",
    }


def test_wake_event_uses_async_event_bus():
    event_bus = type("EventBusStub", (), {"publish": AsyncMock()})()
    detector = wake_word.WakeWordDetector.__new__(wake_word.WakeWordDetector)
    detector.wake_word = "hey helix"
    detector.event_bus = event_bus

    asyncio.run(detector._on_wake())

    event_bus.publish.assert_awaited_once_with(
        "VOICE_WAKE",
        {"phrase": "hey helix"},
    )


def test_wake_detector_triggers_at_configured_low_score(monkeypatch):
    event_bus = type("EventBusStub", (), {"publish": AsyncMock()})()
    detector = wake_word.WakeWordDetector.__new__(wake_word.WakeWordDetector)
    detector.wake_word = "hey helix"
    detector.threshold = 0.05
    detector.input_device = 1
    detector.event_bus = event_bus
    detector._is_running = True
    detector._audio_stream = type(
        "AudioStreamStub",
        (),
        {"read": lambda _self, _frame_size: (np.zeros(1280, dtype=np.int16).tobytes(), False)},
    )()

    class ModelStub:
        def predict(self, _audio):
            detector._is_running = False
            return {"hey_helix": 0.06}

    detector._model = ModelStub()
    monkeypatch.setattr(wake_word.asyncio, "sleep", AsyncMock())

    asyncio.run(detector._listen_loop())

    event_bus.publish.assert_awaited_once_with(
        "VOICE_WAKE",
        {"phrase": "hey helix"},
    )
