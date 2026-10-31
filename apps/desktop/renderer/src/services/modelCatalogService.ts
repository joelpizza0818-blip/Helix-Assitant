/**
 * Model Catalog Service — communicates with the agent backend via IPC.
 *
 * Provides typed access to the unified model catalog, Ollama status and
 * model pull operations.  Falls back to a static catalog if the backend
 * is not reachable (e.g., during UI development without a running agent).
 */

declare const window: {
  helix?: {
    sendMessage?: (type: string, payload?: unknown) => Promise<unknown>
    ensureOllama?: () => Promise<void>
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelStatus =
  | 'AVAILABLE'
  | 'INSTALLING'
  | 'READY'
  | 'UNAVAILABLE'
  | 'AUTH_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'INCOMPATIBLE'
  | 'ERROR'

export interface CatalogModelEntry {
  id: string
  display_name: string
  provider: string
  model_type?: string
  access_type?: 'free_tier' | 'local' | 'byok'
  weight_source?: string
  size_gb?: number
  note?: string
  auth_note?: string
  capabilities: {
    text?: boolean
    vision?: boolean
    tool_calling?: boolean
    coding?: boolean
    reasoning?: boolean
    streaming?: boolean
    context_window?: number
    cost_tier?: string
    [key: string]: unknown
  }
  status: ModelStatus
  /** Ollama-specific */
  installed?: boolean
  ollama_running?: boolean
  /** BYOK-specific */
  configured?: boolean
}

export interface ModelCatalog {
  categories: {
    byok: CatalogModelEntry[]
    free_tier: CatalogModelEntry[]
    local: CatalogModelEntry[]
  }
  ollama_status: {
    installed: boolean
    running: boolean
    install_hint?: string
  }
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  models: { name: string; size_gb: number; modified_at: string }[]
  install_hint?: string
  active_pulls: string[]
}

export interface PullResult {
  model: string
  status: ModelStatus
  size_gb?: number
  issues?: string[]
  free_disk_gb?: number
  free_ram_gb?: number
  message?: string
  cancelled?: boolean
}

// ── Static fallback catalog (kept in sync with model-catalog.json) ───────────

const STATIC_CATALOG: ModelCatalog = {
  categories: {
    free_tier: [
      {
        id: 'meta-llama/llama-3.2-3b-instruct:free',
        display_name: 'Llama 3.2 3B Instruct',
        provider: 'free',
        model_type: 'open_weight',
        access_type: 'free_tier',
        weight_source: 'Meta',
        note: 'Requiere tu OPENROUTER_API_KEY',
        capabilities: { text: true, tool_calling: true, streaming: true, context_window: 131072 },
        status: 'AUTH_REQUIRED',
        auth_note: 'Requiere tu propia OPENROUTER_API_KEY',
      },
      {
        id: 'qwen/qwen-2.5-coder-7b-instruct:free',
        display_name: 'Qwen 2.5 Coder 7B',
        provider: 'free',
        model_type: 'open_weight',
        access_type: 'free_tier',
        weight_source: 'Alibaba',
        note: 'Requiere tu OPENROUTER_API_KEY',
        capabilities: { text: true, tool_calling: true, streaming: true, coding: true, context_window: 32768 },
        status: 'AUTH_REQUIRED',
        auth_note: 'Requiere tu propia OPENROUTER_API_KEY',
      },
      {
        id: 'deepseek/deepseek-r1:free',
        display_name: 'DeepSeek R1',
        provider: 'free',
        model_type: 'open_weight',
        access_type: 'free_tier',
        weight_source: 'DeepSeek',
        note: 'Requiere tu OPENROUTER_API_KEY. Sin tool calling.',
        capabilities: { text: true, streaming: true, reasoning: true, context_window: 65536 },
        status: 'AUTH_REQUIRED',
        auth_note: 'Requiere tu propia OPENROUTER_API_KEY',
      },
      {
        id: 'google/gemini-2.0-flash-exp:free',
        display_name: 'Gemini 2.0 Flash Exp',
        provider: 'free',
        model_type: 'open_weight',
        access_type: 'free_tier',
        weight_source: 'Google',
        note: 'Requiere tu OPENROUTER_API_KEY',
        capabilities: { text: true, vision: true, tool_calling: true, streaming: true, context_window: 1048576 },
        status: 'AUTH_REQUIRED',
        auth_note: 'Requiere tu propia OPENROUTER_API_KEY',
      },
    ],
    local: [
      {
        id: 'llama3.2:3b',
        display_name: 'Llama 3.2 3B (Local)',
        provider: 'ollama',
        model_type: 'open_weight',
        access_type: 'local',
        weight_source: 'Meta',
        size_gb: 2.0,
        capabilities: { text: true, tool_calling: true, streaming: true, context_window: 131072 },
        status: 'UNAVAILABLE',
        installed: false,
        ollama_running: false,
      },
      {
        id: 'qwen2.5-coder:1.5b',
        display_name: 'Qwen 2.5 Coder 1.5B (Local)',
        provider: 'ollama',
        model_type: 'open_weight',
        access_type: 'local',
        weight_source: 'Alibaba',
        size_gb: 1.0,
        capabilities: { text: true, tool_calling: true, coding: true, streaming: true, context_window: 32768 },
        status: 'UNAVAILABLE',
        installed: false,
        ollama_running: false,
      },
      {
        id: 'deepseek-r1:1.5b',
        display_name: 'DeepSeek R1 1.5B (Local)',
        provider: 'ollama',
        model_type: 'open_weight',
        access_type: 'local',
        weight_source: 'DeepSeek',
        size_gb: 1.1,
        capabilities: { text: true, streaming: true, reasoning: true, context_window: 65536 },
        status: 'UNAVAILABLE',
        installed: false,
        ollama_running: false,
      },
    ],
    byok: [
      {
        id: 'gemini-3.8-flash',
        display_name: 'Gemini 3.8 Flash',
        provider: 'google',
        access_type: 'byok',
        capabilities: { text: true, vision: true, tool_calling: true, streaming: true, context_window: 1048576 },
        status: 'AUTH_REQUIRED',
        configured: false,
      },
      {
        id: 'gpt-4o',
        display_name: 'GPT-4o',
        provider: 'openai',
        access_type: 'byok',
        capabilities: { text: true, vision: true, tool_calling: true, streaming: true, context_window: 128000 },
        status: 'AUTH_REQUIRED',
        configured: false,
      },
      {
        id: 'claude-sonnet-5-5',
        display_name: 'Claude Sonnet 5.5',
        provider: 'anthropic',
        access_type: 'byok',
        capabilities: { text: true, vision: true, tool_calling: true, streaming: true, context_window: 200000 },
        status: 'AUTH_REQUIRED',
        configured: false,
      },
    ],
  },
  ollama_status: {
    installed: false,
    running: false,
  },
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

async function sendIpc<T>(type: string, payload?: unknown): Promise<T | null> {
  try {
    const send = window.helix?.sendMessage
    if (!send) return null
    const result = await send(type, payload)
    return result as T
  } catch (err) {
    console.warn(`[modelCatalogService] IPC ${type} failed:`, err)
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getModelCatalog(): Promise<ModelCatalog> {
  const result = await sendIpc<ModelCatalog>('GET_MODEL_CATALOG')
  return result ?? STATIC_CATALOG
}

export async function getOllamaStatus(): Promise<OllamaStatus | null> {
  return sendIpc<OllamaStatus>('GET_OLLAMA_STATUS')
}

export async function pullOllamaModelViaIpc(
  model: string,
  action: 'start' | 'cancel' = 'start'
): Promise<PullResult | null> {
  return sendIpc<PullResult>('PULL_OLLAMA_MODEL', { model, action })
}

export { STATIC_CATALOG }
