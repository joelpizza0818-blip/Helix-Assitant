import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import { getUserFacingError } from '../../../lib/userError'
import '../Toolbox.css'
import './VoiceSection.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

const WAKE_WORD_PRESETS = [
  { label: 'Helix (Predeterminado)', value: 'helix' },
  { label: 'Jarvis', value: 'jarvis' },
  { label: 'Nova', value: 'nova' },
  { label: 'Computer', value: 'computer' },
  { label: 'Hey Assistant', value: 'hey assistant' },
  { label: 'Personalizado...', value: 'custom' },
]

interface CatalogVoice {
  id: string
  name: string
  language: string
  langLabel: string
  gender: 'Femenina' | 'Masculina'
  provider: 'windows_sapi' | 'edge_tts'
  description: string
  sampleText: string
  isLocal: boolean
}

const VOICE_CATALOG: CatalogVoice[] = [
  {
    id: 'Microsoft Sabina Desktop - Spanish (Mexico)',
    name: 'Sabina (Windows SAPI)',
    language: 'es-MX',
    langLabel: 'Español (México)',
    gender: 'Femenina',
    provider: 'windows_sapi',
    description: 'Voz local Windows · 100% Offline, síntesis instantánea ultra-rápida (0ms latencia de red).',
    sampleText: 'Hola, soy Sabina. Tu voz local de Windows para Helix sin conexión a internet.',
    isLocal: true,
  },
  {
    id: 'Microsoft David Desktop - English (United States)',
    name: 'David (Windows SAPI)',
    language: 'en-US',
    langLabel: 'English (US)',
    gender: 'Masculina',
    provider: 'windows_sapi',
    description: 'Voz local Windows · 100% Offline, articulación clara, técnica y formal.',
    sampleText: 'Hello, I am David. Local offline speech synthesis for Helix.',
    isLocal: true,
  },
  {
    id: 'Microsoft Zira Desktop - English (United States)',
    name: 'Zira (Windows SAPI)',
    language: 'en-US',
    langLabel: 'English (US)',
    gender: 'Femenina',
    provider: 'windows_sapi',
    description: 'Voz local Windows · 100% Offline, dicción nítida y equilibrada.',
    sampleText: 'Hello, I am Zira. Ready for voice interaction at zero cost.',
    isLocal: true,
  },
  {
    id: 'es-MX-DaliaNeural',
    name: 'Dalia Neural',
    language: 'es-MX',
    langLabel: 'Español (México)',
    gender: 'Femenina',
    provider: 'edge_tts',
    description: 'Voz neuronal Microsoft Edge · Entonación sumamente natural, suave y expresiva ($0 gratis).',
    sampleText: 'Hola, soy Dalia. Puedo responder a tus preguntas en Helix con entonación natural.',
    isLocal: false,
  },
  {
    id: 'es-ES-AlvaroNeural',
    name: 'Álvaro Neural',
    language: 'es-ES',
    langLabel: 'Español (España)',
    gender: 'Masculina',
    provider: 'edge_tts',
    description: 'Voz neuronal Microsoft Edge · Tono profesional, seguro y dinámico ($0 gratis).',
    sampleText: 'Hola, soy Álvaro. Estoy listo para asistirte en tiempo real con tus tareas.',
    isLocal: false,
  },
  {
    id: 'en-US-AndrewMultilingualNeural',
    name: 'Andrew Multilingual',
    language: 'multilingual',
    langLabel: 'Multilingüe (Global)',
    gender: 'Masculina',
    provider: 'edge_tts',
    description: 'Voz neuronal avanzada · Gran fidelidad y fluidez en inglés y español ($0 gratis).',
    sampleText: 'Hello! I am Andrew. I can speak both Spanish and English fluently.',
    isLocal: false,
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria Neural',
    language: 'en-US',
    langLabel: 'English (US)',
    gender: 'Femenina',
    provider: 'edge_tts',
    description: 'Voz neuronal Microsoft Edge · Ágil, clara y muy expresiva ($0 gratis).',
    sampleText: 'Hi, I am Aria. Helix voice assistant is ready to converse with you.',
    isLocal: false,
  },
]

