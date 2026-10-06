import React, { useState } from 'react'
import type { ProviderStatus, ModelDefinition, HelixSettings, ProviderID, KeySlot, KeyHealth } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  providers: ProviderStatus[]
  models: ModelDefinition[]
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
  onRefresh: () => void
}

const PROVIDER_NAMES: Record<ProviderID, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI'
}

const ALL_PROVIDERS: ProviderID[] = ['openai', 'anthropic', 'google']

const KEY_HEALTH_LABELS: Record<KeyHealth, { label: string; className: string }> = {
  healthy:        { label: 'Connected',     className: 'status-badge--healthy' },
  rate_limited:   { label: 'Rate Limited',  className: 'status-badge--rate-limited' },
  quota_exceeded: { label: 'Quota Exceeded',className: 'status-badge--error' },
  auth_error:     { label: 'Invalid Key',   className: 'status-badge--error' },
  unavailable:    { label: 'Unavailable',   className: 'status-badge--error' },
  unconfigured:   { label: 'Not Configured',className: 'status-badge--unconfigured' }
}

const CAPABILITY_LABELS: Partial<Record<keyof ModelDefinition['capabilities'], string>> = {
  vision: 'vision',
  tool_calling: 'tools',
  computer_use: 'computer',
  coding: 'coding',
  reasoning: 'reasoning',
  audio: 'audio',
  realtime: 'realtime',
  speech_to_text: 'stt',
  text_to_speech: 'tts',
  long_context: 'long-ctx',
  structured_output: 'structured'
}

