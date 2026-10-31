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

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI (Gemini)',
  groq: 'Groq Cloud (Ultra-Fast 300 T/s)',
  openrouter: 'OpenRouter (All-in-One Cloud)',
  custom: 'Custom / Local (Ollama, vLLM, DeepSeek)'
}

const ALL_CORE_PROVIDERS: ProviderID[] = ['openai', 'anthropic', 'google', 'groq', 'openrouter']

const KEY_HEALTH_LABELS: Record<KeyHealth, { label: string; className: string }> = {
  healthy:        { label: 'Connected',     className: 'status-badge--healthy' },
  rate_limited:   { label: 'Rate Limited',  className: 'status-badge--rate-limited' },
  quota_exceeded: { label: 'Quota Exceeded',className: 'status-badge--error' },
  billing_exhausted: { label: 'Billing Exhausted', className: 'status-badge--error' },
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
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [visibleKeySlots, setVisibleKeySlots] = useState<Record<string, number>>({})

  // Custom Endpoint state
  const [customEndpointName, setCustomEndpointName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')

  // Llama Server (llama.cpp) state
  const [llamaStatus, setLlamaStatus] = useState<{
    installed: boolean
    running: boolean
    binary_path?: string
    models?: Array<{ name: string; path: string; size_gb: number }>
    models_dir?: string
    active_model?: string
  } | null>(null)
  const [llamaLoading, setLlamaLoading] = useState(false)

  const refreshLlamaStatus = async () => {
    try {
      const res: any = await (window as any).helix?.getLlamaServerStatus?.()
      if (res) setLlamaStatus(res)
    } catch (err) {
      console.warn('[AISection] Failed to get Llama Server status:', err)
    }
  }

  React.useEffect(() => {
    void refreshLlamaStatus()
  }, [])

  const [downloadingLlama, setDownloadingLlama] = useState(false)
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null)
  const [downloadStatusMsg, setDownloadStatusMsg] = useState('')

  const handleDownloadBinary = async () => {
    setDownloadingLlama(true)
    setDownloadStatusMsg('Descargando llama-server portátil (~25 MB)...')
    try {
      const res: any = await (window as any).helix?.downloadLlamaServer?.()
      if (res?.server_status) setLlamaStatus(res.server_status)
      setDownloadStatusMsg(res?.done ? '¡llama-server instalado!' : (res?.error || 'Error al descargar'))
    } catch (e: any) {
      setDownloadStatusMsg('Error: ' + String(e))
    } finally {
      setDownloadingLlama(false)
      setTimeout(() => setDownloadStatusMsg(''), 3000)
    }
  }

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingModelId(modelId)
    setDownloadStatusMsg(`Descargando ${modelId} desde Hugging Face...`)
    try {
      const res: any = await (window as any).helix?.downloadGgufModel?.(modelId)
      if (res?.server_status) setLlamaStatus(res.server_status)
      setDownloadStatusMsg(res?.done ? '¡Modelo GGUF listo!' : (res?.error || 'Error al descargar'))
    } catch (e: any) {
      setDownloadStatusMsg('Error: ' + String(e))
    } finally {
      setDownloadingModelId(null)
      setTimeout(() => setDownloadStatusMsg(''), 3000)
    }
  }

  const handleToggleLlamaServer = async (modelPath?: string) => {
    setLlamaLoading(true)
    try {
      if (llamaStatus?.running) {
        const res: any = await (window as any).helix?.stopLlamaServer?.()
        if (res?.status) setLlamaStatus(res.status)
      } else if (modelPath || (llamaStatus?.models && llamaStatus.models.length > 0)) {
        const target = modelPath || llamaStatus!.models![0].path
        const res: any = await (window as any).helix?.startLlamaServer?.(target)
        if (res?.status) setLlamaStatus(res.status)
      }
    } catch (err) {
      console.warn('[AISection] Failed to toggle Llama Server:', err)
    } finally {
      setLlamaLoading(false)
    }
  }

  // Add Custom Model state
  const [showAddModelModal, setShowAddModelModal] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelProvider, setNewModelProvider] = useState<ProviderID>('openai')
  const [newModelContext, setNewModelContext] = useState(128000)
  const [newModelCost, setNewModelCost] = useState<'low' | 'medium' | 'high' | 'premium'>('medium')
  const [newModelCaps, setNewModelCaps] = useState({
    vision: false,
    tool_calling: true,
    coding: true,
    reasoning: true,
    computer_use: false,
    structured_output: true,
    audio: false,
    realtime: false,
    speech_to_text: false,
    text_to_speech: false,
    low_latency: true,
    long_context: false,
    browser_use: false,
    streaming: true,
    text: true
  })

  const getProviderStatus = (providerId: ProviderID) =>
    providers.find((p) => p.id === providerId)

  const getVisibleKeyCount = (providerId: ProviderID) => Math.max(
    3,
    visibleKeySlots[providerId] || 0,
    getProviderStatus(providerId)?.keys?.length || 0,
  )

  const handleKeyInput = (provider: string, slot: KeySlot, value: string) => {
    setKeyInputs((prev) => ({ ...prev, [`${provider}_${slot}`]: value }))
  }

  const handleValidateKey = async (provider: ProviderID, slot: KeySlot) => {
    const key = keyInputs[`${provider}_${slot}`]
    if (!key?.trim()) return
    const resultKey = `${provider}_${slot}`
    setValidating((prev) => ({ ...prev, [resultKey]: true }))
    setValidationErrors((prev) => ({ ...prev, [resultKey]: '' }))
    try {
      // SECURITY: key goes directly to Python via IPC, never logged on renderer side
      const health = await window.helix?.validateKey(provider, slot, key)
      setValidationResults((prev) => ({ ...prev, [resultKey]: health as KeyHealth }))
    } catch (error) {
      setValidationResults((prev) => ({ ...prev, [resultKey]: 'unavailable' }))
      setValidationErrors((prev) => ({
        ...prev,
        [resultKey]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setValidating((prev) => ({ ...prev, [resultKey]: false }))
      onRefresh()
    }
  }

  const handleAddCustomEndpoint = async () => {
    if (!customEndpointName.trim() || !customBaseUrl.trim()) return
    const newEndpoint = {
      id: `custom_${Date.now()}`,
      name: customEndpointName.trim(),
      baseUrl: customBaseUrl.trim(),
      apiKey: customApiKey.trim() || undefined,
      enabled: true
    }
    const currentEndpoints = settings.custom_endpoints || []
    await onSave({ custom_endpoints: [...currentEndpoints, newEndpoint] })
    setCustomEndpointName('')
    setCustomBaseUrl('')
    setCustomApiKey('')
  }

  const handleRemoveCustomEndpoint = async (id: string) => {
    const currentEndpoints = settings.custom_endpoints || []
    await onSave({ custom_endpoints: currentEndpoints.filter((e) => e.id !== id) })
  }

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newModelId.trim() || !newModelName.trim()) return

    const customModel: ModelDefinition = {
      id: newModelId.trim().toLowerCase(),
      provider: newModelProvider,
      display_name: newModelName.trim(),
      priority: 1,
      enabled: true,
      fallback_group: `${newModelProvider}_custom`,
      capabilities: {
        ...newModelCaps,
        context_window: newModelContext,
        cost_tier: newModelCost
      }
    }

    const currentCustomModels = settings.custom_models || []
    await onSave({ custom_models: [...currentCustomModels, customModel] })
    setShowAddModelModal(false)
    setNewModelId('')
    setNewModelName('')
    onRefresh()
  }

  const allModels = [
    ...models,
    ...(settings.custom_models || [])
  ]

  const configuredModels = allModels.filter((m) =>
    providers.some((p) => p.id === m.provider && p.configured) ||
    m.provider === 'custom' ||
    settings.custom_models?.some((cm) => cm.id === m.id)
  )

  return (
    <div className="toolbox-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 className="toolbox-section__title" style={{ margin: 0 }}>Model & API Key Orchestration</h2>
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '6px 16px', borderRadius: 'var(--radius-btn)' }}
          onClick={() => setShowAddModelModal(true)}
        >
          + Add Custom Model
        </button>
      </div>

      <p className="toolbox-section__desc">
        Manage API keys across OpenAI, Anthropic, Google, and Local/OpenAI-compatible endpoints. Register custom models with custom context windows and capability matrices.
      </p>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Complex Workflow Planning</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.complex_workflows_enabled ?? false}
              onChange={(event) => void onSave({
                complex_workflows_enabled: event.target.checked,
              })}
            />
            <span className="toggle__slider" />
          </label>
        </div>
        <p className="toolbox-section__desc">
          When enabled, the model decides whether a request needs coordinated
          tool steps; an explicit request to break down a task also invokes the
          planner. This can add model calls. Planned actions still use normal
          permission checks and confirmations. Off by default.
        </p>
      </div>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">App-level subagent delegation</span>
          <label className={`toggle ${settings.subagents_available ? '' : 'toggle--disabled'}`}>
            <input
              type="checkbox"
              checked={settings.subagents_enabled ?? true}
              disabled={!settings.subagents_available}
              onChange={(event) => onSave({
                subagents_enabled: event.target.checked,
              })}
            />
            <span className="toggle__slider" />
          </label>
        </div>
        <p className="toolbox-section__desc">
          When enabled, HELIX may use its built-in delegate_task tool for focused
          research or coding subtasks. Child agents are separate queued tasks and
          reuse the active provider session with the same permission policy.
          {!settings.subagents_available
            ? ' The current runtime does not expose the delegation capability.'
            : ' Delegation is available only when HELIX chooses to call the tool.'}
        </p>
      </div>

      {/* ── Core Providers (3 Keys Each) ────────────────────────── */}
      {ALL_CORE_PROVIDERS.map((providerId) => {
        const status = getProviderStatus(providerId)
        const isConfigured = status?.configured ?? false

        return (
          <div key={providerId} className="toolbox-card" style={{ marginBottom: 16 }}>
            <div className="toolbox-card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="toolbox-card__title">{PROVIDER_NAMES[providerId]}</span>
                <span className="text-xs text-muted">3-Key Automatic Failover Pool</span>
              </div>
              <span className={`status-badge ${isConfigured ? 'status-badge--healthy' : 'status-badge--unconfigured'}`}>
                {isConfigured ? 'Configured' : 'Not Configured'}
              </span>
            </div>

            {/* Three slots are guaranteed; users can add as many more as needed. */}
            {Array.from({ length: getVisibleKeyCount(providerId) }, (_, index) => index + 1).map((slot) => {
              const keyStatus = status?.keys?.find((k) => k.slot === slot)
              const health = keyStatus?.health ?? 'unconfigured'
              const inputKey = `${providerId}_${slot}`
              const isValidating = validating[inputKey]
              const valResult = validationResults[inputKey]
              const displayHealth = valResult ?? health

              return (
                <React.Fragment key={slot}>
                  <div className="key-row">
                    <span className="key-row__slot">SLOT {slot}</span>
                    <input
                      className="form-input key-row__input"
                      type="password"
                      placeholder={keyStatus?.configured ? '••••••••••••••••••••••••••••••••' : `Enter ${PROVIDER_NAMES[providerId]} API Key (Slot ${slot})...`}
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
                      {isValidating ? 'Testing...' : 'Save & Validate'}
                    </button>
                  </div>
                  {validationErrors[inputKey] && (
                    <p role="alert" className="text-xs text-muted" style={{ color: 'var(--red)', margin: '4px 0 8px' }}>
                      {validationErrors[inputKey]}
                    </p>
                  )}
                </React.Fragment>
              )
            })}
            <button
              type="button"
              className="validate-btn"
              style={{ marginTop: 8, fontSize: 12 }}
              onClick={() => setVisibleKeySlots((previous) => ({
                ...previous,
                [providerId]: getVisibleKeyCount(providerId) + 1,
              }))}
            >
              + Add another API key slot
            </button>
          </div>
        )
      })}

      {/* ── Llama Server (llama.cpp Portable Local) ── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="toolbox-card__title">Llama Server (llama.cpp Portable)</span>
            <span className="text-xs text-muted">0-Install · Local GGUF · Cero Servicios</span>
          </div>
          <span className={`status-badge ${llamaStatus?.running ? 'status-badge--healthy' : llamaStatus?.installed ? 'status-badge--rate-limited' : 'status-badge--unconfigured'}`}>
            {llamaStatus?.running ? 'Activo en :8080' : llamaStatus?.installed ? 'Instalado (Detenido)' : 'Binario no encontrado'}
          </span>
        </div>

        <p className="toolbox-section__desc" style={{ marginBottom: 10 }}>
          Ejecuta modelos locales sin instalar software de terceros ni servicios en Windows.
          Coloca <code>llama-server.exe</code> en <code>%APPDATA%\Helix\bin</code> y tus archivos <code>.gguf</code> en <code>%APPDATA%\Helix\models</code>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {llamaStatus?.models && llamaStatus.models.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {llamaStatus.models.map((m) => (
                <div
                  key={m.path}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--canvas)',
                    borderRadius: 'var(--radius-btn)',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div>
                    <span className="text-sm weight-medium text-bone">{m.name}</span>
                    <span className="text-xs text-muted" style={{ marginLeft: 8 }}>({m.size_gb} GB)</span>
                    {llamaStatus.active_model === m.path && (
                      <span className="status-badge status-badge--healthy" style={{ marginLeft: 8, fontSize: 10 }}>En uso</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="validate-btn"
                    disabled={llamaLoading}
                    onClick={() => handleToggleLlamaServer(m.path)}
                  >
                    {llamaStatus.running && llamaStatus.active_model === m.path ? 'Detener' : 'Ejecutar'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted" style={{ margin: '6px 0' }}>
              No se detectaron archivos .gguf en <code>{llamaStatus?.models_dir || '%APPDATA%\Helix\models'}</code>.
            </p>
          )}

          {/* ── Binario Download Prompt if not installed ── */}
          {!llamaStatus?.installed && (
            <div style={{ padding: '10px 12px', background: 'rgba(238, 96, 24, 0.08)', borderRadius: 'var(--radius-btn)', border: '1px solid rgba(238, 96, 24, 0.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="text-sm weight-medium" style={{ color: '#ff914d' }}>Descarga automática de llama-server.exe</span>
                <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Descarga directa del binario oficial de llama.cpp (~25 MB). Cero instalación.</p>
              </div>
              <button
                type="button"
                className="validate-btn"
                style={{ background: 'rgba(238, 96, 24, 0.2)', borderColor: '#ee6018', color: '#ff914d' }}
                disabled={downloadingLlama}
                onClick={handleDownloadBinary}
              >
                {downloadingLlama ? 'Descargando...' : 'Descargar binario'}
              </button>
            </div>
          )}

          {/* ── Curated GGUF Model Downloader ── */}
          <div style={{ marginTop: 8 }}>
            <span className="text-xs weight-medium text-muted" style={{ display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Modelos GGUF recomendados (Hugging Face)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'llama-3.2-3b', name: 'Llama 3.2 3B Instruct', size: '2.0 GB', desc: 'Meta AI · Rápido y versátil para control OS' },
                { id: 'qwen2.5-coder-1.5b', name: 'Qwen 2.5 Coder 1.5B', size: '1.0 GB', desc: 'Alibaba · Código, shell y scripts' },
                { id: 'deepseek-r1-1.5b', name: 'DeepSeek R1 1.5B Distill', size: '1.1 GB', desc: 'DeepSeek · Razonamiento paso a paso ultra-ligero' },
              ].map((curated) => {
                const isDownloaded = llamaStatus?.models?.some((m) => m.name.toLowerCase().includes(curated.id.toLowerCase()))
                const isDownloadingThis = downloadingModelId === curated.id
                return (
                  <div
                    key={curated.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--canvas)',
                      borderRadius: 'var(--radius-btn)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div>
                      <span className="text-sm weight-medium text-bone">{curated.name}</span>
                      <span className="text-xs text-muted" style={{ marginLeft: 8 }}>({curated.size})</span>
                      <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>{curated.desc}</p>
                    </div>
                    {isDownloaded ? (
                      <span className="status-badge status-badge--healthy" style={{ fontSize: 11 }}>Descargado ✓</span>
                    ) : (
                      <button
                        type="button"
                        className="validate-btn"
                        disabled={isDownloadingThis || downloadingLlama}
                        onClick={() => handleDownloadModel(curated.id)}
                      >
                        {isDownloadingThis ? 'Descargando...' : 'Descargar GGUF'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {downloadStatusMsg && (
            <p className="text-xs" style={{ color: 'var(--orange)', margin: '4px 0' }}>{downloadStatusMsg}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {llamaStatus?.running && (
              <button
                type="button"
                className="validate-btn"
                style={{ background: 'rgba(212, 84, 74, 0.15)', borderColor: 'var(--red)', color: 'var(--red)' }}
                disabled={llamaLoading}
                onClick={() => handleToggleLlamaServer()}
              >
                Detener Llama Server
              </button>
            )}
            <button
              type="button"
              className="validate-btn"
              disabled={llamaLoading}
              onClick={() => void refreshLlamaStatus()}
            >
              Recargar modelos GGUF
            </button>
          </div>
        </div>
      </div>

      {/* ── Custom & Local Endpoints (Ollama, LM Studio, vLLM, DeepSeek) ── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Local & Custom OpenAI-Compatible Endpoints</span>
          <span className="text-xs text-muted">Ollama · vLLM · LM Studio · DeepSeek</span>
        </div>

        {/* Existing Custom Endpoints */}
        {settings.custom_endpoints && settings.custom_endpoints.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {settings.custom_endpoints.map((ep) => (
              <div
                key={ep.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--canvas)',
                  borderRadius: 'var(--radius-btn)',
                  border: '1px solid var(--border)'
                }}
              >
                <div>
                  <span className="text-sm weight-medium text-bone">{ep.name}</span>
                  <span className="text-xs text-mono text-muted" style={{ marginLeft: 10 }}>{ep.baseUrl}</span>
                </div>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }}
                  onClick={() => handleRemoveCustomEndpoint(ep.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.5fr auto', gap: 8, alignItems: 'center' }}>
          <input
            className="form-input"
            type="text"
            placeholder="Endpoint Name (e.g. Ollama Local)"
            value={customEndpointName}
            onChange={(e) => setCustomEndpointName(e.target.value)}
          />
          <input
            className="form-input"
            type="text"
            placeholder="Base URL (http://localhost:11434/v1)"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
          />
          <input
            className="form-input"
            type="password"
            placeholder="API Key (Optional for Local)"
            value={customApiKey}
            onChange={(e) => setCustomApiKey(e.target.value)}
          />
          <button
            type="button"
            className="validate-btn"
            onClick={handleAddCustomEndpoint}
            disabled={!customEndpointName.trim() || !customBaseUrl.trim()}
          >
            + Add Endpoint
          </button>
        </div>
      </div>

      {/* ── Available & Registered Models ───────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Registered Models ({configuredModels.length})</span>
          <button className="refresh-btn" onClick={onRefresh}>Refresh Registry</button>
        </div>

        {configuredModels.length === 0 ? (
          <p className="text-muted text-xs">
            No models available. Enter your API keys above or register a local endpoint.
          </p>
        ) : (
          <div className="models-table">
            <div className="models-table__header">
              <span>Model Name / ID</span>
              <span>Provider</span>
              <span>Capabilities</span>
              <span>Context</span>
              <span>Tier</span>
            </div>
            {configuredModels.map((model) => (
              <div key={model.id} className="models-table__row">
                <span className="model-name text-mono">{model.display_name}</span>
                <span className="model-provider">{PROVIDER_NAMES[model.provider] || model.provider}</span>
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

      {/* ── Routing & Fallback Preferences ─────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Routing & Fallback Preferences</span>
        </div>

        <div className="form-row">
          <label className="form-label">Default Execution Model</label>
          <select
            className="form-input"
            value={settings.default_model ?? ''}
            onChange={(e) => onSave({ default_model: e.target.value || null })}
          >
            <option value="">Auto-select (optimal model per task requirements)</option>
            {configuredModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} ({PROVIDER_NAMES[m.provider] || m.provider})
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Provider-Bound Fallback</label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.fallback_enabled}
              onChange={(e) => onSave({ fallback_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
          <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
            (Key 1 → Key 2 → Key 3 inside the same provider)
          </span>
        </div>

        <div className="form-row">
          <label className="form-label">Cambio automático de proveedor</label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.cross_provider_fallback}
              onChange={(e) => onSave({ cross_provider_fallback: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
          <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
            (Reintenta la solicitud en el siguiente proveedor compatible usando el mismo contexto y los resultados de herramientas)
          </span>
        </div>

        <div className="form-row">
          <label className="form-label">Maximum wait per model response</label>
          <select
            className="form-input"
            value={settings.model_request_timeout_seconds ?? 90}
            onChange={(e) => void onSave({ model_request_timeout_seconds: Number(e.target.value) })}
          >
            <option value="30">30 seconds (fast failover)</option>
            <option value="60">60 seconds</option>
            <option value="90">90 seconds (recommended)</option>
            <option value="180">3 minutes (slow providers)</option>
            <option value="300">5 minutes (large individual turns)</option>
          </select>
          <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
            A timeout switches to the next compatible model; it does not limit the total workflow.
          </span>
        </div>

        <div className="form-row">
          <label className="form-label">Cost Optimization Tier</label>
          <select
            className="form-input"
            value={settings.cost_preference}
            onChange={(e) => onSave({ cost_preference: e.target.value as 'low' | 'balanced' | 'high' })}
          >
            <option value="low">Low Latency / Cost Efficient (Gemini Flash, Haiku, GPT-4o-mini)</option>
            <option value="balanced">Balanced (Default)</option>
            <option value="high">Maximum Reasoning & Synthesis (Claude 3.7 Sonnet, GPT-4o, Gemini Pro)</option>
          </select>
        </div>
      </div>

      {/* ── Add Custom Model Modal ─────────────────────────────── */}
      {showAddModelModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--carbon)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            padding: 28,
            maxWidth: 540,
            width: '90%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
          }}>
            <h3 style={{ margin: '0 0 16px', color: 'var(--chalk)', fontSize: 18 }}>Register New Model</h3>

            <form onSubmit={handleAddCustomModel}>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <label className="form-label">Model Identifier</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. deepseek-r1, llama-3.3-70b, gpt-4o-mini"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  required
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <label className="form-label">Display Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. DeepSeek R1 (Local)"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  required
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <label className="form-label">Provider</label>
                <select
                  className="form-input"
                  value={newModelProvider}
                  onChange={(e) => setNewModelProvider(e.target.value as ProviderID)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google AI</option>
                  {(settings.custom_endpoints || []).map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.name} ({endpoint.id})
                    </option>
                  ))}
                  <option value="custom">Custom / Local Endpoint (add an endpoint first)</option>
                </select>
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <label className="form-label">Context Window (tokens)</label>
                <input
                  className="form-input"
                  type="number"
                  value={newModelContext}
                  onChange={(e) => setNewModelContext(parseInt(e.target.value, 10) || 128000)}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <label className="form-label">Capabilities</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' }}>
                  {[
                    { key: 'vision', label: 'Vision' },
                    { key: 'tool_calling', label: 'Tool Calling' },
                    { key: 'coding', label: 'Code Execution' },
                    { key: 'reasoning', label: 'Reasoning' },
                    { key: 'computer_use', label: 'Computer Use' },
                    { key: 'structured_output', label: 'JSON Schema' }
                  ].map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--bone)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(newModelCaps as any)[key]}
                        onChange={(e) => setNewModelCaps((prev) => ({ ...prev, [key]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModelModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Register Model
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
