import React from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function StartupSection({ settings, onSave }: Props) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Windows Startup & Desktop Integration</h2>
      <p className="toolbox-section__desc">
        Configure whether HELIX starts automatically with Windows, system tray residence, floating window pinning, and global summoning shortcuts.
      </p>

      {/* ── Windows System Startup ─────────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">System Boot & Auto-Launch</span>
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Launch HELIX on Windows Startup</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Adds registry auto-run key to HKCU\Software\Microsoft\Windows\CurrentVersion\Run</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.start_with_windows}
              onChange={(e) => onSave({ start_with_windows: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Start Minimized to System Tray</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Silently initializes background services without showing the floating UI on login</p>
          </div>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>

      {/* ── Window Behaviors & Global Hotkeys ──────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Window Pinning & Global Hotkeys</span>
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Floating UI Always on Top</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Keeps assistant overlay visible above full-screen windows and code editors</p>
          </div>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Global Summon Shortcut</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="cap-badge" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>Alt</span>
            <span className="text-muted">+</span>
            <span className="cap-badge" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>Space</span>
          </div>
        </div>

        <div className="form-row">
          <label className="form-label">Emergency Stop Shortcut</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="cap-badge" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>Ctrl</span>
            <span className="text-muted">+</span>
            <span className="cap-badge" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>Shift</span>
            <span className="text-muted">+</span>
            <span className="cap-badge" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>Escape</span>
          </div>
        </div>
      </div>
    </div>
  )
}
