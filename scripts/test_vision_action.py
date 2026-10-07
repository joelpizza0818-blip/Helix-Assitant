import asyncio
import sys
import os

# Añadir el root directory al sys.path para importar correctamente
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'services', 'agent')))

from perception.screen_engine import ScreenEngine
from perception.ocr_engine import OCREngine
from tools.mouse_tool import MouseTool

async def main():
    print("Iniciando prueba de Visión e Interacción de HELIX...")
    
    # 1. Prueba de Interacción (Movimiento del ratón visible para el usuario)
    print("\n[Acción] Inicializando MouseTool...")
    mouse = MouseTool()
    
    print("[Acción] Obteniendo posición actual del ratón...")
    start_x, start_y = await mouse.get_position()
    print(f"Posición actual: X={start_x}, Y={start_y}")
    
    print("[Acción] Moviendo el ratón en un pequeño cuadrado (para demostración visible)...")
    await mouse.move(start_x + 100, start_y)
    await asyncio.sleep(0.5)
    await mouse.move(start_x + 100, start_y + 100)
    await asyncio.sleep(0.5)
    await mouse.move(start_x, start_y + 100)
    await asyncio.sleep(0.5)
    await mouse.move(start_x, start_y)
    print("[Acción] Movimiento completado con éxito.")
    
    # 2. Prueba de Visión (Captura de pantalla)
    print("\n[Visión] Inicializando ScreenEngine...")
    screen = ScreenEngine()
    
    print("[Visión] Obteniendo resolución de pantalla...")
    width, height = screen.get_screen_resolution()
    print(f"Resolución de pantalla secundaria/principal: {width}x{height}")
    
    print("[Visión] Capturando pantalla completa...")
    img_bytes = screen.capture_full()
    print(f"Captura exitosa: obtenida imagen de {len(img_bytes)} bytes.")
    
    # 3. Prueba de Percepción (Extracción de texto OCR)
    print("\n[Percepción] Inicializando OCREngine (Pytesseract/EasyOCR)...")
    try:
        ocr = OCREngine()
        print("[Percepción] Extrayendo texto de la captura (primeras palabras)...")
        text_regions = ocr.extract_text_regions(img_bytes)
        if text_regions:
            print(f"¡Éxito! Se encontraron {len(text_regions)} regiones de texto en la pantalla.")
            print("Ejemplos de texto detectado:")
            for i, region in enumerate(text_regions[:5]): # Mostrar hasta 5 resultados
                print(f"  - '{region.text}' en (x:{region.x}, y:{region.y}) con {region.confidence*100:.1f}% de confianza")
        else:
            print("No se detectó texto claro en la pantalla.")
    except Exception as e:
        print(f"El OCR falló o no está instalado correctamente: {e}")

    print("\n¡Prueba completada exitosamente!")

if __name__ == "__main__":
    asyncio.run(main())
