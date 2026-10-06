import pytest
from services.agent.perception.gesture_engine import GestureType

def test_six_gesture_definitions():
    # Verify all 6 mandatory gestures are present in the enum
    expected_gestures = {"THUMBS_UP", "THUMBS_DOWN", "OK", "OPEN_PALM", "FIST", "POINTING_UP"}
    actual_gestures = set(g.name for g in GestureType)
    assert expected_gestures.issubset(actual_gestures)

def test_gesture_event_name_mapping():
    mapping = {
        GestureType.THUMBS_UP: "GESTURE_CONFIRM",
        GestureType.THUMBS_DOWN: "GESTURE_REJECT",
        GestureType.OK: "GESTURE_SEARCH",
        GestureType.OPEN_PALM: "GESTURE_STOP",
        GestureType.FIST: "GESTURE_CLOSE",
        GestureType.POINTING_UP: "GESTURE_OPEN",
    }

    assert mapping[GestureType.THUMBS_UP] == "GESTURE_CONFIRM"
    assert mapping[GestureType.THUMBS_DOWN] == "GESTURE_REJECT"
    assert mapping[GestureType.OK] == "GESTURE_SEARCH"
    assert mapping[GestureType.OPEN_PALM] == "GESTURE_STOP"
    assert mapping[GestureType.FIST] == "GESTURE_CLOSE"
    assert mapping[GestureType.POINTING_UP] == "GESTURE_OPEN"
