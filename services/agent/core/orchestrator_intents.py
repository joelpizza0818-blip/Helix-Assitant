import json
import logging
import platform
import re

try:
    from services.agent.ai.base_provider import ChatMessage
    from services.agent.core.orchestrator_content import compact_conversation_history as _compact_conversation_history
    from services.agent.core.runtime_context import describe_runtime_os
    from services.agent.perception.screen_observation_policy import screen_observation_scope
except ImportError:
    from ai.base_provider import ChatMessage
    from core.orchestrator_content import compact_conversation_history as _compact_conversation_history
    from core.runtime_context import describe_runtime_os
    from perception.screen_observation_policy import screen_observation_scope

logger = logging.getLogger(__name__)


_SCREEN_OBSERVATION_INTENT = re.compile(
    r"\b(?:"
    r"(?:look\s+at|inspect|describe|summari[sz]e|read|check|analy[sz]e|"
    r"mira|observa|describe|resume|lee|revisa|inspecciona)"
    r"\s+(?:(?:my|the|current|active|open|this|mi|la|el|actual)\s+)?"
    r"(?:screen|desktop|window|pantalla|escritorio|ventana|"
    r"(?:open|active|current)\s+"
    r"(?:(?:microsoft\s+)?(?:word|excel|notepad)\s+)?"
    r"(?:window|app|application|aplicaci[o\u00f3]n))"
    r"|what(?:'s|\s+is)\s+(?:on|in|inside)\s+"
    r"(?:(?:my|the|current|active|this)\s+)?"
    r"(?:screen|desktop|window)"
    r"|what(?:'s|\s+is)\s+(?:in|inside)\s+"
    r"(?:the\s+)?(?:open|active|current)\s+"
    r"(?:(?:microsoft\s+)?(?:word|excel|notepad)\s+)?"
    r"(?:window|app|application)"
    r"|what(?:'s|\s+is)\s+(?:visible|shown|displayed)\s+(?:in|on)\s+"
    r"(?:(?:the\s+)?(?:my|the|current|active|this)\s+)?"
    r"(?:screen|desktop|window)"
    r"|(?:qu[e\u00e9]|que)\s+(?:hay|aparece|se\s+ve|ves)\s+"
    r"(?:en|dentro\s+de)\s+(?:(?:la|mi)\s+)?"
    r"(?:pantalla|escritorio|ventana)(?:\s+(?:abierta|actual))?"
    r"|(?:take|capture|grab|make)\s+(?:a\s+)?"
    r"(?:screenshot|screen\s+capture|capture\s+of\s+(?:the\s+)?screen)"
    r"|(?:toma|haz|captura)\s+(?:una?\s+)?"
    r"(?:captura(?:\s+de\s+pantalla)?|pantallazo)"
    r")\b",
    re.IGNORECASE,
)
_SCREEN_ACTION_INTENT = re.compile(
    r"(?:"
    r"\b(?:use|uses|utili[sz]e|usa|usar|utiliza|utilice)\s+"
    r"(?:(?:the|el|la|mi)\s+)?"
    r"(?:computer[-\s]+use|desktop[-\s]+control|"
    r"control(?:ar)?\s+(?:del|de|de\s+la|de\s+mi)\s+"
    r"(?:escritorio|computadora|ordenador))\b"
    r"|^\s*(?:(?:please|kindly|por\s+favor)\s+)?"
    r"(?:controla|maneja|opera)\s+"
    r"(?:(?:el|mi|la)\s+)?(?:escritorio|computadora|ordenador)\b"
    r"|"
    r"\b(?:use|usa|utiliza)\s+(?:(?:the|el|la|mi)\s+)?"
    r"(?:desktop|computer|escritorio|computadora)\s+"
    r"(?:control|to|para)\b"
    r"|^\s*(?:(?:please|kindly|por\s+favor)\s+)?"
    r"(?:"
    r"(?:open|launch|start|abre|inicia|ejecuta)\s+"
    r"(?:(?:the|my|a|an|la|el|mi|un|una)\s+)?"
    r"[\w.-]+(?:\s+[\w.-]+){0,2}\s+"
    r"(?:and|then|y|luego)\s+"
    r"(?:click|clic|tap|press|select|choose|type|write|paste|drag|"
    r"pulsa|selecciona|escribe|pega|arrastra)\b"
    r"|"
    r"(?:click|clic|tap|press|select|choose|type|write|paste|drag|"
    r"haz\s+clic(?:\s+en)?|pulsa|selecciona|escribe|pega|arrastra)"
    r"\s+(?:(?:the|a|an|my|this|el|la|un|una|mi)\s+)?"
    r"(?:"
    r"(?:microsoft\s+)?(?:word|excel|notepad)\s+"
    r"(?:app|application|document|window|icon|aplicaci[o\u00f3]n|"
    r"documento|ventana|icono)|"
    r"(?:microsoft\s+)?(?:word|excel|notepad)\s+"
    r"(?:button|menu|link|element|bot[o\u00f3]n|men[u\u00fa]|enlace|elemento)|"
    r"(?:app|application|aplicaci[o\u00f3]n)\s+"
    r"(?:microsoft\s+)?(?:word|excel|notepad)|"
    r"(?:save|submit|close|menu|button|link|icon|element|"
    r"guardar|enviar|cerrar|men[u\u00fa]|bot[o\u00f3]n|enlace|icono|elemento)"
    r"(?:\s+(?:button|menu|link|icon|element|bot[o\u00f3]n|men[u\u00fa]|"
    r"enlace|icono|elemento))?\s+"
    r"(?:on|in|en)\s+"
    r"(?:(?:the|my|current|active|this|el|la|mi|actual)\s+)?"
    r"(?:screen|desktop|window|pantalla|escritorio|ventana)"
    r")))\b",
    re.IGNORECASE,
)
_REQUESTED_DESKTOP_ACTION = re.compile(
    r"\b(?:"
    r"(?:quiero|necesito|puedes|podr[ií]as)\s+(?:que\s+)?"
    r"(?:abras|inicies|ejecutes|uses|utilices|escribas|selecciones|"
    r"busques|encuentres|hagas\s+clic)"
    r"|(?:i\s+want\s+you\s+to|please|can\s+you|could\s+you)\s+"
    r"(?:open|launch|start|click|type|write|select|use)"
    r").{0,80}\b(?:word|excel|notepad|bloc\s+de\s+notas|"
    r"window|screen|desktop|ventana|pantalla|escritorio|"
    r"aplicaci[oó]n|app)\b",
    re.IGNORECASE,
)
_DESKTOP_CONTROL_TOOL_REQUIRED = re.compile(
    r"(?:"
    r"\b(?:use|utili[sz]e|usa|utiliza)\s+(?:(?:the|el|la|mi)\s+)?"
    r"(?:desktop|computer|escritorio|computadora)\s+"
    r"(?:control|use|automation|control)\b"
    r"|^\s*(?:(?:please|kindly|por\s+favor)\s+)?"
    r"(?:open|launch|start|abre|inicia|ejecuta)\s+"
    r"[\w.-]+(?:\s+[\w.-]+){0,2}\s+(?:and|then|y|luego)\s+"
    r"(?:click|clic|tap|press|select|choose|type|write|paste|drag|"
    r"pulsa|selecciona|escribe|pega|arrastra)\b"
    r")",
    re.IGNORECASE,
)
_METALINGUISTIC_INTENT = re.compile(
    r"^\s*(?:"
    r"what\s+does\b.*\bmean\b|"
    r"what\s+is\s+the\s+meaning\s+of\b|"
    r"explain\b.*\b(?:mean|means|meaning)\b|"
    r"explain\s+(?:the\s+)?(?:word|phrase|sentence|expression|term)\b|"
    r"translate\b|translation\b|"
    r"qu[e\u00e9]\s+(?:significa|quiere\s+decir)\b|"
    r"explica(?:r)?\b.*\b(?:significa|quiere\s+decir|significado)\b|"
    r"explica(?:r)?\s+(?:la\s+|el\s+)?(?:palabra|frase|oraci[o\u00f3]n|expresi[o\u00f3]n|t[e\u00e9]rmino)\b|"
    r"traduce\b|traducci[o\u00f3]n\b"
    r")",
    re.IGNORECASE,
)
_OS_QUERY_INTENT = re.compile(
    r"\b(?:what|which)\s+(?:operating system|os)\s+"
    r"(?:is\s+(?:helix|this computer|my computer)\s+running|"
    r"(?:am i|is helix|is this computer|is my computer)\s+"
    r"(?:running|using|on)|does helix run on)\b"
    r"|\bwhat\s+(?:is\s+)?(?:my|this computer's|helix's)\s+"
    r"(?:operating system|os)\b"
    r"|\b(?:qué|que)\s+(?:sistema operativo|os)\s+"
    r"(?:(?:está|esta)\s+(?:usando|corriendo|ejecutando)\s+"
    r"(?:helix|esta computadora|este equipo|mi computadora|mi equipo)|"
    r"(?:usa|corre|ejecuta|tiene)\s+"
    r"(?:helix|esta computadora|este equipo|mi computadora|mi equipo)|"
    r"(?:tengo instalado|tengo)\b)"
    r"|\b(?:qué|que)\s+versión\s+de\s+windows\s+tengo\b",
    re.IGNORECASE,
)
def _conversation_failure_message(error: Exception) -> str:
    """Expose safe, actionable provider failures without leaking credentials."""
    code = getattr(error, "code", "") or ""
    detail = f"{code} {error}".upper()
    if "QUOTA_EXCEEDED" in detail or "RESOURCE_EXHAUSTED" in detail:
        return (
            "La cuota del proveedor de IA está agotada. La clave es válida, "
            "pero el proveedor rechazó esta solicitud por límite de uso. "
            "Cambia de proveedor o clave, o espera a que se renueve la cuota."
        )
    if "BILLING_EXHAUSTED" in detail:
        return (
            "La facturación del proveedor de IA está agotada o deshabilitada. "
            "Revisa el plan de la cuenta o cambia de proveedor."
        )
    if "TIMEOUT" in detail:
        return (
            "El modelo tardó demasiado en responder y se agotaron las alternativas "
            "disponibles. Inténtalo de nuevo o selecciona otro modelo."
        )
    if "NETWORK_ERROR" in detail:
        return (
            "HELIX no pudo conectar con el proveedor de IA y agotó las alternativas. "
            "Revisa tu conexión e inténtalo de nuevo."
        )
    if "RATE_LIMIT" in detail:
        return (
            "Los proveedores de IA están limitando las solicitudes. Espera un momento "
            "o selecciona otro modelo."
        )
    if "MODEL_TEMPORARILY_UNAVAILABLE" in detail:
        return (
            "Los modelos disponibles están temporalmente saturados. Espera un momento "
            "o selecciona otro modelo."
        )
    if "AUTH_ERROR" in detail:
        return (
            "El proveedor rechazó la autenticación. Vuelve a validar la clave "
            "en la configuración de IA."
        )
    if "MODEL_UNAVAILABLE" in detail:
        return (
            "El modelo seleccionado no está disponible para esta clave. "
            "Selecciona otro modelo o proveedor."
        )
    if "CONTEXT_LENGTH_EXCEEDED" in detail or "PROMPT_TOO_LONG" in detail:
        return (
            "La tarea superó el contexto que acepta el modelo incluso después "
            "de compactar el historial y probar rutas compatibles. Puedo "
            "continuarla en partes más pequeñas para conservar todos los detalles."
        )
    if "CHECKPOINT" in detail or "CREDENTIAL STORE" in detail:
        return (
            "No se pudo leer o guardar de forma segura el estado interno de "
            "recuperación. HELIX detuvo el workflow; la última acción podría "
            "haberse ejecutado, así que verifica su resultado antes de reintentar. "
            "Comprueba el almacén seguro de credenciales del sistema."
        )
    return "No pude completar la solicitud. Revisa la configuración del proveedor de IA y vuelve a intentarlo."