export default function AISection({ providers, models, settings, onSave, onRefresh }: Props) {
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [validating, setValidating] = useState<Record<string, boolean>>({})
  const [validationResults, setValidationResults] = useState<Record<string, KeyHealth>>({})

  const getProviderStatus = (providerId: ProviderID) =>
    providers.find((p) => p.id === providerId)

  const handleKeyInput = (provider: ProviderID, slot: KeySlot, value: string) => {
    setKeyInputs((prev) => ({ ...prev, [`${provider}_${slot}`]: value }))
  }

  const handleValidateKey = async (provider: ProviderID, slot: KeySlot) => {
    const key = keyInputs[`${provider}_${slot}`]
    if (!key?.trim()) return
    const resultKey = `${provider}_${slot}`
    setValidating((prev) => ({ ...prev, [resultKey]: true }))
    try {
      // SECURITY: key goes directly to Python via IPC, never logged on renderer side
      const health = await window.helix?.validateKey(provider, slot, key)
      setValidationResults((prev) => ({ ...prev, [resultKey]: health as KeyHealth }))
    } catch {
      setValidationResults((prev) => ({ ...prev, [resultKey]: 'unavailable' }))
    } finally {
      setValidating((prev) => ({ ...prev, [resultKey]: false }))
      // After validation, refresh providers
      onRefresh()
    }
  }

  const configuredModels = models.filter((m) =>
    providers.some((p) => p.id === m.provider && p.configured)
  )

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">AI Configuration</h2>
      <p className="toolbox-section__desc">
        Configure API keys for each provider. Only providers with a valid key will be available for model routing.
        Models are automatically filtered based on your configured providers and task requirements.
      </p>

      {/* ── Provider Cards ──────────────────────────────────── */}
      {ALL_PROVIDERS.map((providerId) => {
        const status = getProviderStatus(providerId)
        const isConfigured = status?.configured ?? false

        return (
          <div key={providerId} className="toolbox-card" style={{ marginBottom: 16 }}>
            <div className="toolbox-card__header">
              <span className="toolbox-card__title">{PROVIDER_NAMES[providerId]}</span>
              <span className={`status-badge ${isConfigured ? 'status-badge--healthy' : 'status-badge--unconfigured'}`}>
                {isConfigured ? 'Configured' : 'Not Configured'}
              </span>
            </div>

            {/* Key slots */}
            {([1, 2, 3] as KeySlot[]).map((slot) => {
              const keyStatus = status?.keys.find((k) => k.slot === slot)
              const health = keyStatus?.health ?? 'unconfigured'
              const healthInfo = KEY_HEALTH_LABELS[health]
              const inputKey = `${providerId}_${slot}`
              const isValidating = validating[inputKey]
              const valResult = validationResults[inputKey]
              const displayHealth = valResult ?? health

              return (
                <div key={slot} className="key-row">
                  <span className="key-row__slot">KEY {slot}</span>
                  <input
                    className="form-input key-row__input"
                    type="password"
                    placeholder={keyStatus?.configured ? '••••••••••••••••' : 'Enter API key...'}
                    value={keyInputs[inputKey] ?? ''}
                    onChange={(e) => handleKeyInput(providerId, slot, e.target.value)}
                    autoComplete="off"
                  />
                  <span className={`status-badge ${KEY_HEALTH_LABELS[displayHealth].className}`} style={{ flexShrink: 0 }}>
                    {KEY_HEALTH_LABELS[displayHealth].label}
                  </span>
                  <button
                    className="validate-btn"
                    onClick={() => handleValidateKey(providerId, slot)}
                    disabled={!keyInputs[inputKey]?.trim() || isValidating}
                  >
                    {isValidating ? '...' : 'Save & Validate'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* ── Available Models ─────────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Available Models</span>
          <button className="refresh-btn" onClick={onRefresh}>↺ Refresh</button>
        </div>

        {configuredModels.length === 0 ? (
          <p className="text-muted text-xs">
            No models available. Configure at least one provider API key above.
          </p>
        ) : (
          <div className="models-table">
            <div className="models-table__header">
              <span>Model</span>
              <span>Provider</span>
              <span>Capabilities</span>
              <span>Context</span>
              <span>Cost</span>
            </div>
            {configuredModels.map((model) => (
              <div key={model.id} className="models-table__row">
                <span className="model-name text-mono">{model.display_name}</span>
                <span className="model-provider">{PROVIDER_NAMES[model.provider]}</span>
                <span className="model-caps">
                  {(Object.entries(CAPABILITY_LABELS) as Array<[keyof ModelDefinition['capabilities'], string]>)
                    .filter(([key]) => model.capabilities[key])
                    .map(([, label]) => (
                      <span key={label} className="cap-badge">{label}</span>
                    ))}
                </span>
                <span className="text-xs text-muted text-mono">
                  {model.capabilities.context_window >= 1000000
                    ? `${(model.capabilities.context_window / 1000000).toFixed(1)}M`
                    : `${Math.round(model.capabilities.context_window / 1000)}k`}
                </span>
                <span className={`cost-badge cost-badge--${model.capabilities.cost_tier}`}>
                  {model.capabilities.cost_tier}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Routing Preferences ─────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Routing Preferences</span>
        </div>

        <div className="form-row">
          <label className="form-label">Default Model</label>
          <select
            className="form-input"
            value={settings.default_model ?? ''}
            onChange={(e) => onSave({ default_model: e.target.value || null })}
          >
            <option value="">Auto (best for task)</option>
            {configuredModels.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name} ({PROVIDER_NAMES[m.provider]})</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Fallback Enabled</label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.fallback_enabled}
              onChange={(e) => onSave({ fallback_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Cross-Provider Fallback</label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.cross_provider_fallback}
              onChange={(e) => onSave({ cross_provider_fallback: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
          <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
            (Only between your configured providers)
          </span>
        </div>

        <div className="form-row">
          <label className="form-label">Cost Preference</label>
          <select
            className="form-input"
            value={settings.cost_preference}
            onChange={(e) => onSave({ cost_preference: e.target.value as 'low' | 'balanced' | 'high' })}
          >
            <option value="low">Prefer cheaper models</option>
            <option value="balanced">Balanced</option>
            <option value="high">Prefer best quality</option>
          </select>
        </div>
      </div>
    </div>
  )
}
