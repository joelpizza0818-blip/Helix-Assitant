import logging
import asyncio
import threading
from enum import Enum
import time

logger = logging.getLogger(__name__)

class GestureType(Enum):
    THUMBS_UP = "THUMBS_UP"
    THUMBS_DOWN = "THUMBS_DOWN"
    OK = "OK"
    OPEN_PALM = "OPEN_PALM"
    FIST = "FIST"
    POINTING_UP = "POINTING_UP"

class GestureEngine:
    def __init__(self, event_bus, camera_index: int = 0, sensitivity: float = 0.8, min_detection_confidence: float = 0.7):
        self.event_bus = event_bus
        self.camera_index = camera_index
        self.sensitivity = sensitivity
        self.min_detection_confidence = min_detection_confidence
        self._is_active = False
        self._thread = None
        self._last_gesture_time = {}
        self.cooldown_seconds = 2.0

    async def start(self):
        if self._is_active:
            return
        
        try:
            import cv2
            import mediapipe as mp
        except ImportError:
            logger.warning("cv2 or mediapipe not installed. GestureEngine cannot start.")
            return

        self._is_active = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        logger.info("GestureEngine started.")

    async def stop(self):
        self._is_active = False
        if self._thread:
            self._thread.join(timeout=2.0)
        logger.info("GestureEngine stopped.")

    def is_active(self) -> bool:
        return self._is_active

    def _capture_loop(self):
        import cv2
        import mediapipe as mp
        
        mp_hands = mp.solutions.hands
        hands = mp_hands.Hands(
            model_complexity=0,
            min_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=0.5
        )
        
        cap = cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            logger.error(f"Cannot open camera {self.camera_index}")
            self._is_active = False
            return
            
        try:
            while self._is_active:
                success, image = cap.read()
                if not success:
                    time.sleep(0.1)
                    continue

                image.flags.writeable = False
                image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                results = hands.process(image)

                if results.multi_hand_landmarks:
                    for hand_landmarks in results.multi_hand_landmarks:
                        gesture = self._detect_gesture(hand_landmarks)
                        if gesture:
                            self._on_gesture(gesture)
                            
                time.sleep(0.05) # ~20 FPS limit
        finally:
            cap.release()
            hands.close()

    def _classify_fingers(self, landmarks) -> dict:
        import mediapipe as mp
        mp_hands = mp.solutions.hands
        
        # Determine if each finger is extended based on geometry
        fingers = {
            'thumb': landmarks.landmark[mp_hands.HandLandmark.THUMB_TIP].y < landmarks.landmark[mp_hands.HandLandmark.THUMB_IP].y - 0.05,
            'index': landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP].y < landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_PIP].y,
            'middle': landmarks.landmark[mp_hands.HandLandmark.MIDDLE_FINGER_TIP].y < landmarks.landmark[mp_hands.HandLandmark.MIDDLE_FINGER_PIP].y,
            'ring': landmarks.landmark[mp_hands.HandLandmark.RING_FINGER_TIP].y < landmarks.landmark[mp_hands.HandLandmark.RING_FINGER_PIP].y,
            'pinky': landmarks.landmark[mp_hands.HandLandmark.PINKY_TIP].y < landmarks.landmark[mp_hands.HandLandmark.PINKY_PIP].y,
        }
        
        # Better thumb check for thumbs up/down
        thumb_tip_y = landmarks.landmark[mp_hands.HandLandmark.THUMB_TIP].y
        mcp_y = landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_MCP].y
        thumb_is_up = thumb_tip_y < mcp_y - 0.1
        thumb_is_down = thumb_tip_y > mcp_y + 0.1
        
        return {
            'extended': fingers,
            'thumb_up': thumb_is_up,
            'thumb_down': thumb_is_down
        }

    def _detect_gesture(self, hand_landmarks) -> GestureType | None:
        classification = self._classify_fingers(hand_landmarks)
        ext = classification['extended']
        
        other_fingers_curled = not (ext['index'] or ext['middle'] or ext['ring'] or ext['pinky'])
        
        if classification['thumb_up'] and other_fingers_curled:
            return GestureType.THUMBS_UP
            
        if classification['thumb_down'] and other_fingers_curled:
            return GestureType.THUMBS_DOWN
            
        if ext['index'] and not (ext['middle'] or ext['ring'] or ext['pinky']) and not ext['thumb']:
            return GestureType.POINTING_UP
            
        if all(ext.values()):
            return GestureType.OPEN_PALM
            
        if not any(ext.values()):
            return GestureType.FIST
            
        # OK Gesture: Thumb and Index close, others extended
        import math
        thumb_tip = hand_landmarks.landmark[4] # THUMB_TIP
        index_tip = hand_landmarks.landmark[8] # INDEX_FINGER_TIP
        dist = math.hypot(thumb_tip.x - index_tip.x, thumb_tip.y - index_tip.y)
        if dist < 0.05 and ext['middle'] and ext['ring'] and ext['pinky']:
            return GestureType.OK

        return None

    def _on_gesture(self, gesture: GestureType):
        now = time.time()
        last_time = self._last_gesture_time.get(gesture, 0)
        
        if now - last_time > self.cooldown_seconds:
            self._last_gesture_time[gesture] = now
            logger.info(f"Gesture detected: {gesture.name}")
            
            event_map = {
                GestureType.THUMBS_UP: "GESTURE_CONFIRM",
                GestureType.THUMBS_DOWN: "GESTURE_REJECT",
                GestureType.OK: "GESTURE_SEARCH",
                GestureType.OPEN_PALM: "GESTURE_STOP",
                GestureType.FIST: "GESTURE_CLOSE",
                GestureType.POINTING_UP: "GESTURE_OPEN"
            }
            
            event_name = event_map.get(gesture)
            if self.event_bus and event_name:
                self.event_bus.emit(event_name, {"gesture": gesture.name})
