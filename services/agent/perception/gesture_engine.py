import logging
import asyncio
import base64
import threading
import os
from enum import Enum
from pathlib import Path
import time
from typing import Any

logger = logging.getLogger(__name__)

LANDMARKER_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "gesture" / "hand_landmarker.task"


class GestureType(Enum):
    THUMBS_UP = "THUMBS_UP"
    THUMBS_DOWN = "THUMBS_DOWN"
    OK = "OK"
    OPEN_PALM = "OPEN_PALM"
    FIST = "FIST"
    POINTING_UP = "POINTING_UP"

class GestureEngine:
    CAMERA_READ_FAILURE_LIMIT = 5
    CAMERA_RETRY_SECONDS = 2.0

    def __init__(
        self,
        event_bus,
        camera_index: int = 0,
        sensitivity: float = 0.8,
        min_detection_confidence: float | None = None,
        state_manager=None,
        confidence_threshold: float | None = None,
        stability_frames: int | None = None,
        cooldown_seconds: float | None = None,
        gesture_mappings: dict | None = None,
        hand_commands: list[dict] | None = None,
    ):
        self.event_bus = event_bus
        self.camera_index = camera_index
        if not 0.5 <= sensitivity <= 1.0:
            raise ValueError("Gesture sensitivity must be between 0.5 and 1.0")
        self.sensitivity = sensitivity
        self.min_detection_confidence = (
            self._confidence_threshold(sensitivity)
            if min_detection_confidence is None
            else min_detection_confidence
        )
        self.state_manager = state_manager
        self.confidence_threshold = self._config_float(
            "GESTURE_CONFIDENCE_THRESHOLD",
            self.min_detection_confidence
            if confidence_threshold is None
            else confidence_threshold,
        )
        self.stability_frames = max(
            1,
            stability_frames if stability_frames is not None else self._config_int(
                "GESTURE_STABILITY_FRAMES", 4
            ),
        )
        self._is_active = False
        self._thread = None
        self._last_gesture_time = {}
        self.cooldown_seconds = max(
            0.0,
            cooldown_seconds if cooldown_seconds is not None else self._config_float(
                "GESTURE_COOLDOWN_SECONDS", 2.0
            ),
        )
        self._candidate_gesture = None
        self._candidate_frames = 0
        self._neutral_frames = 0
        self._latched_gesture = None
        self._loop = None
        self._startup_error = None
        self._ready = threading.Event()
        self.gesture_mappings = gesture_mappings or {}
        self.hand_commands = hand_commands or []
        self._candidate_hand_command = None
        self._candidate_hand_frames = 0

    def set_gesture_mappings(self, mappings: dict | None) -> None:
        self.gesture_mappings = mappings or {}

    def set_hand_commands(self, commands: list[dict] | None) -> None:
        self.hand_commands = commands or []
        self._candidate_hand_command = None
        self._candidate_hand_frames = 0

    @staticmethod
    def _config_float(name: str, default: float) -> float:
        try:
            return float(os.environ.get(name, default))
        except (TypeError, ValueError):
            logger.warning("Invalid %s value; using default %.2f", name, default)
            return default

    @staticmethod
    def _config_int(name: str, default: int) -> int:
        try:
            return int(os.environ.get(name, default))
        except (TypeError, ValueError):
            logger.warning("Invalid %s value; using default %d", name, default)
            return default

    async def start(self):
        if self._is_active:
            return
        if self._thread and self._thread.is_alive():
            raise RuntimeError("Gesture camera thread is still shutting down")
        
        try:
            import cv2  # noqa: F401
            import mediapipe  # noqa: F401
        except ImportError as error:
            raise RuntimeError(
                "Gesture recognition requires OpenCV and MediaPipe. "
                "Install the services/agent requirements."
            ) from error

        self._loop = asyncio.get_running_loop()
        self._startup_error = None
        self._ready.clear()
        self._is_active = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        ready = await asyncio.to_thread(self._ready.wait, 10)
        if not ready:
            self._is_active = False
            raise RuntimeError("Timed out while opening the gesture camera")
        if self._startup_error:
            raise RuntimeError("Gesture camera failed to start") from self._startup_error
        logger.info("GestureEngine started.")

    async def stop(self):
        self._is_active = False
        if self._thread:
            await asyncio.to_thread(self._thread.join, 2.0)
            if not self._thread.is_alive():
                self._thread = None
        logger.info("GestureEngine stopped.")

    async def configure(
        self, camera_index: int, sensitivity: float, enabled: bool
    ) -> None:
        if isinstance(camera_index, bool) or not isinstance(camera_index, int) or camera_index < 0:
            raise ValueError("Camera device index must be a non-negative integer")
        if isinstance(sensitivity, bool) or not 0.5 <= sensitivity <= 1.0:
            raise ValueError("Gesture sensitivity must be between 0.5 and 1.0")
        changed = (
            self.camera_index != camera_index or self.sensitivity != sensitivity
        )
        self.camera_index = camera_index
        self.sensitivity = sensitivity
        self.min_detection_confidence = self._confidence_threshold(sensitivity)
        self.confidence_threshold = self._confidence_threshold(sensitivity)
        if not enabled:
            await self.stop()
        elif changed and self._is_active:
            await self.stop()
            await self.start()
        elif not self._is_active:
            await self.start()

    @staticmethod
    def _confidence_threshold(sensitivity: float) -> float:
        return 0.9 - 0.6 * sensitivity

    @staticmethod
    def _camera_backends(cv2):
        if os.name == "nt":
            return (
                ("DirectShow", cv2.CAP_DSHOW),
                ("Media Foundation", cv2.CAP_MSMF),
                ("automatic", cv2.CAP_ANY),
            )
        return (("automatic", cv2.CAP_ANY),)

    def _open_camera(self, cv2):
        for backend_name, backend in self._camera_backends(cv2):
            cap = cv2.VideoCapture(self.camera_index, backend)
            if not cap.isOpened():
                cap.release()
                continue
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            for _ in range(10):
                success, image = cap.read()
                if success and image is not None:
                    logger.info(
                        "Gesture camera %s opened with %s backend",
                        self.camera_index,
                        backend_name,
                    )
                    return cap, image
                time.sleep(0.1)
            logger.warning(
                "Gesture camera %s opened with %s but produced no frames",
                self.camera_index,
                backend_name,
            )
            cap.release()
        return None, None

    def is_active(self) -> bool:
        return self._is_active

    def _capture_loop(self):
        detector = None
        try:
            import cv2
            import mediapipe as mp

            if hasattr(mp, "solutions"):
                detector = mp.solutions.hands.Hands(
                    model_complexity=0,
                    min_detection_confidence=self.min_detection_confidence,
                    min_tracking_confidence=0.5,
                )
                detect = lambda image, timestamp: detector.process(image)
            else:
                if not LANDMARKER_MODEL_PATH.is_file():
                    raise RuntimeError(
                        f"MediaPipe hand landmark model is missing: {LANDMARKER_MODEL_PATH}"
                    )

                from mediapipe.tasks import python
                from mediapipe.tasks.python import vision

                options = vision.HandLandmarkerOptions(
                    base_options=python.BaseOptions(
                        model_asset_path=str(LANDMARKER_MODEL_PATH)
                    ),
                    running_mode=vision.RunningMode.VIDEO,
                    num_hands=2,
                    min_hand_detection_confidence=self.min_detection_confidence,
                    min_tracking_confidence=0.5,
                )
                detector = vision.HandLandmarker.create_from_options(options)

                def detect(image, timestamp):
                    task_image = mp.Image(
                        image_format=mp.ImageFormat.SRGB,
                        data=image,
                    )
                    return detector.detect_for_video(task_image, timestamp)

            last_camera_error_log = 0.0
            last_preview_frame_time = 0.0
            while self._is_active:
                cap, image = self._open_camera(cv2)
                if cap is None:
                    if not self._ready.is_set():
                        raise RuntimeError(
                            f"Cannot read frames from camera device {self.camera_index}; "
                            "check camera permissions and close other applications using it."
                        )
                    now = time.monotonic()
                    if now - last_camera_error_log >= 10:
                        logger.error(
                            "Unable to read frames from camera %s; retrying",
                            self.camera_index,
                        )
                        last_camera_error_log = now
                    time.sleep(self.CAMERA_RETRY_SECONDS)
                    continue

                self._is_active = True
                self._ready.set()
                failed_reads = 0
                try:
                    while self._is_active:
                        if image is None:
                            success, image = cap.read()
                            if not success or image is None:
                                failed_reads += 1
                                if failed_reads >= self.CAMERA_READ_FAILURE_LIMIT:
                                    now = time.monotonic()
                                    if now - last_camera_error_log >= 10:
                                        logger.warning(
                                            "Gesture camera %s stopped providing frames; reopening",
                                            self.camera_index,
                                        )
                                        last_camera_error_log = now
                                    break
                                time.sleep(0.1)
                                continue
                            failed_reads = 0

                        image.flags.writeable = False
                        preview_frame = None
                        now = time.monotonic()
                        if now - last_preview_frame_time >= 0.125:
                            encoded_ok, encoded_frame = cv2.imencode(
                                ".jpg",
                                image,
                                [int(cv2.IMWRITE_JPEG_QUALITY), 70],
                            )
                            if encoded_ok:
                                preview_frame = base64.b64encode(
                                    encoded_frame
                                ).decode("ascii")
                                last_preview_frame_time = now
                        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                        results = detect(image, int(time.monotonic() * 1000))
                        image = None
                        hand_landmarks = getattr(
                            results,
                            "multi_hand_landmarks",
                            getattr(results, "hand_landmarks", None),
                        )
                        if hand_landmarks:
                            frame_landmarks = []
                            for index, landmarks in enumerate(hand_landmarks):
                                gesture = self._detect_gesture(landmarks)
                                confidence = self._hand_confidence(results, index)
                                points = getattr(landmarks, "landmark", landmarks)
                                frame_landmarks.append({
                                    "points": [
                                        [float(point.x), float(point.y), float(getattr(point, "z", 0.0))]
                                        for point in points
                                    ],
                                    "gesture": gesture.name if gesture else None,
                                    "confidence": confidence,
                                })
                                self._observe_gesture(gesture, confidence)
                                self._observe_hand_commands(
                                    frame_landmarks[-1]["points"],
                                    confidence,
                                )
                            self._publish_landmarks(frame_landmarks, preview_frame)
                        else:
                            self._observe_gesture(None, 0.0)
                            self._publish_landmarks([], preview_frame)
                        time.sleep(0.05)
                finally:
                    cap.release()
                if self._is_active:
                    time.sleep(self.CAMERA_RETRY_SECONDS)
        except Exception as error:
            self._startup_error = error
            self._is_active = False
            logger.exception("Gesture capture failed")
        finally:
            self._ready.set()
            if detector:
                detector.close()

    def _classify_fingers(self, landmarks) -> dict:
        points = getattr(landmarks, "landmark", landmarks)

        # Determine if each finger is extended based on geometry
        fingers = {
            'thumb': points[4].y < points[3].y - 0.05,
            'index': points[8].y < points[6].y,
            'middle': points[12].y < points[10].y,
            'ring': points[16].y < points[14].y,
            'pinky': points[20].y < points[18].y,
        }
        
        # Better thumb check for thumbs up/down
        thumb_tip_y = points[4].y
        mcp_y = points[5].y
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
        points = getattr(hand_landmarks, "landmark", hand_landmarks)
        thumb_tip = points[4]
        index_tip = points[8]
        dist = math.hypot(thumb_tip.x - index_tip.x, thumb_tip.y - index_tip.y)
        if dist < 0.05 and ext['middle'] and ext['ring'] and ext['pinky']:
            return GestureType.OK

        return None

    def _on_gesture(self, gesture: GestureType):
        if self.state_manager is not None:
            if not self._loop or self._loop.is_closed():
                logger.error("Cannot validate gesture %s: agent event loop is unavailable", gesture.name)
                return
            future = asyncio.run_coroutine_threadsafe(
                self._validate_and_dispatch_gesture(gesture),
                self._loop,
            )
            future.add_done_callback(
                lambda result: self._log_gesture_validation_error(gesture, result)
            )
            return

        self._dispatch_gesture(gesture)

    async def _validate_and_dispatch_gesture(self, gesture: GestureType) -> None:
        try:
            is_allowed = await asyncio.wait_for(
                self._gesture_is_allowed(gesture),
                timeout=0.5,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Gesture validation timed out for %s; ignoring gesture",
                gesture.name,
            )
            return
        if not is_allowed:
            logger.info("Ignoring gesture %s outside its valid state", gesture.name)
            return
        self._dispatch_gesture(gesture)

    @staticmethod
    def _log_gesture_validation_error(gesture: GestureType, future) -> None:
        try:
            future.result()
        except Exception:
            logger.exception(
                "Could not validate gesture %s against HELIX state",
                gesture.name,
            )

    def _dispatch_gesture(self, gesture: GestureType) -> None:
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
            
            source_event = event_map.get(gesture)
            mapping = self.gesture_mappings.get(source_event, {}) if source_event else {}
            action = mapping.get("action", source_event) if isinstance(mapping, dict) else source_event
            action_event_map = {
                "CONFIRM": "GESTURE_CONFIRM",
                "REJECT": "GESTURE_REJECT",
                "SEARCH": "GESTURE_SEARCH",
                "STOP": "GESTURE_STOP",
                "CLOSE": "GESTURE_CLOSE",
                "OPEN": "GESTURE_OPEN",
            }
            event_name = action_event_map.get(
                action,
                source_event if action == source_event else "GESTURE_ACTION",
            )
            if self.event_bus and event_name:
                if not self._loop or self._loop.is_closed():
                    logger.error("Cannot publish gesture %s: agent event loop is unavailable", gesture.name)
                    return

                payload = {"gesture": gesture.name}
                if event_name == "GESTURE_ACTION":
                    payload["action"] = action
                if (
                    isinstance(mapping, dict)
                    and action == "CUSTOM_COMMAND"
                    and mapping.get("customCommand")
                ):
                    payload["custom_command"] = mapping["customCommand"]

                future = asyncio.run_coroutine_threadsafe(
                    self.event_bus.publish(event_name, payload),
                    self._loop,
                )
                future.add_done_callback(self._log_publish_error)

    @staticmethod
    def _landmark_distance(left: list, right: list) -> float:
        if len(left) != len(right) or not left:
            return 999.0
        total = 0.0
        for a, b in zip(left, right):
            total += sum((float(a[index]) - float(b[index])) ** 2 for index in range(min(len(a), len(b))))
        return (total / len(left)) ** 0.5

    def _observe_hand_commands(self, points: list[list[float]], confidence: float) -> None:
        match = None
        best_distance = 0.08
        for command in self.hand_commands:
            samples = command.get("samples", []) if isinstance(command, dict) else []
            for sample in samples:
                template = sample.get("landmarks") if isinstance(sample, dict) else None
                if isinstance(template, list):
                    distance = self._landmark_distance(points, template)
                    if distance < best_distance:
                        best_distance = distance
                        match = command
        if match is None or confidence < self.confidence_threshold:
            self._candidate_hand_command = None
            self._candidate_hand_frames = 0
            return
        command_id = match.get("id") or match.get("name")
        if command_id == self._candidate_hand_command:
            self._candidate_hand_frames += 1
        else:
            self._candidate_hand_command = command_id
            self._candidate_hand_frames = 1
        if self._candidate_hand_frames >= self.stability_frames:
            self._candidate_hand_frames = 0
            self._publish_hand_command(match)

    def _publish_hand_command(self, command: dict) -> None:
        if not self.event_bus or not self._loop or self._loop.is_closed():
            return
        payload = {
            "action": command.get("action", "CUSTOM_COMMAND"),
            "command_id": command.get("id"),
            "name": command.get("name"),
        }
        if command.get("customCommand"):
            payload["custom_command"] = command["customCommand"]
        future = asyncio.run_coroutine_threadsafe(
            self.event_bus.publish("GESTURE_ACTION", payload), self._loop
        )
        future.add_done_callback(self._log_publish_error)

    @staticmethod
    def _hand_confidence(results, index: int) -> float:
        classifications = getattr(
            results,
            "multi_handedness",
            getattr(results, "handedness", None),
        )
        try:
            return float(classifications[index][0].score)
        except (AttributeError, IndexError, TypeError, ValueError):
            return 0.0

    def _observe_gesture(self, gesture: GestureType | None, confidence: float) -> None:
        if gesture is None or confidence < self.confidence_threshold:
            self._candidate_gesture = None
            self._candidate_frames = 0
            self._neutral_frames += 1
            if self._neutral_frames >= self.stability_frames:
                self._latched_gesture = None
            return

        self._neutral_frames = 0
        if gesture == self._candidate_gesture:
            self._candidate_frames += 1
        else:
            self._candidate_gesture = gesture
            self._candidate_frames = 1

        if (
            self._candidate_frames >= self.stability_frames
            and gesture != self._latched_gesture
        ):
            self._latched_gesture = gesture
            self._on_gesture(gesture)

    def _publish_landmarks(
        self, hands: list[dict], preview_frame: str | None = None
    ) -> None:
        """Expose local landmarks for the settings preview/learning flow.

        Camera preview frames are sent only to the local desktop renderer and
        are never uploaded or persisted by this engine.
        """
        if not self.event_bus or not self._loop or self._loop.is_closed():
            return
        payload = {
            "camera_index": self.camera_index,
            "hands": hands,
            "timestamp": time.time(),
        }
        if preview_frame is not None:
            payload["preview_frame"] = preview_frame
        future = asyncio.run_coroutine_threadsafe(
            self.event_bus.publish("HAND_LANDMARKS", payload),
            self._loop,
        )
        future.add_done_callback(self._log_publish_error)

    async def _gesture_is_allowed(self, gesture: GestureType) -> bool:
        state = await self.state_manager.get_state()
        if gesture in {GestureType.FIST, GestureType.POINTING_UP}:
            return True
        if gesture in {GestureType.THUMBS_UP, GestureType.THUMBS_DOWN}:
            return state.current_confirmation_pending
        if gesture == GestureType.OPEN_PALM:
            return state.current_task_id is not None
        return state.agent_status not in {"closing", "closed", "error"}

    @staticmethod
    def _log_publish_error(future: Any) -> None:
        try:
            future.result()
        except Exception:
            logger.exception("Failed to publish detected gesture")
