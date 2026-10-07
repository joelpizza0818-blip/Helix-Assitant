with open('apps/desktop/renderer/src/components/Toolbox/Toolbox.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('const { settings, isLoading, isSaving, loadSettings, saveSettings } = useSettings()', 'const { settings, isLoading, isSaving, isApplied, loadSettings, saveSettings } = useSettings()')

content = content.replace('{isSaving && <span className="toolbox__saving">Saving changes...</span>}', '{isSaving && <span className="toolbox__saving">Saving changes...</span>}{!isSaving && isApplied && <span className="toolbox__saving" style={{ color: "var(--green)", border: "1px solid var(--green)", padding: "2px 6px", borderRadius: "4px" }}>Saved</span>}')

with open('apps/desktop/renderer/src/components/Toolbox/Toolbox.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
