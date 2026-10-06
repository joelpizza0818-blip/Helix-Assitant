import logging
from dataclasses import dataclass
import importlib.util
import io

logger = logging.getLogger(__name__)

@dataclass
class TextRegion:
    text: str
    x: int
    y: int
    width: int
    height: int
    confidence: float

class OCREngine:
    def __init__(self, provider: str = 'easyocr'):
        self.provider = provider
        self._reader = None
        
        if self.provider == 'easyocr':
            if importlib.util.find_spec('easyocr') is None:
                logger.warning("easyocr not installed, falling back to pytesseract")
                self.provider = 'pytesseract'
            else:
                import easyocr
                self._reader = easyocr.Reader(['en'], gpu=False) # Allow GPU if available in env
                
        if self.provider == 'pytesseract':
            if importlib.util.find_spec('pytesseract') is None:
                raise ImportError("Neither easyocr nor pytesseract are installed. Please install one for OCR.")

    def _preprocess_image(self, image_bytes: bytes):
        import cv2
        import numpy as np
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Basic denoising
        denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
        return denoised

    def extract_text(self, image_bytes: bytes) -> str:
        regions = self.extract_text_regions(image_bytes)
        return " ".join([r.text for r in regions])

    def extract_text_regions(self, image_bytes: bytes) -> list[TextRegion]:
        regions = []
        if self.provider == 'easyocr':
            img = self._preprocess_image(image_bytes)
            results = self._reader.readtext(img)
            for (bbox, text, prob) in results:
                (tl, tr, br, bl) = bbox
                x = int(tl[0])
                y = int(tl[1])
                w = int(tr[0] - tl[0])
                h = int(br[1] - tr[1])
                regions.append(TextRegion(text, x, y, w, h, prob))
                
        elif self.provider == 'pytesseract':
            import pytesseract
            from PIL import Image
            img = Image.open(io.BytesIO(image_bytes))
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                text = data['text'][i].strip()
                if int(data['conf'][i]) > 0 and text:
                    regions.append(TextRegion(
                        text=text,
                        x=data['left'][i],
                        y=data['top'][i],
                        width=data['width'][i],
                        height=data['height'][i],
                        confidence=float(data['conf'][i]) / 100.0
                    ))
        return regions

    def find_text(self, image_bytes: bytes, search_text: str) -> tuple[int, int] | None:
        search_text = search_text.lower()
        regions = self.extract_text_regions(image_bytes)
        
        for r in regions:
            if search_text in r.text.lower():
                center_x = r.x + (r.width // 2)
                center_y = r.y + (r.height // 2)
                return (center_x, center_y)
                
        return None
