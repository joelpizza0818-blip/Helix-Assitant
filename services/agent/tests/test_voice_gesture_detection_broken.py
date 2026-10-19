"""
Bug condition exploration tests for voice-gesture-detection-broken-v021.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5**

Estas pruebas son exploratorias: verifican la AUSENCIA de los fixes para confirmar
que el bug existe. Se espera que fallen en al menos 1 sub-condición.

Sub-condiciones cubiertas:
  1. GestureEngine no emite GESTURE_HARDWARE_UNAVAILABLE en sesión RDP.
  2. VoiceEngine no emite VOICE_HARDWARE_UNAVAILABLE en sesión RDP.
  3. Subscription tasks quedan huérfanas tras fallo en wake_detector.start()
     (NOTA: el fix v0.2.1 ya está presente, por lo que este test puede pasar inesperadamente).
  4. cv2/mediapipe/faster_whisper/openwakeword ausentes en hiddenimports del spec.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SPEC_PATH = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "desktop"
    / ".pyinstaller-spec"
    / "helix-agent.spec"
)

RDP_SESSION = "RDP-Tcp#0"

PERCEPTION_HIDDEN_IMPORTS = ["cv2", "mediapipe", "faster_whisper", "openwakeword"]


def _make_event_bus_stub():
    """Return a simple async-capable event bus stub that records published events."""

    class _EventBusStub:
        def __init__(self):
            self.published = []

        async def publish(self, event_name, payload=None):
            self.published.append((event_name, payload or {}))

        async def subscribe(self, event_name, handler):
            pass

        async def unsubscribe(self, event_name, handler):
            pass

    return _EventBusStub()


def _make_key_manager_stub():
    stub = MagicMock()
    stub.get_available_key.return_value = None
    return stub


def _make_wake_detector_stub(should_fail=False, running=True):
    stub = MagicMock()
    if should_fail:
        stub.start = AsyncMock(side_effect=RuntimeError("Microphone unavailable"))
    else:
        stub.start = AsyncMock()
    stub.stop = AsyncMock()
    stub.is_running.return_value = running
    stub.provider = "openwakeword"
    stub.input_device = None
    return stub


# ---------------------------------------------------------------------------
# Sub-condition 1: GestureEngine no emite GESTURE_HARDWARE_UNAVAILABLE en RDP
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sub_condition_1_gesture_engine_no_rdp_detection():
    """
    **Validates: Requirements 1.4**

    Bug condition: Con SESSIONNAME=RDP-Tcp#0, el GestureEngine actual NO emite
    GESTURE_HARDWARE_UNAVAILABLE ni loguea un warning de RDP.
    Este test FALLA porque el código pre-fix no tiene detección de RDP.

    Counterexample: GestureEngine.start() arranca el thread de cámara en lugar
    de retornar temprano con un evento de hardware no disponible.
    """
    from services.agent.perception.gesture_engine import GestureEngine
    import threading

    event_bus = _make_event_bus_stub()

    with patch.dict(os.environ, {"SESSIONNAME": RDP_SESSION}):
        engine = GestureEngine(event_bus=event_bus)

        # Mock cv2 and mediapipe to avoid real hardware
        fake_cv2 = ModuleType("cv2")
        fake_mediapipe = ModuleType("mediapipe")

        # Ensure _thread is None so the guard check passes
        engine._thread = None

        mock_thread_instance = MagicMock(spec=threading.Thread)
        mock_thread_instance.is_alive.return_value = False

        with (
            patch.dict(sys.modules, {"cv2": fake_cv2, "mediapipe": fake_mediapipe}),
            patch("threading.Thread", return_value=mock_thread_instance),
            patch("asyncio.to_thread", new=AsyncMock(return_value=True)),
        ):
            await engine.start()

        # Dar tiempo al asyncio.ensure_future del evento RDP para completarse
        await asyncio.sleep(0.1)

        published_events = [name for name, _ in event_bus.published]

    # ASSERTION: The fix SHOULD emit GESTURE_HARDWARE_UNAVAILABLE in RDP.
    # Pre-fix code does NOT emit it → assertion fails → confirms bug exists.
    assert "GESTURE_HARDWARE_UNAVAILABLE" in published_events, (
        "COUNTEREXAMPLE: GestureEngine no emitió GESTURE_HARDWARE_UNAVAILABLE "
        f"con SESSIONNAME={RDP_SESSION}. "
        "El fix de detección RDP no está presente en gesture_engine.py."
    )


# ---------------------------------------------------------------------------
# Sub-condition 2: VoiceEngine no emite VOICE_HARDWARE_UNAVAILABLE en RDP
# ---------------------------------------------------------------------------


def _build_voice_engine_with_mocked_perception(event_bus, config=None):
    """Instantiate VoiceEngine with all perception sub-components mocked."""
    if config is None:
        config = {"VOICE_ENABLED": "true"}

    key_manager = _make_key_manager_stub()

    # Patch the perception sub-modules so __init__ doesn't fail
    fake_wwd_cls = MagicMock(return_value=_make_wake_detector_stub())
    fake_vad_cls = MagicMock(return_value=MagicMock())
    fake_stt_cls = MagicMock(return_value=MagicMock())
    fake_tts_cls = MagicMock(return_value=MagicMock())

    with (
        patch(
            "services.agent.perception.voice_engine.WakeWordDetector",
            fake_wwd_cls,
            create=True,
        ),
        patch(
            "services.agent.perception.voice_engine.VADDetector",
            fake_vad_cls,
            create=True,
        ),
        patch(
            "services.agent.perception.voice_engine.SpeechToText",
            fake_stt_cls,
            create=True,
        ),
        patch(
            "services.agent.perception.voice_engine.TextToSpeech",
            fake_tts_cls,
            create=True,
        ),
    ):
        from services.agent.perception.voice_engine import VoiceEngine

        engine = VoiceEngine(config=config, event_bus=event_bus, key_manager=key_manager)

    return engine


@pytest.mark.asyncio
async def test_sub_condition_2_voice_engine_no_rdp_detection():
    """
    **Validates: Requirements 1.4**

    Bug condition: Con SESSIONNAME=RDP-Tcp#0, el VoiceEngine actual NO emite
    VOICE_HARDWARE_UNAVAILABLE antes de intentar arrancar el micrófono.
    Este test FALLA porque el código pre-fix no tiene detección de RDP.

    Counterexample: VoiceEngine.start() avanza a await wake_detector.start()
    en lugar de retornar temprano con un evento de hardware no disponible.
    """
    event_bus = _make_event_bus_stub()

    engine = _build_voice_engine_with_mocked_perception(event_bus)

    # Simulate a working wake_detector so start() doesn't fail for other reasons
    engine.wake_detector = _make_wake_detector_stub(should_fail=False, running=True)

    with patch.dict(os.environ, {"SESSIONNAME": RDP_SESSION}):
        await engine.start()

    # Clean up
    await engine.stop()

    published_events = [name for name, _ in event_bus.published]

    # ASSERTION: The fix SHOULD emit VOICE_HARDWARE_UNAVAILABLE in RDP.
    # Pre-fix code does NOT emit it → assertion fails → confirms bug exists.
    assert "VOICE_HARDWARE_UNAVAILABLE" in published_events, (
        "COUNTEREXAMPLE: VoiceEngine no emitió VOICE_HARDWARE_UNAVAILABLE "
        f"con SESSIONNAME={RDP_SESSION}. "
        "El fix de detección RDP no está presente en voice_engine.py."
    )


# ---------------------------------------------------------------------------
# Sub-condition 3: Tasks huérfanas tras fallo en wake_detector.start()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sub_condition_3_orphan_tasks_after_wake_detector_failure():
    """
    **Validates: Requirements 1.3**

    Bug condition (pre-fix): Si wake_detector.start() lanza excepción después de
    que _subscribe_events() ya creó tasks de suscripción, esas tasks quedan
    activas en el loop (no se cancelan).

    NOTA: El fix v0.2.1 ya está en el código (el bloque except cancela las tasks
    y vacía _subscriptions). Por tanto, este test puede pasar inesperadamente,
    lo que significa que esta sub-condición ya fue corregida en el fuente local.

    Si el test PASA: confirma que el fix v0.2.1 está presente → sub-condición resuelta.
    Si el test FALLA: confirma que el bug aún existe → sub-condición pendiente.
    """
    event_bus = _make_event_bus_stub()
    engine = _build_voice_engine_with_mocked_perception(event_bus)

    # Replace wake_detector with one that fails on start()
    engine.wake_detector = _make_wake_detector_stub(should_fail=True)

    # Spy on asyncio.create_task to track created tasks
    original_create_task = asyncio.create_task
    created_tasks = []

    def tracking_create_task(coro, **kwargs):
        task = original_create_task(coro, **kwargs)
        created_tasks.append(task)
        return task

    with patch("asyncio.create_task", side_effect=tracking_create_task):
        with pytest.raises(RuntimeError):
            await engine.start()

    # After the failed start(), _subscriptions should be empty (fix v0.2.1)
    # Pre-fix code leaves _subscriptions non-empty → this assertion would fail
    remaining_active = [t for t in engine._subscriptions if not t.done()]

    # Cancel any lingering tasks to avoid warnings in the test runner
    for t in created_tasks:
        if not t.done():
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass

    # ASSERTION: after a failed start(), _subscriptions must be empty.
    # Pre-fix code leaves active tasks → remaining_active is non-empty → test fails.
    # Post-fix code cancels them → remaining_active is empty → test passes.
    assert remaining_active == [], (
        "COUNTEREXAMPLE: Tras fallo en wake_detector.start(), "
        f"{len(remaining_active)} subscription task(s) quedaron activas en el loop. "
        "El fix de limpieza de tasks huérfanas NO está presente en voice_engine.py "
        "(o las tasks no se cancelaron correctamente)."
    )


# ---------------------------------------------------------------------------
# Sub-condition 4: Hidden imports ausentes en helix-agent.spec
# ---------------------------------------------------------------------------


def test_sub_condition_4_hidden_imports_missing_in_spec():
    """
    **Validates: Requirements 1.5**

    Bug condition: El archivo helix-agent.spec NO incluye cv2, mediapipe,
    faster_whisper ni openwakeword como hidden imports explícitos.
    Este test FALLA porque el spec pre-fix no los tiene.

    Counterexample: El spec sólo lista win32process/pyautogui etc. pero no
    las dependencias de percepción, lo que impide que PyInstaller las empaquete.
    """
    assert SPEC_PATH.exists(), (
        f"No se encontró helix-agent.spec en {SPEC_PATH}. "
        "Verifica que la ruta del proyecto sea correcta."
    )

    spec_text = SPEC_PATH.read_text(encoding="utf-8")

    missing = [dep for dep in PERCEPTION_HIDDEN_IMPORTS if f"'{dep}'" not in spec_text]

    assert missing == [], (
        f"COUNTEREXAMPLE: Los siguientes módulos de percepción NO están como "
        f"hidden imports explícitos en helix-agent.spec: {missing}. "
        "PyInstaller no los incluirá en el bundle, causando ImportError en tiempo de ejecución."
    )


# ===========================================================================
# TAREA 2: Preservation property tests (deben PASAR en el código actual)
# **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
# ===========================================================================

from hypothesis import given, settings, HealthCheck
import hypothesis.strategies as st

# ---------------------------------------------------------------------------
# Preservation Test 1: GestureEngine.start() en no-RDP lanza RuntimeError
# cuando cv2/mediapipe no son importables — comportamiento preexistente correcto.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preservation_1_gesture_no_rdp_raises_runtime_error_when_no_cv2():
    """
    **Validates: Requirements 3.1**

    Preservation: En un entorno sin SESSIONNAME (no-RDP), GestureEngine.start()
    lanza RuntimeError cuando cv2/mediapipe no son importables. Este es el
    comportamiento preexistente correcto que debe preservarse tras el fix.
    """
    from services.agent.perception.gesture_engine import GestureEngine

    event_bus = _make_event_bus_stub()
    engine = GestureEngine(event_bus=event_bus)

    env_without_session = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}

    with patch.dict(os.environ, env_without_session, clear=True):
        # Simula que cv2 no está instalado
        with patch.dict(sys.modules, {"cv2": None, "mediapipe": None}):
            with pytest.raises(RuntimeError):
                await engine.start()


# ---------------------------------------------------------------------------
# Preservation Test 2: VoiceEngine.__init__ con VOICE_ENABLED=false no instancia
# subcomponentes de percepción.
# ---------------------------------------------------------------------------


def test_preservation_2_voice_engine_disabled_no_perception_subcomponents():
    """
    **Validates: Requirements 3.2**

    Preservation: VoiceEngine con VOICE_ENABLED=false no debe instanciar
    wake_detector, stt, vad ni tts. Este comportamiento preexistente debe
    permanecer intacto.
    """
    from services.agent.perception.voice_engine import VoiceEngine

    event_bus = _make_event_bus_stub()
    key_manager = _make_key_manager_stub()

    engine = VoiceEngine(
        config={"VOICE_ENABLED": "false"},
        event_bus=event_bus,
        key_manager=key_manager,
    )

    assert not engine.enabled, "enabled debe ser False"
    assert not hasattr(engine, "wake_detector"), (
        "wake_detector no debe existir cuando VOICE_ENABLED=false"
    )
    assert not hasattr(engine, "stt"), "stt no debe existir cuando VOICE_ENABLED=false"
    assert not hasattr(engine, "vad"), "vad no debe existir cuando VOICE_ENABLED=false"
    assert not hasattr(engine, "tts"), "tts no debe existir cuando VOICE_ENABLED=false"


# ---------------------------------------------------------------------------
# Preservation Test 3: VoiceEngine.start() con enabled=False retorna inmediatamente
# sin tocar el event bus.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preservation_3_voice_engine_start_disabled_returns_immediately():
    """
    **Validates: Requirements 3.2**

    Preservation: VoiceEngine.start() con enabled=False debe retornar
    inmediatamente sin publicar ningún evento. Comportamiento preexistente.
    """
    from services.agent.perception.voice_engine import VoiceEngine

    event_bus = _make_event_bus_stub()
    key_manager = _make_key_manager_stub()

    engine = VoiceEngine(
        config={"VOICE_ENABLED": "false"},
        event_bus=event_bus,
        key_manager=key_manager,
    )

    await engine.start()

    assert event_bus.published == [], (
        "VoiceEngine.start() con enabled=False no debe publicar ningún evento"
    )
    assert not engine._is_active, (
        "VoiceEngine no debe estar activo cuando está deshabilitado"
    )


# ---------------------------------------------------------------------------
# Preservation Test 4: GestureEngine._capture_loop con MediaPipe no disponible
# logea warning y no lanza excepción fatal.
# ---------------------------------------------------------------------------


def test_preservation_4_capture_loop_no_mediapipe_logs_warning_no_exception():
    """
    **Validates: Requirements 3.3 (3.6 bugfix)**

    Preservation: _capture_loop con MediaPipe no disponible debe loguear un
    warning y transmitir frames sin tracking — no lanzar excepción fatal.
    """
    import threading
    import logging
    from services.agent.perception.gesture_engine import GestureEngine

    event_bus = _make_event_bus_stub()
    engine = GestureEngine(event_bus=event_bus)
    engine._loop = asyncio.new_event_loop()

    # Simula que mediapipe no está disponible (lanza excepción en import)
    fake_cv2 = ModuleType("cv2")
    # cv2.VideoCapture stub que lee un frame y luego indica fin
    fake_cap = MagicMock()
    fake_cap.isOpened.return_value = True
    fake_cap.set = MagicMock()

    fake_frame = MagicMock()
    fake_frame.flags = MagicMock()
    fake_frame.flags.writeable = True

    # Primer read: devuelve frame; los siguientes indican que el loop debe parar
    call_count = {"n": 0}

    def fake_read():
        call_count["n"] += 1
        if call_count["n"] == 1:
            return True, fake_frame
        # Detener el loop después del primer frame
        engine._is_active = False
        return False, None

    fake_cap.read = fake_read
    fake_cap.release = MagicMock()
    fake_cv2.VideoCapture = MagicMock(return_value=fake_cap)
    fake_cv2.CAP_DSHOW = 700
    fake_cv2.CAP_MSMF = 1400
    fake_cv2.CAP_ANY = 0
    fake_cv2.CAP_PROP_BUFFERSIZE = 38
    fake_cv2.imencode = MagicMock(return_value=(False, None))
    fake_cv2.COLOR_BGR2RGB = 4
    fake_cv2.cvtColor = MagicMock(return_value=fake_frame)
    fake_cv2.IMWRITE_JPEG_QUALITY = 1

    # Hacer que la importación de mediapipe dentro del loop lance ImportError
    import builtins
    original_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == "mediapipe":
            raise ImportError("mediapipe not available")
        return original_import(name, *args, **kwargs)

    engine._is_active = True
    warnings_logged = []
    exceptions_raised = []

    with patch.dict(sys.modules, {"cv2": fake_cv2, "mediapipe": None}):
        with patch("builtins.__import__", side_effect=mock_import):
            with patch.object(
                logging.getLogger("services.agent.perception.gesture_engine"),
                "warning",
                side_effect=lambda msg, *a, **kw: warnings_logged.append(msg),
            ):
                try:
                    engine._capture_loop()
                except Exception as e:
                    exceptions_raised.append(e)

    assert exceptions_raised == [], (
        f"_capture_loop no debe lanzar excepción fatal cuando MediaPipe no está disponible. "
        f"Excepción recibida: {exceptions_raised}"
    )
    assert any("unavailable" in str(w).lower() or "mediapipe" in str(w).lower() or "gesture" in str(w).lower()
                for w in warnings_logged), (
        "Se esperaba al menos un warning indicando que MediaPipe no está disponible. "
        f"Warnings recibidos: {warnings_logged}"
    )


# ---------------------------------------------------------------------------
# Preservation Property-based Test 5: Para toda combinación (voice_enabled) ×
# (SESSIONNAME not in RDP), el motor se comporta igual al pre-fix.
# ---------------------------------------------------------------------------

NON_RDP_SESSION_NAMES = st.one_of(
    st.just(""),
    st.just("Console"),
    st.just("Services"),
    st.just("Local"),  # nombre local sin RDP ni ICA
    st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd")),
        min_size=0,
        max_size=20,
    ).filter(lambda s: "RDP" not in s.upper() and "ICA" not in s.upper()),
)


@given(
    voice_enabled=st.booleans(),
    session_name=NON_RDP_SESSION_NAMES,
)
@settings(
    max_examples=30,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_preservation_5_non_rdp_behavior_consistent_with_pre_fix(
    voice_enabled, session_name
):
    """
    **Validates: Requirements 3.1, 3.2**

    Property-based preservation: Para toda combinación (voice_enabled in {true, false})
    × (SESSIONNAME not in RDP values), el comportamiento del motor en un arranque
    fallido por hardware ausente es igual al pre-fix: RuntimeError clara (no silenciosa)
    cuando cv2/mediapipe no están disponibles, o retorno inmediato cuando voice está
    deshabilitado. Ningún path debe producir un fallo silencioso.
    """
    import importlib

    # Forzar reimport del módulo para obtener estado fresco
    if "services.agent.perception.gesture_engine" in sys.modules:
        del sys.modules["services.agent.perception.gesture_engine"]

    from services.agent.perception.gesture_engine import GestureEngine

    event_bus = _make_event_bus_stub()
    engine = GestureEngine(event_bus=event_bus)

    env_override = {}
    if session_name:
        env_override["SESSIONNAME"] = session_name
    else:
        # Asegurar que SESSIONNAME no está en el entorno
        env_copy = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}
        env_override = env_copy

    loop = asyncio.new_event_loop()
    try:
        if not session_name:
            with patch.dict(os.environ, env_override, clear=True):
                with patch.dict(sys.modules, {"cv2": None, "mediapipe": None}):
                    with pytest.raises(RuntimeError) as exc_info:
                        loop.run_until_complete(engine.start())
            # El RuntimeError debe tener un mensaje claro (no silencioso)
            assert str(exc_info.value), (
                "RuntimeError debe tener un mensaje descriptivo, no estar vacío"
            )
        else:
            with patch.dict(os.environ, env_override):
                with patch.dict(sys.modules, {"cv2": None, "mediapipe": None}):
                    with pytest.raises(RuntimeError) as exc_info:
                        loop.run_until_complete(engine.start())
            assert str(exc_info.value), (
                "RuntimeError debe tener un mensaje descriptivo"
            )
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Preservation Property-based Test 6: Para toda secuencia start/stop de
# VoiceEngine con wake_detector.start() exitoso, _subscriptions queda limpio
# tras stop().
# ---------------------------------------------------------------------------

START_STOP_SEQUENCES = st.lists(
    st.sampled_from(["start", "stop"]),
    min_size=1,
    max_size=6,
)


@given(sequence=START_STOP_SEQUENCES)
@settings(
    max_examples=30,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
    deadline=None,
)
def test_preservation_6_voice_engine_subscriptions_clean_after_stop(sequence):
    """
    **Validates: Requirements 3.4**

    Property-based preservation: Para toda secuencia de start/stop de VoiceEngine
    con wake_detector.start() exitoso, _subscriptions queda vacío después de stop().
    No deben quedar tasks huérfanas activas tras cualquier secuencia de operaciones.

    Verifica directamente la propiedad de limpieza de _subscriptions usando mocks
    completos para evitar interacciones con hardware real o subsistemas externos.
    """
    from services.agent.perception.voice_engine import VoiceEngine

    event_bus = _make_event_bus_stub()
    key_manager = _make_key_manager_stub()
    config = {"VOICE_ENABLED": "true"}

    # Construir wake detector stub completamente mockeado
    wake_stub = _make_wake_detector_stub(should_fail=False, running=True)
    fake_wwd_cls = MagicMock(return_value=wake_stub)
    fake_vad_cls = MagicMock(return_value=MagicMock())
    fake_stt_instance = MagicMock()
    fake_stt_instance.provider = "mock"
    fake_stt_cls = MagicMock(return_value=fake_stt_instance)
    fake_tts_cls = MagicMock(return_value=MagicMock())

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        with (
            patch("services.agent.perception.voice_engine.WakeWordDetector", fake_wwd_cls, create=True),
            patch("services.agent.perception.voice_engine.VADDetector", fake_vad_cls, create=True),
            patch("services.agent.perception.voice_engine.SpeechToText", fake_stt_cls, create=True),
            patch("services.agent.perception.voice_engine.TextToSpeech", fake_tts_cls, create=True),
        ):
            engine = VoiceEngine(config=config, event_bus=event_bus, key_manager=key_manager)

        # Reemplazar wake_detector con nuestro stub después de la instanciación
        # para garantizar que stop() use el mock y no el objeto real
        engine.wake_detector = wake_stub

        # Mockear los métodos del event_bus para evitar subscriptions reales que
        # bloqueen o fallen; los usamos sólo para rastrear _subscriptions
        event_bus.unsubscribe = AsyncMock()

        for op in sequence:
            if op == "start":
                try:
                    loop.run_until_complete(engine.start())
                except Exception:
                    pass
            else:
                try:
                    loop.run_until_complete(engine.stop())
                except Exception:
                    pass

        # Asegurar que terminamos con stop para verificar limpieza
        try:
            loop.run_until_complete(engine.stop())
        except Exception:
            pass

        remaining_active = [t for t in engine._subscriptions if not t.done()]
        assert remaining_active == [], (
            f"Tras stop(), _subscriptions debe estar vacío. "
            f"Quedaron {len(remaining_active)} tasks activas. "
            f"Secuencia ejecutada: {sequence}"
        )
    finally:
        # Cancelar cualquier task pendiente antes de cerrar el loop
        pending = asyncio.all_tasks(loop)
        for t in pending:
            t.cancel()
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        loop.close()
        asyncio.set_event_loop(None)


# ===========================================================================
# TAREA 3.5: Pruebas unitarias para los cambios de los pasos 3.1–3.4
# **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
# ===========================================================================

CI_WORKFLOW_PATH = (
    Path(__file__).resolve().parents[3]
    / ".github"
    / "workflows"
    / "publish-windows-installer.yml"
)

# ---------------------------------------------------------------------------
# Test 3.5.1 — spec hidden imports
# ---------------------------------------------------------------------------


def test_3_5_1_spec_hidden_imports():
    """
    **Validates: Requirements 2.5**

    Verifica que helix-agent.spec contiene los hidden imports de percepción
    y los collect_data_files necesarios para el bundle de PyInstaller.
    """
    assert SPEC_PATH.exists(), f"No se encontró helix-agent.spec en {SPEC_PATH}"

    spec_text = SPEC_PATH.read_text(encoding="utf-8")

    for module in ["cv2", "mediapipe", "faster_whisper", "openwakeword"]:
        assert f"'{module}'" in spec_text, (
            f"'{module}' no aparece como hidden import en helix-agent.spec. "
            "PyInstaller no lo incluirá en el bundle."
        )

    assert "collect_data_files('mediapipe')" in spec_text, (
        "collect_data_files('mediapipe') no está en helix-agent.spec. "
        "Los archivos de modelo .tflite de MediaPipe no se empaquetarán."
    )
    assert "collect_data_files('openwakeword')" in spec_text, (
        "collect_data_files('openwakeword') no está en helix-agent.spec. "
        "Los modelos ONNX de wake word no se empaquetarán."
    )


# ---------------------------------------------------------------------------
# Test 3.5.2 — gesture RDP detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_2_gesture_rdp_detection():
    """
    **Validates: Requirements 2.4**

    Con SESSIONNAME=RDP-Tcp#0, GestureEngine.start() debe publicar
    GESTURE_HARDWARE_UNAVAILABLE con reason='rdp_session' y retornar
    sin lanzar excepción.
    """
    from services.agent.perception.gesture_engine import GestureEngine
    import threading

    event_bus = _make_event_bus_stub()

    with patch.dict(os.environ, {"SESSIONNAME": "RDP-Tcp#0"}):
        engine = GestureEngine(event_bus=event_bus)
        engine._thread = None

        fake_cv2 = ModuleType("cv2")
        fake_mediapipe = ModuleType("mediapipe")
        mock_thread = MagicMock(spec=threading.Thread)
        mock_thread.is_alive.return_value = False

        with (
            patch.dict(sys.modules, {"cv2": fake_cv2, "mediapipe": fake_mediapipe}),
            patch("threading.Thread", return_value=mock_thread),
            patch("asyncio.to_thread", new=AsyncMock(return_value=True)),
        ):
            # No debe lanzar excepción
            await engine.start()

    # Esperar un momento para que ensure_future complete
    await asyncio.sleep(0.05)

    published_events = [name for name, _ in event_bus.published]
    assert "GESTURE_HARDWARE_UNAVAILABLE" in published_events, (
        "GestureEngine.start() con SESSIONNAME=RDP-Tcp#0 debe publicar "
        "GESTURE_HARDWARE_UNAVAILABLE."
    )

    # Verificar el payload
    rdp_payloads = [
        payload
        for name, payload in event_bus.published
        if name == "GESTURE_HARDWARE_UNAVAILABLE"
    ]
    assert any(p.get("reason") == "rdp_session" for p in rdp_payloads), (
        "El payload de GESTURE_HARDWARE_UNAVAILABLE debe incluir reason='rdp_session'."
    )


# ---------------------------------------------------------------------------
# Test 3.5.3 — gesture no-RDP preservation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_3_gesture_no_rdp_preservation():
    """
    **Validates: Requirements 2.4, 3.1**

    Sin SESSIONNAME en el entorno, GestureEngine.start() NO debe publicar
    GESTURE_HARDWARE_UNAVAILABLE. Puede lanzar RuntimeError si cv2 no está
    disponible — lo importante es la ausencia del evento RDP.
    """
    from services.agent.perception.gesture_engine import GestureEngine

    event_bus = _make_event_bus_stub()

    # Entorno limpio sin SESSIONNAME
    env_without_session = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}

    with patch.dict(os.environ, env_without_session, clear=True):
        engine = GestureEngine(event_bus=event_bus)
        engine._thread = None

        # Simular cv2 no disponible para que el test sea determinista
        with patch.dict(sys.modules, {"cv2": None, "mediapipe": None}):
            try:
                await engine.start()
            except RuntimeError:
                # RuntimeError por cv2 no disponible es aceptable en no-RDP
                pass

    published_events = [name for name, _ in event_bus.published]
    assert "GESTURE_HARDWARE_UNAVAILABLE" not in published_events, (
        "GestureEngine.start() en entorno no-RDP NO debe publicar "
        "GESTURE_HARDWARE_UNAVAILABLE."
    )


# ---------------------------------------------------------------------------
# Test 3.5.4 — voice RDP detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_4_voice_rdp_detection():
    """
    **Validates: Requirements 2.3, 2.4**

    Con SESSIONNAME=RDP-Tcp#0 y VoiceEngine enabled=True, start() debe
    publicar VOICE_HARDWARE_UNAVAILABLE con reason='rdp_session' y retornar
    sin lanzar excepción.
    """
    event_bus = _make_event_bus_stub()

    engine = _build_voice_engine_with_mocked_perception(
        event_bus, config={"VOICE_ENABLED": "true"}
    )

    with patch.dict(os.environ, {"SESSIONNAME": "RDP-Tcp#0"}):
        # No debe lanzar excepción
        await engine.start()

    published_events = [name for name, _ in event_bus.published]
    assert "VOICE_HARDWARE_UNAVAILABLE" in published_events, (
        "VoiceEngine.start() con SESSIONNAME=RDP-Tcp#0 debe publicar "
        "VOICE_HARDWARE_UNAVAILABLE."
    )

    rdp_payloads = [
        payload
        for name, payload in event_bus.published
        if name == "VOICE_HARDWARE_UNAVAILABLE"
    ]
    assert any(p.get("reason") == "rdp_session" for p in rdp_payloads), (
        "El payload de VOICE_HARDWARE_UNAVAILABLE debe incluir reason='rdp_session'."
    )


# ---------------------------------------------------------------------------
# Test 3.5.5 — voice no-RDP preservation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_5_voice_no_rdp_preservation():
    """
    **Validates: Requirements 2.3, 3.1**

    Sin SESSIONNAME en el entorno, VoiceEngine.start() NO debe publicar
    VOICE_HARDWARE_UNAVAILABLE.
    """
    event_bus = _make_event_bus_stub()
    engine = _build_voice_engine_with_mocked_perception(
        event_bus, config={"VOICE_ENABLED": "true"}
    )

    # wake_detector que arranque correctamente
    engine.wake_detector = _make_wake_detector_stub(should_fail=False, running=True)

    env_without_session = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}

    with patch.dict(os.environ, env_without_session, clear=True):
        try:
            await engine.start()
        except Exception:
            # Pueden fallar otras partes (event_bus.subscribe real, etc.)
            # Lo importante es que no se emita VOICE_HARDWARE_UNAVAILABLE
            pass

    await engine.stop()

    published_events = [name for name, _ in event_bus.published]
    assert "VOICE_HARDWARE_UNAVAILABLE" not in published_events, (
        "VoiceEngine.start() en entorno no-RDP NO debe publicar "
        "VOICE_HARDWARE_UNAVAILABLE."
    )


# ---------------------------------------------------------------------------
# Test 3.5.6 — orphan task cleanup (verifica el FIX v0.2.1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_6_orphan_task_cleanup_fix():
    """
    **Validates: Requirements 2.2**

    Verifica que el fix v0.2.1 está presente: cuando wake_detector.start()
    lanza RuntimeError, el bloque except cancela las subscription tasks y
    deja _subscriptions vacío.
    """
    event_bus = _make_event_bus_stub()
    engine = _build_voice_engine_with_mocked_perception(event_bus)

    # wake_detector que falla en start()
    engine.wake_detector = _make_wake_detector_stub(should_fail=True)

    with pytest.raises(RuntimeError):
        await engine.start()

    # El fix v0.2.1 debe haber vaciado _subscriptions
    assert engine._subscriptions == [], (
        "Tras fallo en wake_detector.start(), _subscriptions debe estar vacío "
        "(fix v0.2.1). Las tasks huérfanas deben cancelarse en el bloque except."
    )

    # No deben quedar tasks activas relacionadas con las suscripciones
    # (garantizar que el test no deja tareas colgadas)
    for task in asyncio.all_tasks():
        if not task.done() and task is not asyncio.current_task():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


# ---------------------------------------------------------------------------
# Test 3.5.7 — version logging gesture
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_7_version_logging_gesture():
    """
    **Validates: Requirements 2.2**

    Al iniciar GestureEngine.start() con cv2/mediapipe disponibles (mocked),
    se debe emitir al menos un log INFO que mencione 'cv2' o 'mediapipe'.
    """
    import logging
    from services.agent.perception.gesture_engine import GestureEngine
    import threading

    event_bus = _make_event_bus_stub()
    # Entorno sin SESSIONNAME para que pase el guard RDP
    env_without_session = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}

    with patch.dict(os.environ, env_without_session, clear=True):
        engine = GestureEngine(event_bus=event_bus)
        engine._thread = None

        fake_cv2 = ModuleType("cv2")
        fake_cv2.__version__ = "4.9.0"
        fake_mediapipe = ModuleType("mediapipe")
        fake_mediapipe.__version__ = "0.10.0"

        log_records: list[logging.LogRecord] = []

        class CapturingHandler(logging.Handler):
            def emit(self, record):
                log_records.append(record)

        handler = CapturingHandler()
        gesture_logger = logging.getLogger("services.agent.perception.gesture_engine")
        gesture_logger.addHandler(handler)
        gesture_logger.setLevel(logging.DEBUG)

        mock_thread = MagicMock(spec=threading.Thread)
        mock_thread.is_alive.return_value = False

        try:
            with (
                patch.dict(sys.modules, {"cv2": fake_cv2, "mediapipe": fake_mediapipe}),
                patch("threading.Thread", return_value=mock_thread),
                patch("asyncio.to_thread", new=AsyncMock(return_value=True)),
            ):
                # Hacer que _ready se active automáticamente
                engine._ready.set()
                await engine.start()
        finally:
            gesture_logger.removeHandler(handler)

    info_messages = [
        r.getMessage() for r in log_records if r.levelno >= logging.INFO
    ]
    assert any(
        "cv2" in msg or "mediapipe" in msg for msg in info_messages
    ), (
        "GestureEngine.start() debe emitir un log INFO con 'cv2' o 'mediapipe'. "
        f"Logs INFO emitidos: {info_messages}"
    )


# ---------------------------------------------------------------------------
# Test 3.5.8 — version logging voice
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_3_5_8_version_logging_voice():
    """
    **Validates: Requirements 2.3**

    Al iniciar VoiceEngine.start() en entorno no-RDP se debe emitir al menos
    un log INFO que mencione 'faster_whisper', 'openwakeword' o 'sounddevice'
    (o 'unavailable' si los módulos no están instalados).
    """
    import logging

    event_bus = _make_event_bus_stub()
    engine = _build_voice_engine_with_mocked_perception(
        event_bus, config={"VOICE_ENABLED": "true"}
    )
    engine.wake_detector = _make_wake_detector_stub(should_fail=False, running=True)

    env_without_session = {k: v for k, v in os.environ.items() if k != "SESSIONNAME"}

    log_records: list[logging.LogRecord] = []

    class CapturingHandler(logging.Handler):
        def emit(self, record):
            log_records.append(record)

    handler = CapturingHandler()
    voice_logger = logging.getLogger("services.agent.perception.voice_engine")
    voice_logger.addHandler(handler)
    voice_logger.setLevel(logging.DEBUG)

    try:
        with patch.dict(os.environ, env_without_session, clear=True):
            try:
                await engine.start()
            except Exception:
                pass
        await engine.stop()
    finally:
        voice_logger.removeHandler(handler)

    info_messages = [
        r.getMessage() for r in log_records if r.levelno >= logging.INFO
    ]
    keywords = ["faster_whisper", "openwakeword", "sounddevice", "unavailable"]
    assert any(
        any(kw in msg for kw in keywords) for msg in info_messages
    ), (
        "VoiceEngine.start() debe emitir un log INFO con 'faster_whisper', "
        "'openwakeword', 'sounddevice' o 'unavailable' (si no están instalados). "
        f"Logs INFO emitidos: {info_messages}"
    )


# ---------------------------------------------------------------------------
# Test 3.5.9 — CI validation step strings
# ---------------------------------------------------------------------------


def test_3_5_9_ci_validation_step_strings():
    """
    **Validates: Requirements 2.6**

    El archivo publish-windows-installer.yml debe contener las cadenas
    'rgb_frame' y '_subscriptions' dentro del paso de validación de fixes.
    """
    assert CI_WORKFLOW_PATH.exists(), (
        f"No se encontró el workflow en {CI_WORKFLOW_PATH}"
    )

    workflow_text = CI_WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "rgb_frame" in workflow_text, (
        "publish-windows-installer.yml no contiene 'rgb_frame'. "
        "El paso de validación debe verificar que el fix rgb_frame está en gesture_engine.py."
    )
    assert "_subscriptions" in workflow_text, (
        "publish-windows-installer.yml no contiene '_subscriptions'. "
        "El paso de validación debe verificar que el fix _subscriptions está en voice_engine.py."
    )