def _should_observe_screen(enabled: bool, description: str) -> bool:
    """Recognize explicit screen-inspection requests without capturing unrelated turns."""
    if not enabled or _METALINGUISTIC_INTENT.search(description):
        return False
    return bool(
        _SCREEN_OBSERVATION_INTENT.search(description)
        or _SCREEN_ACTION_INTENT.search(description)
        or _REQUESTED_DESKTOP_ACTION.search(description)
    )


def _should_control_desktop(enabled: bool, description: str) -> bool:
    """Recognize explicit desktop actions without enabling general screen access."""
    if not enabled or _METALINGUISTIC_INTENT.search(description):
        return False
    return bool(
        _SCREEN_ACTION_INTENT.search(description)
        or _REQUESTED_DESKTOP_ACTION.search(description)
    )


def _requires_desktop_control_tool(enabled: bool, description: str) -> bool:
    """Identify tasks that must stay on the dedicated desktop-control tool."""
    if not enabled or _METALINGUISTIC_INTENT.search(description):
        return False
    return bool(
        _DESKTOP_CONTROL_TOOL_REQUIRED.search(description)
        or _should_control_desktop(enabled, description)
    )


async def _append_requested_screen_observation(
    messages: list,
    tool_registry,
    task_id: str,
) -> None:
    """Attach a safe screen observation or explain why it is unavailable."""
    observe_tool = tool_registry.get_tool("computer.observe_screen")
    observation = None
    failure = None
    if observe_tool is None:
        failure = "Screen observation tool is unavailable."
    else:
        try:
            with screen_observation_scope(True):
                observation = await observe_tool.execute({})
        except Exception as error:
            logger.exception(
                "On-demand screen observation raised an error for task %s",
                task_id,
            )
            failure = f"Screen observation failed ({type(error).__name__})."

    observed = getattr(observation, "output", None)
    if failure is None and (
        observation is None or not getattr(observation, "success", False)
    ):
        logger.error(
            "On-demand screen observation failed for task %s: %s",
            task_id,
            getattr(observation, "error", None) or "tool returned no result",
        )
        failure = "Screen observation failed; check the agent log for details."
    if failure is None and not isinstance(observed, dict):
        logger.error(
            "On-demand screen observation returned invalid context for task %s",
            task_id,
        )
        failure = "Screen observation returned invalid context."

    if failure is not None:
        messages.append(ChatMessage(
            role="user",
            content=(
                f"{failure} Do not claim to know what is visible on screen."
            ),
        ))
        return

    observed = dict(observed)
    screenshot = observed.pop("screenshot_bytes", None)
    if not isinstance(screenshot, bytes) or not screenshot:
        logger.error(
            "On-demand screen observation returned no image for task %s",
            task_id,
        )
        messages.append(ChatMessage(
            role="user",
            content=(
                "Screen observation failed because no image was returned. "
                "Do not claim to know what is visible on screen."
            ),
        ))
        return

    screen_summary = json.dumps(observed, ensure_ascii=False, default=str)
    messages.append(ChatMessage(
        role="user",
        content=(
            "Screen observation before acting (structured window, "
            f"accessibility, and OCR context):\n{screen_summary}"
        ),
        image_bytes=screenshot,
    ))


