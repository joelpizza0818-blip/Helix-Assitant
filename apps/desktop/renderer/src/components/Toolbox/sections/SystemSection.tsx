import React, { useEffect, useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import {
  deleteCustomSound,
  getCustomSoundMetadata,
  saveCustomSound,
  type CustomSoundKind,
  type CustomSoundMetadata,
} from '../../../lib/customSoundStore'
import {
  ERROR_SOUND_PRESETS,
  playConfiguredSound,
  SUCCESS_SOUND_PRESETS,
} from '../../../lib/soundEffects'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
  onSaveSound: (partial: Partial<HelixSettings>) => Promise<boolean>
}

export default function SystemSection({ settings, onSave, onSaveSound }: Props) {
  const [newPathInput, setNewPathInput] = useState('')
  const [customSounds, setCustomSounds] = useState<Record<CustomSoundKind, CustomSoundMetadata | null>>({
    success: null,
    error: null,
  })
  const [soundMessage, setSoundMessage] = useState<string | null>(null)
  const protectedPaths = settings.protected_paths || ['C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files']

  useEffect(() => {
    let active = true
    void Promise.all([
      getCustomSoundMetadata('success'),
      getCustomSoundMetadata('error'),
    ]).then(([success, error]) => {
      if (active) setCustomSounds({ success, error })
    }).catch((error: unknown) => {
      console.error('[SystemSection] Could not load custom sound details:', error)
      if (active) setSoundMessage('Could not load saved sound details.')
    })
    return () => { active = false }
  }, [])

  const handleUploadSound = async (kind: CustomSoundKind, file: File) => {
    setSoundMessage(null)
    try {
      await saveCustomSound(kind, file)
      await onSaveSound(kind === 'success'
        ? { success_sound_preset: 'custom' }
        : { error_sound_preset: 'custom' })
      setCustomSounds((current) => ({ ...current, [kind]: { name: file.name, size: file.size, type: file.type } }))
      setSoundMessage(`${kind === 'success' ? 'Success' : 'Error'} sound saved.`)
    } catch (error) {
      console.error(`[SystemSection] Could not save custom ${kind} sound:`, error)
      setSoundMessage(error instanceof Error ? error.message : 'Could not save the selected sound.')
    }
  }

  const handleRemoveSound = async (kind: CustomSoundKind) => {
    setSoundMessage(null)
    try {
      await onSaveSound(kind === 'success'
        ? { success_sound_preset: 'helix_chime' }
        : { error_sound_preset: 'low_buzz' })
      await deleteCustomSound(kind)
      setCustomSounds((current) => ({ ...current, [kind]: null }))
      setSoundMessage(`${kind === 'success' ? 'Success' : 'Error'} sound removed.`)
    } catch (error) {
      console.error(`[SystemSection] Could not remove custom ${kind} sound:`, error)
      setSoundMessage(error instanceof Error ? error.message : 'Could not remove the saved sound.')
    }
  }

  const handlePreviewSound = (kind: CustomSoundKind) => {
    const preset = kind === 'success'
      ? settings.success_sound_preset ?? 'helix_chime'
      : settings.error_sound_preset ?? 'low_buzz'
    setSoundMessage(null)
    void playConfiguredSound(kind, preset).catch((error: unknown) => {
      console.error(`[SystemSection] Could not preview ${kind} sound:`, error)
      setSoundMessage(error instanceof Error ? error.message : 'Could not play the selected sound.')
    })
  }

  const handleSelectSound = async (kind: CustomSoundKind, preset: string) => {
    setSoundMessage(null)
    try {
      const saved = await onSaveSound(kind === 'success'
        ? { success_sound_preset: preset }
        : { error_sound_preset: preset })
      if (!saved) setSoundMessage('Could not save the selected sound.')
    } catch (error) {
      console.error(`[SystemSection] Could not select ${kind} sound:`, error)
      setSoundMessage(error instanceof Error ? error.message : 'Could not save the selected sound.')
    }
  }

  const renderSoundControl = (
    kind: CustomSoundKind,
    label: string,
    presets: readonly { id: string; label: string }[],
    selectedPreset: string,
  ) => (
    <div className="form-row" style={{ alignItems: 'flex-start' }}>
      <label className="form-label" htmlFor={`system-${kind}-sound`}>{label}</label>
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 8, maxWidth: 420 }}>
        <select
          id={`system-${kind}-sound`}
          className="form-input"
          value={selectedPreset}
          onChange={(event) => void handleSelectSound(kind, event.target.value)}
        >
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          {(customSounds[kind] || selectedPreset === 'custom') && (
            <option value="custom">
              {customSounds[kind]?.name ?? 'Custom sound (upload again)'}
            </option>
          )}
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="validate-btn"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => handlePreviewSound(kind)}
          >
            Test
          </button>
          <label className="validate-btn" style={{ fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}>
            Upload sound
            <input
              type="file"
              accept="audio/*,video/mp4,.mp4"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleUploadSound(kind, file)
              }}
            />
          </label>
          {customSounds[kind] && (
            <button
              type="button"
              className="validate-btn"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => void handleRemoveSound(kind)}
            >
              Remove custom
            </button>
          )}
          {customSounds[kind] && (
            <span className="text-xs text-muted">
              {(customSounds[kind].size / (1024 * 1024)).toFixed(1)} MB
            </span>
          )}
        </div>
      </div>
    </div>
  )

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
          Play a sound for successful or failed actions. Built-in tones run locally; custom clips are stored on this device only.
        </p>

        <div className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <span className="text-sm weight-medium text-bone">Enable UI Sound Effects</span>
            <p className="text-xs text-muted">Custom files up to 5 MB; MP4 files must contain an audio track with a supported codec.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.sound_effects_enabled ?? true}
              onChange={(event) => void onSave({ sound_effects_enabled: event.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>
        {renderSoundControl('success', 'Successful action', SUCCESS_SOUND_PRESETS, settings.success_sound_preset ?? 'helix_chime')}
        {renderSoundControl('error', 'Failed action', ERROR_SOUND_PRESETS, settings.error_sound_preset ?? 'low_buzz')}
        <p className="text-xs text-muted" style={{ margin: '0 0 8px' }}>
          Audio and video files with audio: MP3, WAV, OGG, M4A, AAC, MP4, WebM, or FLAC.
        </p>
        {soundMessage && <p className="text-xs text-muted" role="status">{soundMessage}</p>}
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
