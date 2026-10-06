import logging
import base64
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class ChangeRegion:
    x: int
    y: int
    width: int
    height: int
    change_magnitude: float

class VisionEngine:
    def __init__(self, model_call_fn, screen_engine, ocr_engine):
        self.model_call_fn = model_call_fn
        self.screen_engine = screen_engine
        self.ocr_engine = ocr_engine

    async def analyze_screenshot(self, image_bytes: bytes, prompt: str) -> str:
        """Sends an image to the vision model and gets a description."""
        b64_image = base64.b64encode(image_bytes).decode('utf-8')
        try:
            # Requires model_call_fn to support base64 image input payloads
            response = await self.model_call_fn(
                prompt=prompt,
                image_b64=b64_image
            )
            return response
        except Exception as e:
            logger.error(f"Error analyzing screenshot: {e}")
            return "Failed to analyze image."

    async def find_element_on_screen(self, element_description: str) -> tuple[int, int] | None:
        """Uses OCR first, then falls back to vision model to find coordinates."""
        image_bytes = self.screen_engine.capture_full()
        
        # 1. Try OCR matching
        pos = self.ocr_engine.find_text(image_bytes, element_description)
        if pos:
            logger.info(f"Found '{element_description}' via OCR at {pos}")
            return pos

        # 2. Try Vision AI
        prompt = f"Find the center coordinates (x, y) of the '{element_description}'. Reply ONLY with 'x,y' or 'NOT_FOUND'."
        response = await self.analyze_screenshot(image_bytes, prompt)
        
        if 'NOT_FOUND' in response:
            return None
            
        try:
            parts = response.strip().split(',')
            x, y = int(parts[0].strip()), int(parts[1].strip())
            return (x, y)
        except Exception as e:
            logger.warning(f"Failed to parse vision model response for coordinates: {response}")
            return None

    def read_text_from_image(self, image_bytes: bytes) -> str:
        return self.ocr_engine.extract_text(image_bytes)

    def detect_changes(self, before: bytes, after: bytes) -> list[ChangeRegion]:
        try:
            import cv2
            import numpy as np
        except ImportError:
            logger.warning("cv2 or numpy missing. Cannot compute visual diff.")
            return []

        # Convert bytes to numpy arrays
        nparr_b = np.frombuffer(before, np.uint8)
        nparr_a = np.frombuffer(after, np.uint8)
        
        img_b = cv2.imdecode(nparr_b, cv2.IMREAD_GRAYSCALE)
        img_a = cv2.imdecode(nparr_a, cv2.IMREAD_GRAYSCALE)
        
        if img_b is None or img_a is None or img_b.shape != img_a.shape:
            return []

        diff = cv2.absdiff(img_b, img_a)
        _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        regions = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w * h > 100: # ignore tiny noise
                magnitude = float(np.sum(diff[y:y+h, x:x+w]))
                regions.append(ChangeRegion(x, y, w, h, magnitude))
                
        return regions
