import React, { useState, useEffect } from 'react'
import type { HelixSettings } from '../../types/global'
import {
  checkOllamaRunning,
  getInstalledOllamaModels,
  pullOllamaModel,
} from '../../services/ollamaService'
import './ModelSelectorDropdown.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<unknown>
}

interface ModelItem {
  id: string
  name: string
  description: string
  provider: 'free' | 'ollama' | 'anthropic' | 'openai' | 'google'
  tier: 'free' | 'local' | 'cloud'
  badge?: string
}

const FREE_MODELS: ModelItem[] = [
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B',
    description: 'Ultra rápido para órdenes directas y comandos OS',
    provider: 'free',
    tier: 'free',
    badge: 'Gratis 0-Cost',
  },
  {
    id: 'qwen/qwen-2.5-coder-7b-instruct:free',
    name: 'Qwen 2.5 Coder',
    description: 'Especialista en scripts, terminal y código',
    provider: 'free',
    tier: 'free',
    badge: 'Gratis 0-Cost',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1',
    description: 'Razonamiento profundo paso a paso',
    provider: 'free',
    tier: 'free',
    badge: 'Gratis 0-Cost',
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash',
    description: 'Multimodal ágil sin costo de API',
    provider: 'free',
    tier: 'free',
    badge: 'Gratis 0-Cost',
  },
]

const LOCAL_OLLAMA_MODELS: ModelItem[] = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B Local',
    description: 'CPU / GPU integrada (~2.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder Local',
    description: 'Programación rápida local (~1.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek R1 Local',
    description: 'Razonamiento local compacto (~1.1 GB)',
    provider: 'ollama',
    tier: 'local',
  },
]

const PRO_CLOUD_MODELS: ModelItem[] = [
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    description: 'Trabajo complejo y razonamiento superior',
    provider: 'anthropic',
    tier: 'cloud',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Versátil y multimodal de OpenAI',
    provider: 'openai',
    tier: 'cloud',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Google AI Studio (Gratuito con tu API key)',
    provider: 'google',
    tier: 'cloud',
  },
]

