import React, { useState, useEffect, useRef } from 'react'
import type { HelixSettings } from '../../types/global'
import {
  checkOllamaRunning,
  getInstalledOllamaModels,
  pullOllamaModel,
} from '../../services/ollamaService'
import {
  getModelCatalog,
  pullOllamaModelViaIpc,
  type ModelCatalog,
  type CatalogModelEntry,
} from '../../services/modelCatalogService'
import './ModelSelectorDropdown.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<unknown>
}

interface ModelItem {
  id: string
  name: string
  description: string
  provider: 'free' | 'ollama' | 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter' | 'llama_server'
  tier: 'free' | 'local' | 'cloud'
  badge?: string
}

const FREE_MODELS: ModelItem[] = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Free',
    description: 'Meta AI · 70B de pesos abiertos a 0 coste',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 Free',
    description: 'DeepSeek · Razonamiento paso a paso a 0 coste',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek V3 Free',
    description: 'DeepSeek · Modelo general 671B a 0 coste',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B Free',
    description: 'Alibaba Qwen · Código y shell avanzado a 0 coste',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B Free',
    description: 'Meta AI · Ultra rápido para órdenes directas y control OS',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash Free',
    description: 'Google · Multimodal ágil y 1M contexto a 0 coste',
    provider: 'free',
    tier: 'free',
    badge: '0-Cost Cloud',
  },
]

const LOCAL_OLLAMA_MODELS: ModelItem[] = [
  {
    id: 'llama-server/active-model',
    name: 'Llama Server (GGUF)',
    description: 'llama.cpp portable · En :8080 (0-Install, Cero Servicios)',
    provider: 'llama_server',
    tier: 'local',
    badge: 'llama.cpp',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B Local',
    description: 'Meta AI · 100% privado en CPU/GPU (~2.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B Local',
    description: 'Alibaba Qwen · Especialista en código (~4.7 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder 1.5B Local',
    description: 'Alibaba Qwen · Código y shell ultra ligero (~1.0 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 7B Local',
    description: 'DeepSeek · Razonamiento local (~4.7 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek R1 1.5B Local',
    description: 'DeepSeek · Razonamiento local ligero (~1.1 GB)',
    provider: 'ollama',
    tier: 'local',
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B Local',
    description: 'Google · Excelente capacidad general local (~5.4 GB)',
    provider: 'ollama',
    tier: 'local',
  },
]

const PRO_CLOUD_MODELS: ModelItem[] = [
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: 'Anthropic · Pensamiento híbrido, código y control OS',
    provider: 'anthropic',
    tier: 'cloud',
    badge: 'Hybrid',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic · Estándar de la industria en coding y agentes',
    provider: 'anthropic',
    tier: 'cloud',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    description: 'Anthropic · Rápido y económico con alta precisión',
    provider: 'anthropic',
    tier: 'cloud',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI · Multimodal avanzado y rápido',
    provider: 'openai',
    tier: 'cloud',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'OpenAI · Eficiente y económico para flujos continuos',
    provider: 'openai',
    tier: 'cloud',
  },
  {
    id: 'o1',
    name: 'o1 Reasoning',
    description: 'OpenAI · Razonamiento complejo autónomo',
    provider: 'openai',
    tier: 'cloud',
    badge: 'Reasoning',
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    description: 'OpenAI · Razonamiento STEM y código con selector de esfuerzo',
    provider: 'openai',
    tier: 'cloud',
    badge: 'Reasoning',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Google AI · Multimodal nativo ultra veloz (1M tokens)',
    provider: 'google',
    tier: 'cloud',
  },
  {
    id: 'gemini-2.0-pro-exp-02-05',
    name: 'Gemini 2.0 Pro Exp',
    description: 'Google AI · Máxima capacidad en código y contexto 2M',
    provider: 'google',
    tier: 'cloud',
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    description: 'Groq Cloud · Ultra-rápido ~300 T/s en hardware LPU',
    provider: 'groq',
    tier: 'cloud',
    badge: 'Groq',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B (Groq)',
    description: 'Groq Cloud · Latencia instantánea ~800 T/s',
    provider: 'groq',
    tier: 'cloud',
    badge: 'Groq',
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 70B (Groq)',
    description: 'Groq Cloud · Razonamiento acelerado en LPU',
    provider: 'groq',
    tier: 'cloud',
    badge: 'Groq',
  },
  {
    id: 'openrouter/auto',
    name: 'OpenRouter Auto',
    description: 'OpenRouter · Enrutador dinámico al mejor proveedor',
    provider: 'openrouter',
    tier: 'cloud',
    badge: 'OpenRouter',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1 671B (OpenRouter)',
    description: 'OpenRouter · Razonamiento completo 671B',
    provider: 'openrouter',
    tier: 'cloud',
    badge: 'OpenRouter',
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3 671B (OpenRouter)',
    description: 'OpenRouter · Modelo general 671B de alta velocidad',
    provider: 'openrouter',
    tier: 'cloud',
    badge: 'OpenRouter',
  },
]