def _fast_os_answer(text: str, tool_registry=None) -> str | None:
    """Answer supported runtime and operating-system questions without a model call."""
    if not _OS_QUERY_INTENT.search(text):
        return None
    os_name = platform.system()
    operating_system_name = describe_runtime_os()
    architecture = platform.machine()
    shell_tool = tool_registry.get_tool("shell_tool") if tool_registry else None
    shell = getattr(shell_tool, "default_shell_type", None) or (
        "powershell" if os_name == "Windows" else "bash"
    )
    is_spanish = bool(
        re.search(r"\b(qué|que|sistema|está|esta|corre|ejecuta|usa|helix)\b", text, re.I)
    )
    if os_name == "Windows":
        shell_name = {
            "powershell": "PowerShell",
            "cmd": "CMD",
            "wsl": "WSL Bash",
            "bash": "Bash",
        }.get(shell, shell)
        shell_description = (
            f"el shell configurado es {shell_name}"
            if is_spanish
            else f"configured shell is {shell_name}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    elif os_name == "Darwin":
        shell_description = (
            f"el shell configurado es {shell}"
            if is_spanish
            else f"configured shell is {shell}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    else:
        shell_description = (
            f"el shell configurado es {shell}"
            if is_spanish
            else f"configured shell is {shell}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    if is_spanish:
        return f"HELIX está ejecutándose en {description}"
    return f"HELIX is running on {description}"