export default function ModelSelectorDropdown({ settings, onSave }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [ollamaRunning, setOllamaRunning] = useState(false)
  const [installedOllamaModels, setInstalledOllamaModels] = useState<string[]>([])
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadStatus, setDownloadStatus] = useState<string>('')

  // Determine current active model
  const activeModelId = settings.default_model || 'meta-llama/llama-3.2-3b-instruct:free'
  const activeEffort = settings.speed_preference === 'high' ? 'Bajo' : settings.quality_preference === 'high' ? 'Alto' : 'Medio'

  // Find active model details
  const allModels = [...FREE_MODELS, ...LOCAL_OLLAMA_MODELS, ...PRO_CLOUD_MODELS]
  const currentModel = allModels.find((m) => m.id === activeModelId) || {
    id: activeModelId,
    name: activeModelId.split('/').pop()?.split(':')[0] || 'Modelo Activo',
    tier: (settings.preferred_provider === 'ollama' ? 'local' : settings.preferred_provider === 'free' ? 'free' : 'cloud') as 'free' | 'local' | 'cloud',
  }

  // Refresh Ollama status on open
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    void checkOllamaRunning().then((running) => {
      if (!mounted) return
      setOllamaRunning(running)
      if (running) {
        void getInstalledOllamaModels().then((models) => {
          if (mounted) setInstalledOllamaModels(models)
        })
      }
    })
    return () => {
      mounted = false
    }
  }, [isOpen])

  const handleSelectModel = async (model: ModelItem) => {
    await onSave({
      default_model: model.id,
      preferred_provider: model.provider,
    })
    setIsOpen(false)
  }

  const handleDownloadOllama = async (modelId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setDownloadingModel(modelId)
    setDownloadProgress(0)
    setDownloadStatus('Iniciando descarga…')

    const success = await pullOllamaModel(modelId, (status, pct) => {
      setDownloadStatus(status)
      setDownloadProgress(pct)
    })

    if (success) {
      setInstalledOllamaModels((prev) => [...prev, modelId.toLowerCase()])
      await onSave({
        default_model: modelId,
        preferred_provider: 'ollama',
      })
    }
    setDownloadingModel(null)
  }

  const handleSetEffort = async (effort: 'Bajo' | 'Medio' | 'Alto') => {
    if (effort === 'Bajo') {
      await onSave({ speed_preference: 'high', quality_preference: 'low' })
    } else if (effort === 'Alto') {
      await onSave({ speed_preference: 'low', quality_preference: 'high' })
    } else {
      await onSave({ speed_preference: 'balanced', quality_preference: 'balanced' })
    }
  }

  return (
    <div className="model-selector-container">
      {/* ── Pill Button in Bottom Bar (Matching user screenshots) ── */}
      <button
        type="button"
        className={`model-selector-btn ${isOpen ? 'model-selector-btn--active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Cambiar modelo de IA"
        aria-label="Selector de modelo"
      >
        {currentModel.tier === 'free' && <FreeIcon />}
        {currentModel.tier === 'local' && <LocalIcon />}
        {currentModel.tier === 'cloud' && <CloudIcon />}
        <span className="model-selector-btn__label">{currentModel.name}</span>
        <span className="model-selector-btn__effort">{activeEffort}</span>
        <span className="model-selector-btn__chevron">▲</span>
      </button>

      {/* ── Dropdown Modal ── */}
      {isOpen && (
        <>
          <div className="model-dropdown-backdrop" onClick={() => setIsOpen(false)} />
          <div className="model-dropdown-menu" role="dialog" aria-label="Modelos disponibles">
            {/* 1. Modelos Gratuitos (0 Cost) */}
            <div className="model-dropdown__section-title">
              <FreeIcon />
              <span>Modelos Gratuitos (0 Cost · Sin Key)</span>
            </div>
            {FREE_MODELS.map((m) => {
              const isSelected = activeModelId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                  onClick={() => void handleSelectModel(m)}
                >
                  <div className="model-dropdown__item-info">
                    <div className="model-dropdown__item-header">
                      <span className="model-dropdown__item-name">{m.name}</span>
                      <span className="model-dropdown__badge model-dropdown__badge--free">Gratis</span>
                    </div>
                    <span className="model-dropdown__item-desc">{m.description}</span>
                  </div>
                  {isSelected && <span className="model-dropdown__check">✓</span>}
                </button>
              )
            })}

            <div className="model-dropdown__divider" />

            {/* 2. Modelos Locales en PC (Ollama) */}
            <div className="model-dropdown__section-title">
              <LocalIcon />
              <span>Modelos Locales (Tu PC · Privado)</span>
            </div>
            {!ollamaRunning ? (
              <div style={{ padding: '8px 10px', fontSize: 11, color: '#8e8e93', lineHeight: 1.4 }}>
                Ollama no detectado en tu PC.{' '}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#64b4f6', textDecoration: 'none', fontWeight: 600 }}
                  onClick={(e) => {
                    e.preventDefault()
                    window.helix?.openExternal('https://ollama.com/download')
                  }}
                >
                  Descargar Ollama gratis
                </a>{' '}
                para ejecutar IA 100% offline sin servidores.
              </div>
            ) : (
              LOCAL_OLLAMA_MODELS.map((m) => {
                const isSelected = activeModelId === m.id
                const isInstalled = installedOllamaModels.some((name) =>
                  name.includes(m.id.toLowerCase().split(':')[0])
                )
                const isDownloading = downloadingModel === m.id

                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                    onClick={() => {
                      if (isInstalled) void handleSelectModel(m)
                    }}
                  >
                    <div className="model-dropdown__item-info">
                      <div className="model-dropdown__item-header">
                        <span className="model-dropdown__item-name">{m.name}</span>
                        <span className="model-dropdown__badge model-dropdown__badge--local">Local</span>
                      </div>
                      <span className="model-dropdown__item-desc">{m.description}</span>
                      {isDownloading && (
                        <div className="model-dropdown__progress-bar">
                          <div
                            className="model-dropdown__progress-fill"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {isDownloading ? (
                      <span style={{ fontSize: 11, color: '#64b4f6' }}>{downloadProgress}%</span>
                    ) : isInstalled ? (
                      isSelected ? (
                        <span className="model-dropdown__check">✓</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#8e8e93' }}>Listo</span>
                      )
                    ) : (
                      <button
                        type="button"
                        className="model-dropdown__download-btn"
                        onClick={(e) => void handleDownloadOllama(m.id, e)}
                      >
                        1-Click
                      </button>
                    )}
                  </button>
                )
              })
            )}

            <div className="model-dropdown__divider" />

            {/* 3. Modelos Nube Pro (BYOK) */}
            <div className="model-dropdown__section-title">
              <CloudIcon />
              <span>Modelos Nube Pro (Tu API Key)</span>
            </div>
            {PRO_CLOUD_MODELS.map((m) => {
              const isSelected = activeModelId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                  onClick={() => void handleSelectModel(m)}
                >
                  <div className="model-dropdown__item-info">
                    <div className="model-dropdown__item-header">
                      <span className="model-dropdown__item-name">{m.name}</span>
                      <span className="model-dropdown__badge">BYOK</span>
                    </div>
                    <span className="model-dropdown__item-desc">{m.description}</span>
                  </div>
                  {isSelected && <span className="model-dropdown__check">✓</span>}
                </button>
              )
            })}

            <div className="model-dropdown__divider" />

            {/* 4. Selector de Esfuerzo */}
            <div className="model-dropdown__effort-row">
              <span>Esfuerzo de Razonamiento</span>
              <div className="model-dropdown__effort-pills">
                {(['Bajo', 'Medio', 'Alto'] as const).map((effort) => (
                  <button
                    key={effort}
                    type="button"
                    className={`model-dropdown__effort-pill ${activeEffort === effort ? 'model-dropdown__effort-pill--active' : ''}`}
                    onClick={() => void handleSetEffort(effort)}
                  >
                    {effort}
                  </button>
                ))}
              </div>
            </div>

            <div className="model-dropdown__footer">
              HELIX es 0-cost: usa modelos gratuitos o locales sin pagar suscripciones.
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────────────────

function FreeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#77d89a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function LocalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64b4f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function CloudIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff914d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  )
}
