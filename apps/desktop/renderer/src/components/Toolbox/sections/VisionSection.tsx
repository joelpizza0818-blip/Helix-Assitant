import React, { useState } from 'react'
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
  { id: 'GESTURE_CONFIRM', name: 'Thumbs Up', defaultAction: 'CONFIRM', icon: '👍', desc: 'Closed fist with thumb extended upward' },
  { id: 'GESTURE_REJECT', name: 'Thumbs Down', defaultAction: 'REJECT', icon: '👎', desc: 'Closed fist with thumb extended downward' },
  { id: 'GESTURE_SEARCH', name: 'OK / Pinch', defaultAction: 'SEARCH', icon: '👌', desc: 'Thumb and index fingertips touching in a ring' },
  { id: 'GESTURE_STOP', name: 'Open Palm', defaultAction: 'STOP', icon: '✋', desc: 'Flat open palm facing camera' },
  { id: 'GESTURE_CLOSE', name: 'Closed Fist', defaultAction: 'CLOSE', icon: '✊', desc: 'Fingers curled tightly into a fist' },
  { id: 'GESTURE_OPEN', name: 'Index Pointing Up', defaultAction: 'OPEN', icon: '☝', desc: 'Single index finger extended straight up' }
]

export default function VisionSection({ settings, onSave }: Props) {
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
          <label className="form-label">Detection Sensitivity ({(settings.gesture_sensitivity * 100).toFixed(0)}%)</label>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.05"
            value={settings.gesture_sensitivity}
            onChange={(e) => onSave({ gesture_sensitivity: parseFloat(e.target.value) })}
            style={{ accentColor: 'var(--orange)', flex: 1 }}
          />
        </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{g.icon}</span>
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
