with open('services/agent/tests/test_voice_conversation.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''        whisper_module.load_model = load_model
        monkeypatch.setitem(sys.modules, "whisper", whisper_module)'''

replacement = '''        whisper_module.load_model = load_model
        monkeypatch.setitem(sys.modules, "whisper", whisper_module)
        monkeypatch.setattr(speech_to_text.SpeechToText, "check_ffmpeg", lambda: True)'''

content = content.replace(target, replacement)

with open('services/agent/tests/test_voice_conversation.py', 'w', encoding='utf-8') as f:
    f.write(content)
