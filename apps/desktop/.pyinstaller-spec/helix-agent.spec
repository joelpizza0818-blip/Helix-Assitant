# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import copy_metadata
from PyInstaller.utils.hooks import collect_data_files

datas = [('C:/Users/TG computer/Documents/Helix Assitant/apps/desktop/.pyinstaller-work/agent-runtime-data/services/agent', 'services/agent')]
hiddenimports = ['win32process', 'win32gui', 'win32con', 'win32clipboard', 'pythoncom', 'win32com.client', 'pyautogui', 'mouseinfo', 'pygetwindow', 'pymsgbox', 'pyscreeze', 'pytweening', 'pyperclip', 'pyrect', 'cv2', 'mediapipe', 'mediapipe.tasks', 'mediapipe.tasks.python', 'mediapipe.tasks.python.vision', 'faster_whisper', 'openwakeword', 'sounddevice', 'soundfile', 'numpy', 'pyaudio']
datas += copy_metadata('edge-tts')
datas += copy_metadata('faster_whisper')
datas += copy_metadata('openwakeword')
datas += collect_data_files('mediapipe')
# Explicitly include the hand gesture model file
datas += [('services/agent/models/gesture/hand_landmarker.task', 'services/agent/models/gesture')]
# Explicitly include wake word voice models
datas += [('services/agent/models/wakeword/hey_helix.onnx', 'services/agent/models/wakeword')]
datas += [('services/agent/models/wakeword/hey_helix.onnx.data', 'services/agent/models/wakeword')]

datas += collect_data_files('openwakeword')
hiddenimports += collect_submodules('services.agent')
hiddenimports += collect_submodules('core')
hiddenimports += collect_submodules('ai')
hiddenimports += collect_submodules('browser')
hiddenimports += collect_submodules('memory')
hiddenimports += collect_submodules('mcp')
hiddenimports += collect_submodules('models')
hiddenimports += collect_submodules('perception')
hiddenimports += collect_submodules('plugins')
hiddenimports += collect_submodules('security')
hiddenimports += collect_submodules('skills')
hiddenimports += collect_submodules('tasks')
hiddenimports += collect_submodules('tools')
hiddenimports += collect_submodules('edge_tts')
hiddenimports += collect_submodules('faster_whisper')
hiddenimports += collect_submodules('openwakeword')


a = Analysis(
    ['C:/Users/TG computer/Documents/Helix Assitant/scripts/helix_agent_launcher.py'],
    pathex=['C:/Users/TG computer/Documents/Helix Assitant', 'C:/Users/TG computer/Documents/Helix Assitant/services/agent'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['services.agent.tests', 'services.agent.tests.conftest', 'services.agent.tests.test_agent_core', 'services.agent.tests.test_agent_manager', 'services.agent.tests.test_browser_page_tool', 'services.agent.tests.test_capability_loading', 'services.agent.tests.test_capability_registry', 'services.agent.tests.test_chat_pipeline', 'services.agent.tests.test_complex_workflows', 'services.agent.tests.test_computer_tool', 'services.agent.tests.test_confirmation_manager', 'services.agent.tests.test_desktop_bridge', 'services.agent.tests.test_event_bus', 'services.agent.tests.test_extraction', 'services.agent.tests.test_fallback_manager', 'services.agent.tests.test_gesture_events', 'services.agent.tests.test_indexed_file_search_tool', 'services.agent.tests.test_key_manager', 'services.agent.tests.test_mcp', 'services.agent.tests.test_memory', 'services.agent.tests.test_model_router', 'services.agent.tests.test_mouse_control', 'services.agent.tests.test_permission_manager', 'services.agent.tests.test_plugin_manager', 'services.agent.tests.test_provider_registry', 'services.agent.tests.test_runtime_context', 'services.agent.tests.test_screen_observation', 'services.agent.tests.test_screen_vision_sampling', 'services.agent.tests.test_secret_manager', 'services.agent.tests.test_shell_tool', 'services.agent.tests.test_skills', 'services.agent.tests.test_task_execution_summary', 'services.agent.tests.test_task_manager', 'services.agent.tests.test_tools', 'services.agent.tests.test_voice_conversation', 'services.agent.tests.test_wake_word', 'services.agent.tests.test_websocket_auth'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='helix-agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='helix-agent',
)