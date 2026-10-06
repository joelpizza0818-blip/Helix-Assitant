// Global type declarations for the HELIX preload bridge
// This is injected by electron/preload.ts via contextBridge

export {}

declare global {
  interface Window {
    helix: HelixAPI
  }
}

export interface HelixAPI {
  sendMessage: (text: string) => void
  cancelTask: (taskId: string) => void
  confirmAction: (requestId: string) => void
  rejectAction: (requestId: string) => void
  openToolbox: () => void
  openExternal: (url: string) => void

  getSettings: () => Promise<HelixSettings>
  saveSettings: (settings: Partial<HelixSettings>) => Promise<void>
  getTasks: () => Promise<TaskDefinition[]>
  getProviders: () => Promise<ProviderStatus[]>
  getModels: (requirements?: Partial<ModelRequirements>) => Promise<ModelDefinition[]>
  validateKey: (provider: ProviderID, slot: KeySlot, key: string) => Promise<KeyHealth>

  onAgentMessage: (fn: (msg: AgentMessage) => void) => () => void
  onTaskUpdate: (fn: (task: TaskDefinition) => void) => () => void
  onStatusUpdate: (fn: (status: AgentStatusUpdate) => void) => () => void
  onFallbackEvent: (fn: (event: FallbackEvent) => void) => () => void
  onConfirmationRequest: (fn: (req: ConfirmationRequest) => void) => () => void
  onError: (fn: (err: AgentError) => void) => () => void
  onProviderUpdate: (fn: (providers: ProviderStatus[]) => void) => () => void
  onShowTasks: (fn: () => void) => () => void
}

// ── Shared types ──────────────────────────────────────────────────────────────

export type ProviderID = 'openai' | 'anthropic' | 'google'
export type KeySlot = 1 | 2 | 3
export type KeyHealth = 'healthy' | 'rate_limited' | 'quota_exceeded' | 'auth_error' | 'unavailable' | 'unconfigured'
export type AgentStatus = 'idle' | 'busy' | 'listening' | 'executing' | 'waiting_confirmation' | 'error'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled' | 'retrying'
export type PermissionLevel = 'READ_ONLY' | 'LOW_RISK' | 'MODIFY' | 'EXECUTE' | 'SYSTEM' | 'CRITICAL'

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  audio: boolean
  realtime: boolean
  tool_calling: boolean
  structured_output: boolean
  computer_use: boolean
  browser_use: boolean
  coding: boolean
  reasoning: boolean
  streaming: boolean
  speech_to_text: boolean
  text_to_speech: boolean
  low_latency: boolean
  long_context: boolean
  context_window: number
  cost_tier: 'low' | 'medium' | 'high' | 'premium'
}

export interface ModelDefinition {
  id: string
  provider: ProviderID
  display_name: string
  capabilities: ModelCapabilities
  priority: number
  enabled: boolean
  fallback_group: string
}

export interface ModelRequirements {
  text?: boolean
  vision?: boolean
  audio?: boolean
  computer_use?: boolean
  tool_calling?: boolean
  streaming?: boolean
  coding?: boolean
  reasoning?: boolean
  low_latency?: boolean
}

export interface ProviderStatus {
  id: ProviderID
  name: string
  configured: boolean
  keys: Array<{
    slot: KeySlot
    health: KeyHealth
    configured: boolean
  }>
  models_available: number
}

export interface TaskDefinition {
  id: string
  description: string
  status: TaskStatus
  priority: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  current_action: string | null
  logs: TaskLog[]
  cancelled: boolean
  model: string | null
  provider: ProviderID | null
  required_permissions: PermissionLevel[]
  error: string | null
}

export interface TaskLog {
  timestamp: string
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  message: string
  action: string | null
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  model?: string
  provider?: ProviderID
  tool_name?: string
  streaming?: boolean
}

export interface AgentStatusUpdate {
  status: AgentStatus
  model: string | null
  provider: ProviderID | null
  task_count: number
}

export interface FallbackEvent {
  from_model: string
  to_model: string
  from_provider: ProviderID
  to_provider: ProviderID
  reason: string
  timestamp: string
}

export interface ConfirmationRequest {
  id: string
  action: string
  what_will_change: string
  why: string
  level: PermissionLevel
  created_at: string
}

export interface AgentError {
  code: string
  message: string
  provider?: ProviderID
  model?: string
  timestamp: string
}

export interface HelixSettings {
  voice_enabled: boolean
  wake_word: string
  wake_word_provider: 'openwakeword' | 'porcupine'
  camera_enabled: boolean
  camera_device_index: number
  gesture_sensitivity: number
  start_with_windows: boolean
  default_model: string | null
  preferred_provider: ProviderID | null
  fallback_enabled: boolean
  cross_provider_fallback: boolean
  cost_preference: 'low' | 'balanced' | 'high'
  speed_preference: 'low' | 'balanced' | 'high'
  quality_preference: 'low' | 'balanced' | 'high'
  log_level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  protected_paths: string[]
  protected_apps: string[]
  agent_ws_port: number
}
