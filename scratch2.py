with open('apps/desktop/renderer/src/components/Toolbox/sections/VoiceSection.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''          <input
            className="form-input"
            type="number"
            min={300}
            max={3000}
            step={100}
            defaultValue={800}
          />'''

replacement = '''          <input
            className="form-input"
            type="number"
            min={300}
            max={3000}
            step={100}
            value={settings.vad_threshold || 800}
            onChange={(e) => onSave({ vad_threshold: parseInt(e.target.value, 10) || 800 })}
          />'''

content = content.replace(target, replacement)

with open('apps/desktop/renderer/src/components/Toolbox/sections/VoiceSection.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
