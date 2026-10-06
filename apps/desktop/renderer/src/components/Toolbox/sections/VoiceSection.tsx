import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

const WAKE_WORD_PRESETS = [
  { label: 'Helix (Default)', value: 'helix' },
  { label: 'Jarvis', value: 'jarvis' },
  { label: 'Nova', value: 'nova' },
  { label: 'Computer', value: 'computer' },
  { label: 'Hey Assistant', value: 'hey assistant' },
  { label: 'Custom...', value: 'custom' }
]

export default function VoiceSection({ settings, onSave }: Props) {
  const currentWake = (settings.wake_word || 'helix').toLowerCase()
  const isPreset = WAKE_WORD_PRESETS.some((p) => p.value === currentWake)
  const [selectedPreset, setSelectedPreset] = useState(isPreset ? currentWake : 'custom')
  const [customWordInput, setCustomWordInput] = useState(settings.wake_word || 'helix')
  const [newAliasInput, setNewAliasInput] = useState('')
  const [isPlayingTestAudio, setIsPlayingTestAudio] = useState(false)

  const handlePresetSelect = async (preset: string) => {
    setSelectedPreset(preset)
    if (preset !== 'custom') {
      setCustomWordInput(preset)
      await onSave({ wake_word: preset })
    }
  }

  const handleCustomWordSave = async () => {
    if (!customWordInput.trim()) return
    await onSave({ wake_word: customWordInput.trim().toLowerCase() })
  }

  const handleAddAlias = async () => {
    if (!newAliasInput.trim()) return
    const currentAliases = settings.custom_wake_words || []
    const updated = [...new Set([...currentAliases, newAliasInput.trim().toLowerCase()])]
    await onSave({ custom_wake_words: updated })
    setNewAliasInput('')
  }

  const handleRemoveAlias = async (alias: string) => {
    const currentAliases = settings.custom_wake_words || []
    await onSave({ custom_wake_words: currentAliases.filter((a) => a !== alias) })
  }

  const handleTestVoiceAudio = () => {
    setIsPlayingTestAudio(true)
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(`HELIX activation phrase is set to ${settings.wake_word || 'Helix'}. Audio system online.`)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.onend = () => setIsPlayingTestAudio(false)
      window.speechSynthesis.speak(utterance)
    } else {
      setTimeout(() => setIsPlayingTestAudio(false), 1500)
    }
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Voice Activation & Persona</h2>
      <p className="toolbox-section__desc">
        Configure custom activation phrases, wake words, speech-to-text models, and TTS voice persona. Change the default trigger ("Helix") to any custom call name.
      </p>

      {/* ── Activation & Wake Word Configuration ──────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Wake Phrase & Trigger Name</span>
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
          <label className="form-label">Primary Activation Preset</label>
          <select
            className="form-input"
            value={selectedPreset}
            onChange={(e) => handlePresetSelect(e.target.value)}
          >
            {WAKE_WORD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Active Wake Word / Keyword</label>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              className="form-input"
              type="text"
              value={customWordInput}
              onChange={(e) => setCustomWordInput(e.target.value)}
              placeholder="Enter custom activation word (e.g. Jarvis, Nova, Matrix)..."
            />
            <button
              type="button"
              className="validate-btn"
              onClick={handleCustomWordSave}
            >
              Save Phrase
            </button>
          </div>
        </div>

        {/* Alternate Wake Aliases */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-hairline)' }}>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 8 }}>
            Alternate Trigger Keywords (Listens for any of these words):
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <span className="cap-badge" style={{ background: 'rgba(238, 96, 24, 0.2)', color: 'var(--orange)', border: '1px solid var(--orange)' }}>
              Primary: {settings.wake_word || 'helix'}
            </span>
            {settings.custom_wake_words?.map((alias) => (
              <span key={alias} className="cap-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {alias}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}
                  onClick={() => handleRemoveAlias(alias)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="Add alternate trigger word (e.g. 'Oye', 'Hey Helix', 'Robot')..."
              value={newAliasInput}
              onChange={(e) => setNewAliasInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAlias() }}
            />
            <button
              type="button"
              className="validate-btn"
              onClick={handleAddAlias}
              disabled={!newAliasInput.trim()}
            >
              + Add Alias
            </button>
          </div>
        </div>
      </div>

      {/* ── Speech Recognition & Synthesis ─────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Speech Processing Pipeline</span>
          <button
            type="button"
            className="validate-btn"
            onClick={handleTestVoiceAudio}
            disabled={isPlayingTestAudio}
          >
            {isPlayingTestAudio ? 'Playing...' : '▶ Test Audio Output'}
          </button>
        </div>

        <div className="form-row">
          <label className="form-label">Speech-To-Text Provider</label>
          <select
            className="form-input"
            value={settings.voice_stt_provider || 'openai_whisper'}
            onChange={(e) => onSave({ voice_stt_provider: e.target.value })}
          >
            <option value="openai_whisper">OpenAI Whisper Cloud API (High Accuracy)</option>
            <option value="local_whisper">Local Whisper (Offline CPU/GPU)</option>
            <option value="windows_sapi">Windows SAPI Speech Engine (Zero Latency)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Text-To-Speech Voice Persona</label>
          <select
            className="form-input"
            value={settings.voice_tts_provider || 'openai_tts'}
            onChange={(e) => onSave({ voice_tts_provider: e.target.value })}
          >
            <option value="openai_tts">OpenAI TTS (Neural Voice - Alloy / Onyx)</option>
            <option value="elevenlabs">ElevenLabs (Ultra-Realistic Streaming)</option>
            <option value="windows_sapi">Windows Native SAPI Voice (Microsoft David / Zira)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">VAD Silence Threshold (ms)</label>
          <input
            className="form-input"
            type="number"
            min={300}
            max={3000}
            step={100}
            defaultValue={800}
          />
        </div>
      </div>
    </div>
  )
}