export default function ModelSelectorDropdown({ settings, onSave }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [installedOllamaModels, setInstalledOllamaModels] = useState<string[]>([])
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadStatus, setDownloadStatus] = useState<string>('')
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [freeTierKeyConfigured, setFreeTierKeyConfigured] = useState<boolean>(false)
  const [llamaStatus, setLlamaStatus] = useState<{ running: boolean; models?: Array<{ name: string; path: string }> } | null>(null)
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

  // Load catalog + check Ollama on open
  useEffect(() => {
    if (!isOpen) return
    let mounted = true

    void getModelCatalog().then((cat) => {
      if (!mounted) return
      setCatalog(cat)
      // Check if any free-tier model is AVAILABLE (means key is configured)
      const hasKey = cat.categories.free_tier.some((m) => m.status === 'AVAILABLE')
      setFreeTierKeyConfigured(hasKey)
      // Extract installed ollama models from catalog
      const installedNames = cat.categories.local
        .filter((m) => m.installed)
        .map((m) => m.id.toLowerCase())
      setInstalledOllamaModels(installedNames)

      void (window as any).helix?.getLlamaServerStatus?.().then((st: any) => {
        if (mounted && st) setLlamaStatus(st)
      }).catch(() => {})
    }).catch(() => {
      // Fallback: check Ollama directly
      void checkOllamaRunning().then((running) => {
        if (!mounted) return
        if (running) {
          void getInstalledOllamaModels().then((models) => {
            if (mounted) setInstalledOllamaModels(models)
          })
        }
      })
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

  const handleDownloadModel = async (model: ModelItem, event: React.MouseEvent) => {
    event.stopPropagation()
    setDownloadingModel(model.id)
    setDownloadProgress(0)
    setDownloadStatus('Iniciando en segundo plano…')

    if (model.provider === 'llama_server') {
      try {
        setDownloadStatus('Iniciando llama-server...')
        await (window as any).helix?.downloadLlamaServer?.()
        setDownloadStatus('Descargando modelo GGUF...')
        setDownloadProgress(35)
        const res = await (window as any).helix?.downloadGgufModel?.('qwen2.5-coder-1.5b')
        setDownloadProgress(100)
        if (res?.done) {
          setInstalledOllamaModels((prev) => [...prev, model.id.toLowerCase()])
          await onSave({ default_model: model.id, preferred_provider: 'llama_server' })
          setDownloadStatus('¡Listo!')
        } else {
          setDownloadStatus(res?.error || 'Error al descargar')
        }
      } catch (err: any) {
        setDownloadStatus('Error: ' + String(err?.message || err))
      } finally {
        setTimeout(() => {
          setDownloadingModel(null)
          setDownloadProgress(0)
          setDownloadStatus('')
        }, 2000)
      }
      return
    }

    // Ollama: Iniciar servicio en segundo plano primero
    if (window.helix?.ensureOllama) {
      try {
        setDownloadStatus('Iniciando servicio en segundo plano...')
        await window.helix.ensureOllama()
      } catch {
        /* continue */
      }
    }

    // Try IPC-based pull first (handles hardware checks)
    const ipcResult = await pullOllamaModelViaIpc(model.id, 'start')
    if (ipcResult) {
      if (ipcResult.status === 'INCOMPATIBLE') {
        setDownloadStatus('Hardware insuficiente: ' + (ipcResult.issues?.join(', ') ?? ''))
        setTimeout(() => {
          setDownloadingModel(null)
          setDownloadProgress(0)
          setDownloadStatus('')
        }, 3500)
        return
      }
      if (ipcResult.status === 'INSTALLING') {
        setDownloadStatus('Descargando modelo…')
        const success = await pullOllamaModel(model.id, (status, pct) => {
          setDownloadStatus(status)
          setDownloadProgress(pct)
        })
        if (success) {
          setInstalledOllamaModels((prev) => [...prev, model.id.toLowerCase()])
          await onSave({ default_model: model.id, preferred_provider: 'ollama' })
          setDownloadStatus('¡Listo para usar!')
        } else {
          setDownloadStatus('Error al descargar')
        }
        setTimeout(() => {
          setDownloadingModel(null)
          setDownloadProgress(0)
          setDownloadStatus('')
        }, 1800)
        return
      }
    }

    // Fallback: direct Ollama API pull
    setDownloadStatus('Descargando modelo…')
    const success = await pullOllamaModel(model.id, (status, pct) => {
      setDownloadStatus(status)
      setDownloadProgress(pct)
    })
    if (success) {
      setInstalledOllamaModels((prev) => [...prev, model.id.toLowerCase()])
      await onSave({ default_model: model.id, preferred_provider: 'ollama' })
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

  const ollamaRunning = catalog?.ollama_status?.running ?? false
  const ollamaInstalled = catalog?.ollama_status?.installed ?? false

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
          {/* 1. Modelos via OpenRouter (requieren OPENROUTER_API_KEY) */}
          <div className="model-dropdown__section-title">
            <FreeIcon />
            <span>Open Weight Cloud (Tu OPENROUTER_API_KEY)</span>
          </div>
          {!freeTierKeyConfigured && (
            <div className="model-dropdown__key-notice" style={{ padding: '8px 10px', background: 'rgba(234, 88, 12, 0.08)', border: '1px solid rgba(234, 88, 12, 0.25)', borderRadius: '6px', margin: '4px 10px 8px 10px' }}>
              <div style={{ fontSize: '11px', color: '#fed7aa', marginBottom: '6px' }}>
                ℹ️ Añade tu <code>OPENROUTER_API_KEY</code> en ajustes para activar estos modelos
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.helix?.openToolbox?.()
                  }}
                  style={{
                    padding: '4px 9px',
                    fontSize: '11px',
                    background: '#ea580c',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ⚙️ Ir a Configuración
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.helix?.openExternal?.('https://openrouter.ai/keys')
                  }}
                  style={{
                    padding: '4px 9px',
                    fontSize: '11px',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  🔑 Obtener clave (openrouter.ai)
                </button>
              </div>
            </div>
          )}
          {FREE_MODELS.map((m) => {
            const isSelected = activeModelId === m.id
            const catalogEntry = catalog?.categories.free_tier.find((c) => c.id === m.id)
            const isAvailable = catalogEntry?.status === 'AVAILABLE' || freeTierKeyConfigured
            return (
              <button
                key={m.id}
                type="button"
                className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''} ${!isAvailable ? 'model-dropdown__item--auth-required' : ''}`}
                onClick={() => isAvailable ? void handleSelectModel(m) : undefined}
                disabled={!isAvailable}
                title={isAvailable ? m.description : 'Añade OPENROUTER_API_KEY en ajustes'}
              >
                <div className="model-dropdown__item-info">
                  <div className="model-dropdown__item-header">
                    <span className="model-dropdown__item-name">{m.name}</span>
                    {isAvailable
                      ? <span className="model-dropdown__badge model-dropdown__badge--free">OpenRouter</span>
                      : <span className="model-dropdown__badge model-dropdown__badge--auth">Key requerida</span>
                    }
                  </div>
                  <span className="model-dropdown__item-desc">{m.description}</span>
                </div>
                {isSelected && isAvailable && <span className="model-dropdown__check">✓</span>}
              </button>
            )
          })}

          <div className="model-dropdown__divider" />

          {/* 2. Modelos Locales en PC (Ollama) */}
          <div className="model-dropdown__section-title">
            <LocalIcon />
            <span>Modelos Locales (Tu PC · 100% Privado)</span>
          </div>

          <div className="model-dropdown__key-notice" style={{ padding: '6px 10px', background: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.25)', borderRadius: '6px', margin: '4px 10px 8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#93c5fd' }}>
              💻 Inferencia local 100% privada (CPU/GPU)
            </span>
            <span style={{ fontSize: '10px', color: '#60a5fa', background: 'rgba(37,99,235,0.2)', padding: '2px 6px', borderRadius: '4px' }}>
              Auto-gestión
            </span>
          </div>

          {LOCAL_OLLAMA_MODELS.map((m) => {
            const isSelected = activeModelId === m.id
            const isInstalled = m.provider === 'llama_server'
              ? Boolean(llamaStatus?.running || (llamaStatus?.models && llamaStatus.models.length > 0))
              : installedOllamaModels.some((name) =>
                  name.includes(m.id.toLowerCase().split(':')[0])
                )
            const isDownloading = downloadingModel === m.id
            const canDownload = !isInstalled && !isDownloading

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
                    {isInstalled
                      ? <span className="model-dropdown__badge model-dropdown__badge--local">Local ✓</span>
                      : <span className="model-dropdown__badge model-dropdown__badge--local-pending">Local</span>
                    }
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
                ) : canDownload ? (
                  <button
                    type="button"
                    className="model-dropdown__download-btn"
                    onClick={(e) => void handleDownloadModel(m, e)}
                  >
                    Descargar
                  </button>
                ) : null}
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
            const catalogEntry = catalog?.categories.byok.find((c) => c.id === m.id || c.provider === m.provider)
            const isConfigured = catalogEntry?.configured ?? false
            return (
              <button
                key={m.id}
                type="button"
                className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''} ${!isConfigured ? 'model-dropdown__item--auth-required' : ''}`}
                onClick={() => void handleSelectModel(m)}
                title={isConfigured ? m.description : `Añade tu ${m.provider.toUpperCase()} API key en ajustes`}
              >
                <div className="model-dropdown__item-info">
                  <div className="model-dropdown__item-header">
                    <span className="model-dropdown__item-name">{m.name}</span>
                    {isConfigured
                      ? <span className="model-dropdown__badge model-dropdown__badge--byok-ready">BYOK ✓</span>
                      : <span className="model-dropdown__badge">BYOK</span>
                    }
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
