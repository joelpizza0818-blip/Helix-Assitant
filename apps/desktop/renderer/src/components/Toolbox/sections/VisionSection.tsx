import React, { useEffect, useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

interface GestureActionDef {
  id: string
  label: string
  description: string
  category: 'system' | 'ai' | 'automation'
}

const AVAILABLE_ACTIONS: GestureActionDef[] = [
  { id: 'CONFIRM', label: 'Confirm Pending Action', description: 'Affirmative handshake for critical/destructive actions', category: 'system' },
  { id: 'REJECT', label: 'Reject / Cancel Action', description: 'Dismisses current confirmation prompt', category: 'system' },
  { id: 'SEARCH', label: 'Autonomous Web Research', description: 'Extracts topic from active window and researches live', category: 'ai' },
  { id: 'STOP', label: 'Emergency Task Halt', description: 'Instantly aborts all active background jobs and agent loops', category: 'system' },
  { id: 'CLOSE', label: 'Hide Assistant UI', description: 'Minimizes floating overlay to system tray', category: 'system' },
  { id: 'OPEN', label: 'Summon / Focus HELIX', description: 'Brings floating assistant to foreground', category: 'system' },
  { id: 'SCREENSHOT_ANALYZE', label: 'Capture Screen & Analyze', description: 'Takes screenshot and sends to active vision model', category: 'ai' },
  { id: 'TOGGLE_VOICE', label: 'Toggle Microphone Listening', description: 'Enables or mutes local audio capture', category: 'system' },
  { id: 'CUSTOM_COMMAND', label: 'Execute Custom Shell Command', description: 'Runs a preconfigured CLI command or script', category: 'automation' }
]

const CORE_GESTURES = [
  {
    id: 'GESTURE_CONFIRM',
    name: 'Thumbs Up',
    defaultAction: 'CONFIRM',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3" />
        <path d="M9 10a5 5 0 0 1 5-5v0a2 2 0 0 1 2 2v3" />
      </svg>
    ),
    desc: 'Closed fist with thumb extended upward'
  },
  {
    id: 'GESTURE_REJECT',
    name: 'Thumbs Down',
    defaultAction: 'REJECT',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3" />
        <path d="M15 14a5 5 0 0 1-5 5v0a2 2 0 0 1-2-2v-3" />
      </svg>
    ),
    desc: 'Closed fist with thumb extended downward'
  },
  {
    id: 'GESTURE_SEARCH',
    name: 'OK / Pinch',
    defaultAction: 'SEARCH',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="4" />
        <path d="M13 9h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4" />
        <path d="M17 13v6" />
        <path d="M13 13v6" />
      </svg>
    ),
    desc: 'Thumb and index fingertips touching in a circle'
  },
  {
    id: 'GESTURE_STOP',
    name: 'Open Palm',
    defaultAction: 'STOP',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4" />
        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
        <path d="M6 14v-2a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6a7 7 0 0 0 7 7h4a7 7 0 0 0 7-7v-7a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3" />
      </svg>
    ),
    desc: 'Flat open palm facing camera'
  },
  {
    id: 'GESTURE_CLOSE',
    name: 'Closed Fist',
    defaultAction: 'CLOSE',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="14" height="16" rx="4" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="13" x2="15" y2="13" />
      </svg>
    ),
    desc: 'Fingers curled tightly into a fist'
  },
  {
    id: 'GESTURE_OPEN',
    name: 'Index Pointing Up',
    defaultAction: 'OPEN',
    renderIcon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v10" />
        <path d="M12 12a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-3a3 3 0 0 1 3-3h4" />
        <path d="M8 12V9a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2" />
      </svg>
    ),
    desc: 'Single index finger extended straight up'
  }
]

