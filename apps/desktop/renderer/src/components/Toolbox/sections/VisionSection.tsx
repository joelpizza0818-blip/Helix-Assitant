import React from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

const GESTURES = [
  { emoji: '👍', name: 'CONFIRM', event: 'GESTURE_CONFIRM', desc: 'Confirms an action when HELIX is waiting for confirmation' },
  { emoji: '👎', name: 'REJECT', event: 'GESTURE_REJECT', desc: 'Rejects or cancels a pending confirmation request' },
  { emoji: '👌', name: 'SEARCH', event: 'GESTURE_SEARCH', desc: 'Instructs HELIX to perform autonomous web research on active topic' },
  { emoji: '✋', name: 'STOP', event: 'GESTURE_STOP', desc: 'Immediately halts ongoing task or background automation' },
  { emoji: '✊', name: 'CLOSE', event: 'GESTURE_CLOSE', desc: 'Dismisses or closes active model interaction window' },
  { emoji: '☝', name: 'OPEN', event: 'GESTURE_OPEN', desc: 'Summons HELIX floating assistant to the foreground' }
]

export default function VisionSection({ settings, onSave }: Props) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Vision & Gesture Controls</h2>
      <p className="toolbox-section__desc">
        Configure camera capture and optical gesture recognition. Frames are evaluated locally with MediaPipe and are never streamed to any LLM.
      </p>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Camera & Optical Perception</span>
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
          <label className="form-label">Gesture Sensitivity ({settings.gesture_sensitivity})</label>
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

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Registered Hand Gestures</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Gestures only emit internal events. For security, affirmative gestures like 👍 only trigger execution when HELIX is explicitly awaiting user confirmation.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GESTURES.map((g) => (
            <div
              key={g.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                background: 'var(--canvas)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid var(--border)'
              }}
            >
              <span style={{ fontSize: 20 }}>{g.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="text-sm weight-medium text-bone">{g.name}</span>
                  <span className="cap-badge">{g.event}</span>
                </div>
                <span className="text-xs text-muted">{g.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
