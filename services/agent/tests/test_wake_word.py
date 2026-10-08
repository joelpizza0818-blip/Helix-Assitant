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
    assert detector.threshold == wake_word.DEFAULT_WAKE_WORD_THRESHOLD
    assert detector.provider is None
    assert detector._model is None


def test_wake_word_threshold_has_a_false_activation_floor(tmp_path, monkeypatch):
    monkeypatch.setattr(wake_word.importlib.util, "find_spec", lambda _name: None)
    detector = wake_word.WakeWordDetector(
        threshold=0.1,
        model_path=tmp_path / "missing.onnx",
    )

    assert detector.threshold == 0.1


def test_wake_word_threshold_rejects_values_outside_supported_range(tmp_path, monkeypatch):
    monkeypatch.setattr(wake_word.importlib.util, "find_spec", lambda _name: None)

    for threshold in (0.05, 0.95):
        try:
            wake_word.WakeWordDetector(
                threshold=threshold,
                model_path=tmp_path / "missing.onnx",
            )
        except ValueError as error:
            assert "between 0.1 and 0.9" in str(error)
        else:
            raise AssertionError(f"Threshold {threshold} should have been rejected")


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

def test_wake_word_loads_only_existing_alias_models(tmp_path, monkeypatch):
    primary_path = tmp_path / "hey_helix.onnx"
    alias_path = tmp_path / "nova.onnx"
    primary_path.touch()
    alias_path.touch()
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
        model_path=primary_path,
        aliases=["nova", "../../outside"],
    )

    assert detector.aliases == ["nova"]
    assert loaded["wakeword_models"] == [str(primary_path), str(alias_path)]
    assert detector._expected_outputs == {
        "hey_helix": "hey helix",
        "nova": "nova",
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


def test_wake_detector_reports_stale_audio_heartbeat_as_stopped(monkeypatch):
    detector = wake_word.WakeWordDetector.__new__(wake_word.WakeWordDetector)
    detector._is_running = True
    detector._task = type("TaskStub", (), {"done": lambda _self: False})()
    detector._last_frame_at = 10.0
    monkeypatch.setattr(
        wake_word.time,
        "monotonic",
        lambda: 10.0 + detector.AUDIO_HEARTBEAT_TIMEOUT_SECONDS + 1,
    )

    assert not detector.is_running()


def test_wake_detector_ignores_other_model_output_and_requires_confirmed_phrase(monkeypatch):
    event_bus = type("EventBusStub", (), {"publish": AsyncMock()})()
    detector = wake_word.WakeWordDetector.__new__(wake_word.WakeWordDetector)
    detector.wake_word = "hey helix"
    detector.threshold = 0.5
    detector._expected_model_output = "hey_helix"
    detector.input_device = 1
    detector.event_bus = event_bus
    detector._is_running = True
    detector._audio_stream = type(
        "AudioStreamStub",
        (),
        {"read": lambda _self, _frame_size: (np.zeros(1280, dtype=np.int16).tobytes(), False)},
    )()

    class ModelStub:
        predictions = [
            {"unrelated_model": 0.99},
            {"hey_helix": 0.9},
            {"hey_helix": 0.1},
            {"hey_helix": 0.9},
            {"hey_helix": 0.9},
            {"hey_helix": 0.9},
        ]

        def __init__(self):
            self.index = 0

        def predict(self, _audio):
            prediction = self.predictions[self.index]
            self.index += 1
            if self.index == len(self.predictions):
                detector._is_running = False
            return prediction

    detector._model = ModelStub()
    monkeypatch.setattr(wake_word.asyncio, "sleep", AsyncMock())

    asyncio.run(detector._listen_loop())

    event_bus.publish.assert_awaited_once_with(
        "VOICE_WAKE",
        {"phrase": "hey helix"},
    )
