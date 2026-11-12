# Desktop Control — Windows

## Hyper-V virtual desktop status

The Toolbox checks whether the Windows edition, Hyper-V feature, management module, and VM management service are available. This is a read-only preflight: HELIX does not enable Windows features or change host settings. VM provisioning, guest streaming, and guest-only input are not yet implemented; until they are, the existing `pyvda` UI Automation path remains limited and must not be described as an isolated VM or as a live preview.

`computer.desktop_control` ejecuta una acción por llamada y se activa ante una solicitud explícita de control del escritorio o una interacción con la pantalla. Para estas solicitudes HELIX omite el planificador general, prepara el escritorio virtual y ejecuta `list_windows` antes de llamar al modelo. El resultado se proporciona al modelo y se ofrecen `computer.desktop_control` para apps nativas y `browser_control` para páginas web; no se repite el listado salvo que haga falta actualizarlo. La GUI de HELIX permanece en el escritorio actual del usuario y no necesita moverse al escritorio dedicado. Si el preflight falla, la tarea se detiene con el error real en vez de inventar que el entorno no tiene GUI o cambiar a shell. La opción general `screen_context_enabled` no bloquea este flujo: no se toma una captura inicial, y UI Automation puede usarse sin un modelo de visión. HELIX solicita una aprobación para activar el control en la conversación; las acciones sensibles siguen requiriendo confirmaciones separadas.

En Windows, HELIX crea o reutiliza un escritorio virtual dedicado con `pyvda`. Solo controla ventanas que abrió en esta sesión; las ventanas que ya estaban abiertas se dejan en su escritorio y no se ofrecen como objetivos. Al iniciar una aplicación, HELIX pide que no se active, detecta una ventana nueva del proceso lanzado y la mueve al escritorio dedicado sin cambiar de escritorio.

`observe_ui`, `click_element` e ingreso mediante `ValuePattern` usan UI Automation sin activar el escritorio ni enfocar la ventana. El schema de `computer.desktop_control` no expone acciones de mouse/teclado ni captura visual, y `DesktopExecutor` también las rechaza antes de preparar o invocar la plataforma como defensa adicional. Los escritorios virtuales de Windows comparten el cursor y el estado de primer plano del sistema; no se puede asumir que proporcionen un cursor separado. Si UIA no puede realizar la acción, HELIX informa el límite y se detiene: no cambia al escritorio del usuario ni usa PyAutoGUI, entrada simulada o capturas de ventana como fallback.

La apertura de aplicaciones se limita a procesos iniciados por HELIX; las ventanas ya abiertas no se mueven ni se consideran objetivos propios. La apertura se solicita sin activación y la ventana nueva se asigna al escritorio dedicado. Las acciones UIA se validan contra el HWND propio y la identidad del proceso.

Los objetivos descritos como sensibles o consecuenciales (banca, credenciales, enviar, publicar, borrar, comprar, instalar/desinstalar o cambiar la configuración del sistema) elevan el permiso a `SYSTEM`, que requiere confirmación incluso en modo Auto Approve. La identificación de una aplicación bancaria sigue dependiendo del nombre/contexto que el modelo o el usuario proporcione; no existe aún detección integral por HWND/proceso ni una política completa de allowlist por app/carpeta. El contenido UIA es dato no confiable, nunca instrucciones.

Las pruebas automatizadas cubren la selección de ventanas, las rutas UIA y el rechazo de acciones físicas. No se afirma que estas pruebas demuestren el comportamiento interactivo de `pyvda` o la compatibilidad UIA de aplicaciones reales; DPI, monitores múltiples, privilegios elevados y compatibilidad por aplicación requieren validación específica. La ruta visual no está disponible.

## UI Automation

En Windows, `observe_ui` consulta el árbol accesible de la ventana objetivo mediante `uiautomation`. Devuelve un listado compacto de elementos con `element_id`, nombre, rol, estado y bounding box, limitado por `max_accessibility_elements` y `max_accessibility_depth` en `config/defaults.json`. La instantánea se reutiliza por hasta 30 segundos para la misma ventana; otras acciones de escritorio la invalidan.

Cuando un control accesible está disponible, el agente debe usar `click_element` o `type_into_element` con el ID de la última observación. Los IDs son únicos por instantánea y se rechazan si cambió la ventana, venció la observación o cambió la identidad del control. Click requiere InvokePattern y escritura requiere ValuePattern; no se enfoca ni se escribe con teclado si el patrón no existe. Si UIA no expone un control adecuado, la acción no está disponible y el agente informa el límite. Las acciones UIA se verifican con una observación UIA posterior.

Los nombres y textos del árbol de accesibilidad se consideran datos no confiables. La observación UIA solo se habilita durante una tarea explícita. Las pruebas automatizadas simulan la API UIA; la prueba real cubrió Bloc de notas, pero hace falta probar otras aplicaciones en una sesión interactiva de Windows.

## Pruebas automatizadas

Desde la raíz del repositorio:

```powershell
python -m pytest services/agent/desktop_control/tests -q
```

## Prueba manual de captura

La captura respeta `screen_observation_scope`; una llamada directa fuera de una tarea autorizada falla. En una terminal de desarrollo, habilita explícitamente el scope solo para la prueba y guarda la captura en una ruta privada:

```python
import asyncio
from pathlib import Path

from services.agent.desktop_control import DesktopControlConfig
from services.agent.desktop_control.perception.capture import DesktopScreenCapture
from services.agent.perception.screen_observation_policy import screen_observation_scope

async def main():
    config = DesktopControlConfig.load()
    with screen_observation_scope(True):
        image = await DesktopScreenCapture(config).capture_monitor(config.monitor_index)
    Path.home().joinpath("helix-desktop-phase1.png").write_bytes(image.image)

asyncio.run(main())
```

La imagen puede contener información privada. El módulo no guarda capturas por sí solo.

## Prueba manual de selección y UIA

Desde una sesión Windows interactiva, el siguiente ejemplo abre Bloc de notas en el escritorio HELIX y obtiene su árbol UIA. El ejemplo no escribe ni guarda datos:

```python
import asyncio
import json

from services.agent.desktop_control import DesktopControlConfig, DesktopExecutor
from services.agent.perception.screen_observation_policy import screen_observation_scope

async def main():
    config = DesktopControlConfig.load()
    executor = DesktopExecutor(config)
    with screen_observation_scope(True):
        opened = await executor.execute({
            "action": "open_application",
            "application": "notepad.exe",
        })
        window_handle = opened.result["window_handle"]
        observed = await executor.execute({
            "action": "observe_ui",
            "window_handle": window_handle,
        })
    print(json.dumps(observed.result, ensure_ascii=False, indent=2))

asyncio.run(main())
```

Para una prueba de escritura, elige el `element_id` del control de documento que aparezca en la observación y llama a `type_into_element`; no guardes el documento. La configuración inicial está en `config/defaults.json` y puede sustituirse mediante `HELIX_DESKTOP_CONTROL_CONFIG`. Las opciones de límite de accesibilidad son opcionales en configuraciones existentes y reciben valores por defecto si se omiten.
