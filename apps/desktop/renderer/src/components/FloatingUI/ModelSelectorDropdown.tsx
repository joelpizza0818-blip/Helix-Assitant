import React, { useState, useEffect, useRef } from 'react'
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
    description: 'Ultra rápido para órdenes directas y control OS',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'qwen/qwen-2.5-coder-7b-instruct:free',
    name: 'Qwen 2.5 Coder',
    description: 'Especialista en scripts, terminal y código',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1',
    description: 'Razonamiento profundo paso a paso',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash',
    description: 'Multimodal ágil y veloz sin costo de API',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
]

const LOCAL_OLLAMA_MODELS: ModelItem[] = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B Local',
    description: 'Meta AI · 100% privado en CPU/GPU (~2.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder Local',
    description: 'Alibaba Qwen · Código y shell local (~1.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek R1 Local',
    description: 'DeepSeek · Razonamiento local (~1.1 GB)',
    provider: 'ollama',
    tier: 'local',
  },
]

const PRO_CLOUD_MODELS: ModelItem[] = [
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic · Razonamiento y visión superior',
    provider: 'anthropic',
    tier: 'cloud',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI · Multimodal rápido',
    provider: 'openai',
    tier: 'cloud',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Google AI Studio · Con tu API key',
    provider: 'google',
    tier: 'cloud',
  },
]

export default function ModelSelectorDropdown({ settings, onSave }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [installedOllamaModels, setInstalledOllamaModels] = useState<string[]>([])
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadStatus, setDownloadStatus] = useState<string>('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Active model resolution
  const activeModelId = settings.default_model || 'meta-llama/llama-3.2-3b-instruct:free'
  const activeEffort = settings.speed_preference === 'high' ? 'Bajo' : settings.quality_preference === 'high' ? 'Alto' : 'Medio'

  const allModels = [...FREE_MODELS, ...LOCAL_OLLAMA_MODELS, ...PRO_CLOUD_MODELS]
  const currentModel = allModels.find((m) => m.id === activeModelId) || {
    id: activeModelId,
    name: activeModelId.split('/').pop()?.split(':')[0] || 'Modelo',
    tier: (settings.preferred_provider === 'ollama' ? 'local' : settings.preferred_provider === 'free' ? 'free' : 'cloud') as 'free' | 'local' | 'cloud',
  }

  // Poll installed local Ollama models when dropdown opens
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    void checkOllamaRunning().then((running) => {
      if (!mounted) return
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

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
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
    setDownloadStatus('Iniciando motor local…')

    // 1. Ensure Ollama service is running locally
    if (window.helix?.ensureOllama) {
      try {
        await window.helix.ensureOllama()
      } catch {
        // Continue to pull attempt
      }
    }

    setDownloadStatus('Descargando modelo…')

    // 2. Pull model directly via Ollama API
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
      setDownloadStatus('¡Listo para usar!')
    } else {
      setDownloadStatus('Error al descargar')
    }

    setTimeout(() => {
      setDownloadingModel(null)
      setDownloadProgress(0)
      setDownloadStatus('')
    }, 1800)
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
    <div className="model-selector-container" ref={dropdownRef}>
      {/* ── Pill Button in Top Header ── */}
      <button
        type="button"
        className={`model-selector-btn ${isOpen ? 'model-selector-btn--active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Seleccionar modelo de inteligencia artificial"
        aria-label="Selector de modelo"
        aria-expanded={isOpen}
      >
        <span className="model-selector-btn__icon">
          {currentModel.tier === 'free' && <FreeIcon />}
          {currentModel.tier === 'local' && <LocalIcon />}
          {currentModel.tier === 'cloud' && <CloudIcon />}
        </span>
        <span className="model-selector-btn__label">{currentModel.name}</span>
        <span className="model-selector-btn__effort">{activeEffort}</span>
        <span className="model-selector-btn__chevron">▼</span>
      </button>

      {/* ── Dropdown Menu Expanding Downwards ── */}
      {isOpen && (
        <div className="model-dropdown-menu" role="dialog" aria-label="Modelos disponibles">
          {/* 1. Modelos Gratuitos Cloud */}
          <div className="model-dropdown__section-title">
            <FreeIcon />
            <span>Modelos Gratuitos (0-Cost Cloud · Sin Key)</span>
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
                    <span className="model-dropdown__badge model-dropdown__badge--free">0 Cost</span>
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
            <span>Modelos Locales (Tu PC · 100% Privado)</span>
          </div>

          {LOCAL_OLLAMA_MODELS.map((m) => {
            const isSelected = activeModelId === m.id
            const isInstalled = installedOllamaModels.some((name) =>
              name.includes(m.id.toLowerCase().split(':')[0])
            )
            const isDownloading = downloadingModel === m.id

            return (
              <div
                key={m.id}
                className={`model-dropdown__item model-dropdown__item--interactive ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                onClick={() => {
                  if (isInstalled && !isDownloading) void handleSelectModel(m)
                }}
                role="button"
                tabIndex={0}
              >
                <div className="model-dropdown__item-info">
                  <div className="model-dropdown__item-header">
                    <span className="model-dropdown__item-name">{m.name}</span>
                    <span className="model-dropdown__badge model-dropdown__badge--local">Local</span>
                  </div>
                  <span className="model-dropdown__item-desc">{m.description}</span>
                  {isDownloading && (
                    <div className="model-dropdown__progress-box">
                      <div className="model-dropdown__progress-bar">
                        <div
                          className="model-dropdown__progress-fill"
                          style={{ width: `${Math.max(downloadProgress, 4)}%` }}
                        />
                      </div>
                      <span className="model-dropdown__progress-status">{downloadStatus}</span>
                    </div>
                  )}
                </div>

                {isDownloading ? (
                  <span className="model-dropdown__pct">{downloadProgress}%</span>
                ) : isInstalled ? (
                  isSelected ? (
                    <span className="model-dropdown__check">✓</span>
                  ) : (
                    <span className="model-dropdown__ready">Listo</span>
                  )
                ) : (
                  <button
                    type="button"
                    className="model-dropdown__download-btn"
                    onClick={(e) => void handleDownloadOllama(m.id, e)}
                  >
                    Descargar
                  </button>
                )}
              </div>
            )
          })}

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
            <span>Esfuerzo</span>
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
        </div>
      )}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────────────────

function FreeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#77d89a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function LocalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64b4f6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function CloudIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff914d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  )
}
