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
            <input
              type="checkbox"
              checked={settings.start_minimized ?? true}
              onChange={(e) => onSave({ start_minimized: e.target.checked })}
            />
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
            <input type="checkbox" checked={settings.always_on_top ?? true} onChange={(e) => onSave({ always_on_top: e.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Global Summon Shortcut</label>
          <input className="form-input" value={settings.global_summon_shortcut || 'Alt+Space'} onChange={(e) => void onSave({ global_summon_shortcut: e.target.value })} placeholder="Alt+Space" />
        </div>

        <div className="form-row">
          <label className="form-label">Emergency Stop Shortcut</label>
          <input className="form-input" value={settings.emergency_stop_shortcut || 'Control+Shift+Escape'} onChange={(e) => void onSave({ emergency_stop_shortcut: e.target.value })} placeholder="Control+Shift+Escape" />
        </div>
      </div>
    </div>
  )
}