export default function VisionSection({ settings, onSave }: Props) {
  const [sensitivityDraft, setSensitivityDraft] = useState(settings.gesture_sensitivity)
  const [activeMappings, setActiveMappings] = useState<Record<string, { action: string; customCommand?: string }>>(
    settings.gesture_mappings || {
      GESTURE_CONFIRM: { action: 'CONFIRM' },
      GESTURE_REJECT: { action: 'REJECT' },
      GESTURE_SEARCH: { action: 'SEARCH' },
      GESTURE_STOP: { action: 'STOP' },
      GESTURE_CLOSE: { action: 'CLOSE' },
      GESTURE_OPEN: { action: 'OPEN' }
    }
  )

  const [testGestureState, setTestGestureState] = useState<string | null>(null)

  useEffect(() => {
    setSensitivityDraft(settings.gesture_sensitivity)
  }, [settings.gesture_sensitivity])

  const saveSensitivity = () => {
    if (sensitivityDraft !== settings.gesture_sensitivity) {
      void onSave({ gesture_sensitivity: sensitivityDraft })
    }
  }

  const handleActionChange = async (gestureId: string, actionId: string) => {
    const updated = {
      ...activeMappings,
      [gestureId]: {
        ...activeMappings[gestureId],
        action: actionId
      }
    }
    setActiveMappings(updated)
    await onSave({ gesture_mappings: updated as any })
  }

  const handleCustomCommandChange = async (gestureId: string, cmd: string) => {
    const updated = {
      ...activeMappings,
      [gestureId]: {
        ...activeMappings[gestureId],
        customCommand: cmd
      }
    }
    setActiveMappings(updated)
    await onSave({ gesture_mappings: updated as any })
  }

  const handleSimulateGesture = (name: string) => {
    setTestGestureState(name)
    setTimeout(() => setTestGestureState(null), 2500)
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Vision & Gesture Controls</h2>
      <p className="toolbox-section__desc">
        Configure camera capture and optical gesture recognition. Frames are evaluated locally with MediaPipe and are never streamed to any external LLM. Remap gestures to custom agent actions or commands.
      </p>

      {/* ── Camera Hardware Controls ─────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Local Optical Perception</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.camera_enabled}
              onChange={(e) => onSave({ camera_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Camera Device Index</label>
          <input
            className="form-input"
            type="number"
            min={0}
            max={5}
            value={settings.camera_device_index}
            onChange={(e) => onSave({ camera_device_index: parseInt(e.target.value, 10) || 0 })}
          />
        </div>

        <div className="form-row">
          <label className="form-label">
            Detection Sensitivity ({(sensitivityDraft * 100).toFixed(0)}%; higher = easier detection)
          </label>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.05"
            value={sensitivityDraft}
            onChange={(e) => setSensitivityDraft(parseFloat(e.target.value))}
            onPointerUp={saveSensitivity}
            onKeyUp={saveSensitivity}
            style={{ accentColor: 'var(--orange)', flex: 1 }}
          />
        </div>
        <p className="text-xs text-muted" style={{ margin: '0 0 8px' }}>
          Changes are saved when you finish adjusting and applied to the active camera.
        </p>
      </div>

      {/* ── Gesture Action Mapping Engine ─────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Gesture Action Mappings</span>
          {testGestureState && (
            <span className="status-badge status-badge--healthy animate-pulse">
              Recognized: {testGestureState}
            </span>
          )}
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 14 }}>
          Map recognized hand gestures to native OS actions, LLM tasks, or custom terminal scripts.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CORE_GESTURES.map((g) => {
            const currentMapping = activeMappings[g.id] || { action: g.defaultAction }
            const isCustomCmd = currentMapping.action === 'CUSTOM_COMMAND'

            return (
              <div
                key={g.id}
                style={{
                  background: 'var(--canvas)',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border)',
                  padding: 14
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-card)',
                      background: 'rgba(238, 96, 24, 0.08)',
                      border: '1px solid rgba(238, 96, 24, 0.2)'
                    }}>
                      {g.renderIcon()}
                    </div>
                    <div>
                      <span className="text-sm weight-medium text-bone">{g.name}</span>
                      <span className="text-xs text-mono text-muted" style={{ marginLeft: 8 }}>({g.id})</span>
                      <p className="text-xs text-secondary" style={{ margin: '2px 0 0' }}>{g.desc}</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      className="form-input"
                      style={{ width: 220, fontSize: 13, padding: '6px 12px' }}
                      value={currentMapping.action}
                      onChange={(e) => handleActionChange(g.id, e.target.value)}
                    >
                      {AVAILABLE_ACTIONS.map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="validate-btn"
                      style={{ fontSize: 11, padding: '6px 10px' }}
                      onClick={() => handleSimulateGesture(g.name)}
                      title="Test this gesture"
                    >
                      Test
                    </button>
                  </div>
                </div>

                {isCustomCmd && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--color-hairline)' }}>
                    <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                      CLI / PowerShell Command to Run:
                    </label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="e.g. powershell -Command Start-Process notepad.exe"
                      value={currentMapping.customCommand || ''}
                      onChange={(e) => handleCustomCommandChange(g.id, e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
