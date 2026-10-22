import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

const PERMISSION_LEVELS = [
  { level: 'READ_ONLY', desc: 'Read files, inspect UI hierarchy, inspect windows', defaultReq: 'Auto-granted' },
  { level: 'LOW_RISK', desc: 'Move cursor, standard keyboard typing, take screenshots', defaultReq: 'Auto-granted' },
  { level: 'MODIFY', desc: 'Write files, create directories, adjust window sizes', defaultReq: 'Confirmation Recommended' },
  { level: 'EXECUTE', desc: 'Execute CMD/PowerShell scripts, browser navigation, launch apps', defaultReq: 'Confirmation Required' },
  { level: 'SYSTEM', desc: 'Modify system variables, Windows startup registry entries', defaultReq: 'Confirmation Required' },
  { level: 'CRITICAL', desc: 'Delete files/directories, kill processes, format/destructive commands', defaultReq: 'Mandatory Explicit Confirmation' }
]

export default function SecuritySection({ settings, onSave }: Props) {
  const [newPath, setNewPath] = useState('')
  const [newApp, setNewApp] = useState('')

  const handleAddPath = () => {
    if (!newPath.trim()) return
    const updated = [...(settings.protected_paths || []), newPath.trim()]
    onSave({ protected_paths: updated })
    setNewPath('')
  }

  const handleRemovePath = (index: number) => {
    const updated = (settings.protected_paths || []).filter((_, i) => i !== index)
    onSave({ protected_paths: updated })
  }

  const handleAddApp = () => {
    if (!newApp.trim()) return
    const updated = [...(settings.protected_apps || []), newApp.trim()]
    onSave({ protected_apps: updated })
    setNewApp('')
  }

  const handleRemoveApp = (index: number) => {
    const updated = (settings.protected_apps || []).filter((_, i) => i !== index)
    onSave({ protected_apps: updated })
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Security & Permission Policies</h2>
      <p className="toolbox-section__desc">
        HELIX enforces strict privilege separation. The AI model never receives unfettered system access; all actions traverse the policy engine and permission manager.
      </p>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Confirmation Policy</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Choose how HELIX evaluates tool risk. Protected paths, protected processes, and destructive operations remain gated in every mode.
        </p>
        <label className="form-label" htmlFor="permissions-mode">
          Approval mode
        </label>
        <select
          id="permissions-mode"
          className="form-input"
          value={settings.permissions_mode || 'SMART_APPROVAL'}
          onChange={(event) => onSave({
            permissions_mode: event.target.value as HelixSettings['permissions_mode']
          })}
        >
          <option value="ALWAYS_ASK">Always Ask — confirm every tool action</option>
          <option value="AUTO_APPROVE">Auto Approve — gate system and critical actions</option>
          <option value="SMART_APPROVAL">Smart Approval — gate modifications and risky context</option>
        </select>
        <div style={{ height: 10 }} />
        <label className="form-label" htmlFor="auto-approve-up-to">
          Allow without confirmation up to
        </label>
        <select
          id="auto-approve-up-to"
          className="form-input"
          value={settings.auto_approve_up_to}
          onChange={(event) => onSave({
            auto_approve_up_to: event.target.value as HelixSettings['auto_approve_up_to']
          })}
        >
          <option value="READ_ONLY">Read only</option>
          <option value="LOW_RISK">Low risk</option>
          <option value="MODIFY">Modify</option>
        </select>
      </div>

      {/* ── Command Sandboxing & Isolation ───────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Command Sandboxing & Isolation</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Execute system commands in an isolated sandbox with sanitized environment variables, stripped sensitive credentials/tokens, clean system PATH, and restricted execution privileges.
        </p>

        <div className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <label className="form-label" style={{ marginBottom: 2 }}>Enable Command Sandboxing</label>
            <p className="text-xs text-muted">Isolate shell, cmd, and terminal executions from the host system environment</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.sandbox_enabled ?? false}
              onChange={(e) => void onSave({ sandbox_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="sandbox-mode">
            Sandbox Isolation Mode
          </label>
          <select
            id="sandbox-mode"
            className="form-input"
            value={settings.sandbox_mode || 'restricted'}
            disabled={!settings.sandbox_enabled}
            onChange={(e) => void onSave({
              sandbox_mode: e.target.value as HelixSettings['sandbox_mode']
            })}
          >
            <option value="restricted">Restricted Environment — Process isolation & sanitized environment (Default)</option>
            <option value="isolated">Isolated Subprocess — Clean system PATH & cleared environment variables</option>
            <option value="windows_sandbox">Windows Sandbox — Disposable lightweight Hyper-V container</option>
            <option value="docker">Docker Container — Isolated containerized environment</option>
          </select>
        </div>
      </div>

      {/* ── Permission Hierarchy ──────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Permission Tiers</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PERMISSION_LEVELS.map((p) => (
            <div
              key={p.level}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: 'var(--canvas)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid var(--border)'
              }}
            >
              <div>
                <span className="text-mono text-sm weight-medium text-bone">{p.level}</span>
                <p className="text-xs text-muted">{p.desc}</p>
              </div>
              <span className="text-xs text-orange text-mono">{p.defaultReq}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Protected Paths ──────────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Protected System Paths</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          HELIX filesystem tools will automatically refuse write or deletion operations on these paths without explicit critical overrides.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. C:\Windows, C:\Program Files"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button className="validate-btn" onClick={handleAddPath}>Add Path</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['C:\\Windows', 'C:\\Windows\\System32', ...(settings.protected_paths || [])].map((path, idx) => (
            <span key={idx} className="cap-badge" style={{ padding: '4px 8px', fontSize: 11 }}>
              {path}
              {idx >= 2 && (
                <button
                  onClick={() => handleRemovePath(idx - 2)}
                  style={{ marginLeft: 6, color: 'var(--red)', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ── Protected Applications ───────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Protected Processes</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Processes that cannot be terminated or killed by HELIX process tools.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. explorer.exe, antivirus.exe"
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
          />
          <button className="validate-btn" onClick={handleAddApp}>Add Process</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['explorer.exe', 'lsass.exe', 'winlogon.exe', 'csrss.exe', ...(settings.protected_apps || [])].map((app, idx) => (
            <span key={idx} className="cap-badge" style={{ padding: '4px 8px', fontSize: 11 }}>
              {app}
              {idx >= 4 && (
                <button
                  onClick={() => handleRemoveApp(idx - 4)}
                  style={{ marginLeft: 6, color: 'var(--red)', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