export default function VoiceSection({ settings, onSave }: Props) {
  const currentWake = (settings.wake_word || 'helix').toLowerCase()
  const isPreset = WAKE_WORD_PRESETS.some((p) => p.value === currentWake)
  const [selectedPreset, setSelectedPreset] = useState(isPreset ? currentWake : 'custom')
  const [customWordInput, setCustomWordInput] = useState(settings.wake_word || 'helix')
  const [newAliasInput, setNewAliasInput] = useState('')
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null)
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'offline' | 'neural'>('all')
  const [testAudioResult, setTestAudioResult] = useState<string | null>(null)

  const activeProvider = settings.voice_tts_provider || 'edge_tts'
  const activeVoiceId = settings.voice_tts_voice || 'en-US-AndrewMultilingualNeural'

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

  const handlePreviewVoice = async (voice: CatalogVoice) => {
    setPreviewingVoiceId(voice.id)
    setTestAudioResult(null)
    try {
      await window.helix.testTts({
        text: voice.sampleText,
        provider: voice.provider,
        voice_id: voice.id,
      })
      setTestAudioResult(`Muestra reproducida con éxito mediante ${voice.name}.`)
    } catch (error) {
      setTestAudioResult(
        getUserFacingError(
          error,
          'No se pudo reproducir la muestra de audio. Comprueba el dispositivo de salida.',
        )
      )
    } finally {
      setPreviewingVoiceId(null)
    }
  }

  const handleSelectVoice = async (voice: CatalogVoice) => {
    await onSave({
      voice_tts_provider: voice.provider,
      voice_tts_voice: voice.id,
    })
  }

  const filteredVoices = VOICE_CATALOG.filter((voice) => {
    if (catalogFilter === 'offline') return voice.isLocal
    if (catalogFilter === 'neural') return !voice.isLocal
    return true
  })

  const isVoiceActive = (voice: CatalogVoice): boolean => {
    if (activeProvider === voice.provider && activeVoiceId === voice.id) return true
    if (activeProvider === 'windows_sapi' && voice.provider === 'windows_sapi') {
      if (activeVoiceId.toLowerCase().includes(voice.name.toLowerCase().split(' ')[0])) {
        return true
      }
    }
    return false
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Voz, Personalidad y Live Audio</h2>
      <p className="toolbox-section__desc">
        Configura la interacción por voz de Helix: activa la escucha por palabra clave o pulsa para hablar, y selecciona la voz que mejor se adapte a tu estilo conversacional (100% gratuito, coste $0).
      </p>

      {/* ── Catálogo de Voces para Live y Normal Audio ──────────── */}
      <div className="toolbox-card voice-catalog-card">
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Catálogo de Voces Helix</span>
            <p className="toolbox-card__hint">
              Elige la voz utilizada en Live Voice y respuestas habladas. Las voces locales de Windows funcionan offline sin conexión; las voces neuronales ofrecen máxima naturalidad ($0).
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="voice-catalog-filters">
          <button
            type="button"
            className={`voice-catalog-filter-btn ${catalogFilter === 'all' ? 'voice-catalog-filter-btn--active' : ''}`}
            onClick={() => setCatalogFilter('all')}
          >
            Todas ({VOICE_CATALOG.length})
          </button>
          <button
            type="button"
            className={`voice-catalog-filter-btn ${catalogFilter === 'offline' ? 'voice-catalog-filter-btn--active' : ''}`}
            onClick={() => setCatalogFilter('offline')}
          >
            Locales Offline (0ms lag)
          </button>
          <button
            type="button"
            className={`voice-catalog-filter-btn ${catalogFilter === 'neural' ? 'voice-catalog-filter-btn--active' : ''}`}
            onClick={() => setCatalogFilter('neural')}
          >
            Neuronales Expresivas ($0)
          </button>
        </div>

        {testAudioResult && (
          <p className="text-xs text-muted" role="status" style={{ marginBottom: 12 }}>
            {testAudioResult}
          </p>
        )}

        {/* Voice Grid */}
        <div className="voice-catalog-grid">
          {filteredVoices.map((voice) => {
            const active = isVoiceActive(voice)
            const isPreviewing = previewingVoiceId === voice.id

            return (
              <div
                key={voice.id}
                className={`voice-card ${active ? 'voice-card--active' : ''}`}
              >
                <div className="voice-card__header">
                  <div className="voice-card__identity">
                    <div className="voice-card__avatar">
                      {voice.gender === 'Femenina' ? '♀' : '♂'}
                    </div>
                    <div className="voice-card__meta">
                      <span className="voice-card__name">{voice.name}</span>
                      <span className="voice-card__lang">{voice.langLabel}</span>
                    </div>
                  </div>
                  <span
                    className={`voice-card__badge ${voice.isLocal ? 'voice-card__badge--offline' : 'voice-card__badge--neural'}`}
                  >
                    {voice.isLocal ? 'Offline 0ms' : 'Neural $0'}
                  </span>
                </div>

                <p className="voice-card__desc">{voice.description}</p>

                <div className="voice-card__actions">
                  <button
                    type="button"
                    className="voice-card__preview-btn"
                    onClick={() => void handlePreviewVoice(voice)}
                    disabled={isPreviewing}
                    title="Escuchar una muestra de esta voz"
                  >
                    {isPreviewing ? (
                      'Reproduciendo...'
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        <span>Probar</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className={`voice-card__select-btn ${active ? 'voice-card__select-btn--active' : ''}`}
                    onClick={() => void handleSelectVoice(voice)}
                    disabled={active}
                  >
                    {active ? '✓ Activa' : 'Seleccionar'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Cadencia y Ajustes de Live Voice ────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Conversación continua (Live Audio)</span>
            <p className="toolbox-card__hint">
              El micrófono permanece activo durante la llamada. Helix espera el tiempo elegido y permite un segundo adicional para retomar la frase antes de responder.
            </p>
          </div>
        </div>

        <div className="voice-live-tuning">
          <button
            type="button"
            className={`voice-tuning-option ${(settings.voice_live_silence_ms ?? 1000) <= 450 ? 'voice-tuning-option--active' : ''}`}
            onClick={() => onSave({ voice_live_silence_ms: 400 })}
          >
            <span className="voice-tuning-title">Respuesta ágil · 400 ms</span>
            <span className="voice-tuning-desc">
              Menos espera; puede detectar antes el final entre frases.
            </span>
          </button>

          <button
            type="button"
            className={`voice-tuning-option ${(settings.voice_live_silence_ms ?? 1000) > 450 && (settings.voice_live_silence_ms ?? 1000) <= 800 ? 'voice-tuning-option--active' : ''}`}
            onClick={() => onSave({ voice_live_silence_ms: 650 })}
          >
            <span className="voice-tuning-title">Natural · 650 ms</span>
            <span className="voice-tuning-desc">
              Equilibrio recomendado para hablar y hacer pausas breves al pensar.
            </span>
          </button>

          <button
            type="button"
            className={`voice-tuning-option ${(settings.voice_live_silence_ms ?? 1000) > 800 ? 'voice-tuning-option--active' : ''}`}
            onClick={() => onSave({ voice_live_silence_ms: 1000 })}
          >
            <span className="voice-tuning-title">Recomendado · 1000 ms + 1 s para retomar</span>
            <span className="voice-tuning-desc">
              Helix espera hasta 2 segundos sin voz; si continúas antes, une todo en el mismo turno.
            </span>
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <label className="form-label" htmlFor="vad-threshold">Sensibilidad de Micrófono (RMS)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <input
              id="vad-threshold"
              className="form-input"
              type="range"
              min={50}
              max={1000}
              step={25}
              value={settings.vad_threshold ?? 250}
              onChange={(e) => {
                const threshold = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(threshold)) onSave({ vad_threshold: threshold })
              }}
            />
            <span className="text-xs" style={{ minWidth: 50 }}>
              {settings.vad_threshold ?? 250} RMS
            </span>
          </div>
        </div>
      </div>

      {/* ── Activación por Palabra Clave (Wake Word) ───────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Activación por Palabra Clave</span>
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
          <label className="form-label">Palabras Clave Predefinidas</label>
          <select
            className="form-input"
            value={selectedPreset}
            onChange={(e) => void handlePresetSelect(e.target.value)}
          >
            {WAKE_WORD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Palabra Clave Activa</label>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              className="form-input"
              type="text"
              value={customWordInput}
              onChange={(e) => setCustomWordInput(e.target.value)}
              placeholder="Ej. Helix, Jarvis, Nova..."
            />
            <button
              type="button"
              className="validate-btn"
              onClick={handleCustomWordSave}
            >
              Guardar
            </button>
          </div>
        </div>

        {/* Alternate Wake Aliases */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-hairline)' }}>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 8 }}>
            Alias adicionales de activación:
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <span className="cap-badge" style={{ background: 'rgba(238, 96, 24, 0.2)', color: 'var(--orange)', border: '1px solid var(--orange)' }}>
              Principal: {settings.wake_word || 'helix'}
            </span>
            {settings.custom_wake_words?.map((alias) => (
              <span key={alias} className="cap-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {alias}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}
                  onClick={() => handleRemoveAlias(alias)}
                >
                  x
                </button>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="Añadir alias (ej. 'Oye Helix', 'Robot')..."
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
              + Añadir
            </button>
          </div>
        </div>
      </div>

      {/* ── Motor de Reconocimiento de Voz (STT) ───────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Reconocimiento de voz de Live Audio</span>
            <p className="toolbox-card__hint">
              Live usa Faster-Whisper local y multilingüe. El perfil se aplica al iniciar la siguiente llamada.
            </p>
          </div>
        </div>

        <div className="form-row">
          <label className="form-label">Proveedor de Normal Audio</label>
          <select
            className="form-input"
            value={settings.voice_stt_provider || 'local_whisper'}
            onChange={(e) => onSave({ voice_stt_provider: e.target.value })}
          >
            <option value="local_whisper">Faster-Whisper Local (Offline $0 · Privado)</option>
            <option value="openai_whisper">OpenAI Whisper Cloud API</option>
          </select>
        </div>

        <div className="voice-live-tuning">
          <button
            type="button"
            className={`voice-tuning-option ${(settings.voice_stt_mode ?? 'accuracy') === 'speed' ? 'voice-tuning-option--active' : ''}`}
            onClick={() => onSave({ voice_stt_mode: 'speed' })}
          >
            <span className="voice-tuning-title">Velocidad · Whisper tiny</span>
            <span className="voice-tuning-desc">
              Reconoce más rápido con un posible costo de precisión, especialmente en frases largas.
            </span>
          </button>
          <button
            type="button"
            className={`voice-tuning-option ${(settings.voice_stt_mode ?? 'accuracy') === 'accuracy' ? 'voice-tuning-option--active' : ''}`}
            onClick={() => onSave({ voice_stt_mode: 'accuracy' })}
          >
            <span className="voice-tuning-title">Precisión · Whisper base</span>
            <span className="voice-tuning-desc">
              Recomendado para mayor calidad de reconocimiento; puede tardar más en CPU.
            </span>
          </button>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: 10 }}>
          En Live, ambos modelos son gratuitos y se ejecutan localmente después de descargarse. El idioma se detecta automáticamente; el proveedor de arriba solo afecta Normal Audio.
        </p>
      </div>
    </div>
  )
}
