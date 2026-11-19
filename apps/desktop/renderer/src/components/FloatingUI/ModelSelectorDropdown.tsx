import React, { useState, useEffect, useRef } from 'react'
import type { HelixSettings, LlamaServerStatus } from '../../types/global'
import {
  getModelCatalog,
  getOllamaStatus,
  type ModelCatalog,
  type OllamaStatus,
} from '../../services/modelCatalogService'
import { getInstalledLocalModelItems } from './installedLocalModels'
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
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [llamaStatus, setLlamaStatus] = useState<LlamaServerStatus | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Active model resolution
  const activeModelId = settings.default_model || 'meta-llama/llama-3.2-3b-instruct:free'
  const activeEffort = settings.speed_preference === 'high' ? 'Bajo' : settings.quality_preference === 'high' ? 'Alto' : 'Medio'

  const installedLocalModels = getInstalledLocalModelItems(
    ollamaStatus?.models ?? [],
    llamaStatus?.models ?? [],
  )
  const allModels = [...FREE_MODELS, ...installedLocalModels, ...PRO_CLOUD_MODELS]
  const currentModel = allModels.find((m) => m.id === activeModelId) || {
    id: activeModelId,
    name: activeModelId.split(/[\\/]/).pop()?.split(':')[0] || 'Modelo',
    tier: (settings.preferred_provider === 'ollama' ? 'local' : settings.preferred_provider === 'free' ? 'free' : 'cloud') as 'free' | 'local' | 'cloud',
  }

  // Load catalog + check Ollama on open
  useEffect(() => {
    if (!isOpen) return
    let mounted = true

    void getModelCatalog()
      .then((cat) => {
        if (!mounted) return
        setCatalog(cat)
        setCatalogError(null)
      })
      .catch(() => {
        if (mounted) {
          setCatalogError('No se pudo cargar el catálogo de modelos cloud.')
        }
      })
    void getOllamaStatus()
      .then((status) => {
        if (mounted) setOllamaStatus(status)
      })
      .catch((error: unknown) => {
        console.warn('Could not load installed Ollama models.', error)
      })
    void window.helix.getLlamaServerStatus()
      .then((status) => {
        if (mounted) setLlamaStatus(status)
      })
      .catch((error: unknown) => {
        console.warn('Could not load llama-server status.', error)
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
          {catalogError && (
            <div className="model-dropdown__key-notice" role="status">
              {catalogError}
            </div>
          )}
          {/* 1. Modelos cloud gratuitos de OpenRouter */}
          <div className="model-dropdown__section-title">
            <FreeIcon />
            <span>Open Weight Cloud · Enrutamiento gratuito</span>
          </div>
          <div className="model-dropdown__free-tier-note">
            No necesitas configurar una API key para usar estos modelos gratuitos.
          </div>
          {FREE_MODELS.map((m) => {
            const isSelected = activeModelId === m.id
            return (
              <button
                key={m.id}
                type="button"
                className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                onClick={() => void handleSelectModel(m)}
                title={m.description}
              >
                <div className="model-dropdown__item-info">
                  <div className="model-dropdown__item-header">
                    <span className="model-dropdown__item-name">{m.name}</span>
                    <span className="model-dropdown__badge model-dropdown__badge--free">OpenRouter</span>
                  </div>
                  <span className="model-dropdown__item-desc">{m.description}</span>
                </div>
                {isSelected && <span className="model-dropdown__check">✓</span>}
              </button>
            )
          })}

          <div className="model-dropdown__divider" />

          {/* 2. Solo modelos locales ya instalados */}
          <div className="model-dropdown__section-title">
            <LocalIcon />
            <span>Modelos locales descargados</span>
          </div>
          {installedLocalModels.length === 0 ? (
            <div className="model-dropdown__free-tier-note">
              Aún no hay modelos locales descargados. Encuentra las descargas en Configuración → Model Store.
            </div>
          ) : installedLocalModels.map((m) => {
            const isSelected = activeModelId === m.id
            return (
              <button
                key={m.id}
                type="button"
                className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''}`}
                onClick={() => void handleSelectModel(m)}
                title={m.description}
              >
                <div className="model-dropdown__item-info">
                  <div className="model-dropdown__item-header">
                    <span className="model-dropdown__item-name">{m.name}</span>
                    <span className="model-dropdown__badge model-dropdown__badge--local">{m.badge || 'Local ✓'}</span>
                  </div>
                  <span className="model-dropdown__item-desc">{m.description}</span>
                </div>
                {isSelected && <span className="model-dropdown__check">✓</span>}
              </button>
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
