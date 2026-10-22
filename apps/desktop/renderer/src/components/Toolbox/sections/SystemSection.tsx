import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import { playSuccessChime } from '../../../lib/soundEffects'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function SystemSection({ settings, onSave }: Props) {
  const [newPathInput, setNewPathInput] = useState('')
  const protectedPaths = settings.protected_paths || ['C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files']

  const handleAddPath = async () => {
    if (!newPathInput.trim()) return
    const updated = [...new Set([...protectedPaths, newPathInput.trim()])]
    await onSave({ protected_paths: updated })
    setNewPathInput('')
  }

  const handleRemovePath = async (path: string) => {
    const updated = protectedPaths.filter((p) => p !== path)
    await onSave({ protected_paths: updated })
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">System & Shell Security</h2>
      <p className="toolbox-section__desc">
        Configure filesystem boundaries, shell execution policies, PowerShell execution flags, and blocked OS directories.
      </p>

      {/* ── Shell Execution Policy ─────────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Terminal & CLI Execution</span>
        </div>

        <div className="form-row">
          <label className="form-label">Default Shell Environment</label>
          <select className="form-input" value={settings.shell_type || 'powershell'} onChange={(e) => void onSave({ shell_type: e.target.value as HelixSettings['shell_type'] })}>
            <option value="powershell">PowerShell 7 / Windows PowerShell (pwsh.exe / powershell.exe)</option>
            <option value="cmd">Command Prompt (cmd.exe)</option>
            <option value="wsl">WSL 2 (Ubuntu / Linux Bash)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Execution Timeout (seconds)</label>
          <input className="form-input" type="number" min={5} max={300} value={settings.shell_timeout_seconds ?? 60} onChange={(e) => void onSave({ shell_timeout_seconds: Number(e.target.value) })} />
        </div>

        <div className="form-row">
          <label className="form-label">Block Elevated Admin Execution without Confirmation</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.block_elevated_execution ?? true} onChange={(e) => void onSave({ block_elevated_execution: e.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Start HELIX with Windows</span>
            <p className="text-xs text-muted">Controls the installed HELIX startup entry. Disable it here to stop automatic launch.</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={settings.start_with_windows} onChange={(event) => void onSave({ start_with_windows: event.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Start minimized to tray</span>
            <p className="text-xs text-muted">HELIX still starts in the background and remains available from the tray.</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={settings.start_minimized ?? true} onChange={(event) => void onSave({ start_minimized: event.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>

      {/* ── Command Sandboxing & Isolation ──────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Command Sandboxing & Isolation</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Execute shell commands in an isolated environment with sanitized variables, stripped credentials, clean PATH, and restricted privileges.
        </p>

        <div className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <label className="form-label" style={{ marginBottom: 2 }}>Enable Command Sandboxing</label>
            <p className="text-xs text-muted">Isolate shell, cmd, and terminal executions from the host environment</p>
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
          <label className="form-label" htmlFor="system-sandbox-mode">
            Sandbox Isolation Mode
          </label>
          <select
            id="system-sandbox-mode"
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

      {/* ── Audio Feedback & Sound Effects ──────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Audio Feedback & Sound Effects</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Play subtle audio feedback when tasks complete successfully, errors occur, or commands finish in terminal.
        </p>

        <div className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="text-sm weight-medium text-bone">Enable UI Sound Effects</span>
            <p className="text-xs text-muted">Acoustic chimes synthesized locally with zero asset overhead</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="validate-btn"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => playSuccessChime()}
            >
              Test Chime
            </button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.sound_effects_enabled ?? true}
                onChange={(e) => void onSave({ sound_effects_enabled: e.target.checked })}
              />
              <span className="toggle__slider" />
            </label>
          </div>
        </div>
      </div>

      {/* ── Protected Directory Boundaries ─────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Protected System Paths</span>
          <span className="text-xs text-muted">Agent cannot modify or delete files inside these folders</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {protectedPaths.map((p) => (
            <div
              key={p}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 12px',
                background: 'var(--canvas)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--border)'
              }}
            >
              <span className="text-xs text-mono text-bone">{p}</span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }}
                onClick={() => handleRemovePath(p)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            type="text"
            placeholder="Add protected path (e.g. D:\SecureData)..."
            value={newPathInput}
            onChange={(e) => setNewPathInput(e.target.value)}
          />
          <button
            type="button"
            className="validate-btn"
            onClick={handleAddPath}
            disabled={!newPathInput.trim()}
          >
            + Add Path
          </button>
        </div>
      </div>
    </div>
  )
}
