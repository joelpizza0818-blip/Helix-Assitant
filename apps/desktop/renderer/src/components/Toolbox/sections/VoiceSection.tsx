import React from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function VoiceSection({ settings, onSave }: Props) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Voice Configuration</h2>
      <p className="toolbox-section__desc">
        Configure voice recognition, wake phrase, and speech synthesis. Voice processing operates independently and can be toggled without disabling text interaction.
      </p>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Voice Activation</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.voice_enabled}
              onChange={(e) => onSave({ voice_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Wake Word / Phrase</label>
          <input
            className="form-input"
            type="text"
            value={settings.wake_word}
            onChange={(e) => onSave({ wake_word: e.target.value })}
            placeholder="Default: Helix"
          />
        </div>

        <div className="form-row">
          <label className="form-label">Wake Engine</label>
          <select
            className="form-input"
            value={settings.wake_word_provider}
            onChange={(e) => onSave({ wake_word_provider: e.target.value as 'openwakeword' | 'porcupine' })}
          >
            <option value="openwakeword">OpenWakeWord (Local, Open-Source)</option>
            <option value="porcupine">Picovoice Porcupine (API Key Required)</option>
          </select>
        </div>
      </div>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Speech Processing Pipeline</span>
        </div>

        <div className="form-row">
          <label className="form-label">Microphone Status</label>
          <span className="status-badge status-badge--healthy">Default Device Active</span>
        </div>

        <div className="form-row">
          <label className="form-label">Speech-To-Text</label>
          <span className="text-sm text-secondary">
            OpenAI Whisper API (if configured) with local fallback
          </span>
        </div>

        <div className="form-row">
          <label className="form-label">Text-To-Speech</label>
          <span className="text-sm text-secondary">
            OpenAI TTS / Windows SAPI local system voices
          </span>
        </div>
      </div>
    </div>
  )
}
