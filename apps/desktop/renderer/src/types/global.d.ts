// Global type declarations for the HELIX preload bridge
// This is injected by electron/preload.ts via contextBridge

export {}

declare global {
  interface Window {
    helix: HelixAPI
  }
}

export interface HelixAPI {
  sendMessage: (payload: {
    text: string
    conversation_id: string
    conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>
  }) => void
  cancelTask: (taskId: string) => void
  emergencyStop: () => void
  confirmAction: (requestId: string) => void
  rejectAction: (requestId: string) => void
  quit: () => void
  openToolbox: () => void
  openExternal: (url: string) => void

  getSettings: () => Promise<HelixSettings>
  saveSettings: (settings: Partial<HelixSettings>) => Promise<void>
  getTasks: () => Promise<TaskDefinition[]>
  getProviders: () => Promise<ProviderStatus[]>
  getModels: (requirements?: Partial<ModelRequirements>) => Promise<ModelDefinition[]>
  validateKey: (provider: ProviderID, slot: KeySlot, key: string) => Promise<KeyHealth>
  getSkills: () => Promise<SkillSummary[]>
  saveSkill: (skill: SkillDraft) => Promise<SkillSummary>
  deleteSkill: (name: string) => Promise<void>
  getMcpServers: () => Promise<MCPServerStatus[]>

  onAgentMessage: (fn: (msg: AgentMessage) => void) => () => void
  onTaskUpdate: (fn: (task: TaskDefinition) => void) => () => void
  onStatusUpdate: (fn: (status: AgentStatusUpdate) => void) => () => void
  onFallbackEvent: (fn: (event: FallbackEvent) => void) => () => void
  onModelRequest: (fn: (request: ModelRequestEvent) => void) => () => void
  onConfirmationRequest: (fn: (req: ConfirmationRequest) => void) => () => void
  onConfirmationResolved: (fn: (request: { request_id: string }) => void) => () => void
  onError: (fn: (err: AgentError) => void) => () => void
  onProviderUpdate: (fn: (providers: ProviderStatus[]) => void) => () => void
  onHandLandmarks: (fn: (landmarks: HandLandmarkEvent) => void) => () => void
  onSettingsApplied: (fn: (settings: HelixSettings) => void) => () => void
  onShowTasks: (fn: () => void) => () => void
  dismissConfirmationToast: (requestId: string) => void
  getBrowserExtensionInfo: () => Promise<BrowserExtensionInfo>
  openBrowserExtensionFolder: () => Promise<void>
  copyTextToClipboard: (text: string) => Promise<void>
  getClipboardHistory: () => Promise<ClipboardHistoryItem[]>
  getClipboardMonitoring: () => Promise<boolean>
  setClipboardMonitoring: (enabled: boolean) => Promise<void>
  clearClipboardHistory: () => Promise<void>
  restoreClipboardItem: (id: string) => Promise<void>
  onClipboardHistoryChanged: (fn: (items: ClipboardHistoryItem[]) => void) => () => void
  onClipboardMonitoringChanged: (fn: (enabled: boolean) => void) => () => void
}

// ── Shared types ──────────────────────────────────────────────────────────────

export type ProviderID = 'openai' | 'anthropic' | 'google' | 'custom' | string
// API key pools are expandable; the first three slots are always shown.
export type KeySlot = number
export type KeyHealth = 'healthy' | 'rate_limited' | 'quota_exceeded' | 'billing_exhausted' | 'auth_error' | 'unavailable' | 'unconfigured'
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
  model_requests?: ModelRequestEvent[]
  progress: number
  execution_summary: TaskExecutionSummary
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

export interface SkillDraft {
  name: string
  description: string
  triggers: string[]
  tools: string[]
  instructions: string
}

export interface SkillSummary extends SkillDraft {
  version: string
  custom: boolean
}

export interface MCPServerConfig {
  name: string
  command: string
  enabled: boolean
}

export interface MCPServerStatus extends MCPServerConfig {
  status: 'connected' | 'connecting' | 'error' | 'disabled' | 'pending'
  tool_count: number
  error: string | null
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

export interface BrowserExtensionInfo {
  token: string
  port: number
  extensionPath: string
  listening: boolean
  lastPage: { title: string; url: string; captured_at: string } | null
  error: string | null
}

export interface ClipboardHistoryItem {
  id: string
  kind: 'text' | 'image'
  timestamp: string
  text?: string
  dataUrl?: string
}

export interface ModelRequestEvent {
  task_id: string
  request_id: string
  timestamp: string
  attempt: number
  provider: ProviderID
  model: string
  key_slot: number
  status: 'attempting' | 'succeeded' | 'failed'
  input_summary: ModelInputSummary
  error?: { code: string; message: string }
}

export interface ModelInputSummary {
  message_count: number
  roles: string[]
  character_count: number
  image_count: number
  context_labels: string[]
}

export interface TaskExecutionStep {
  id: string
  label: string
  detail: string
  status: 'running' | 'completed' | 'failed'
}

export interface TaskToolCallSummary {
  tool: string
  status: 'succeeded' | 'failed'
  result_summary: string
}

export interface TaskResultSummary {
  status: string
  summary: string
}

export interface TaskExecutionSummary {
  model_input: ModelInputSummary
  context: { labels: string[]; item_count: number }
  steps: TaskExecutionStep[]
  tool_calls: TaskToolCallSummary[]
  progress_label: string
  result: TaskResultSummary | null
}

export interface AgentError {
  code: string
  message: string
  provider?: ProviderID
  model?: string
  timestamp: string
  model_requests?: ModelRequestEvent[]
}

export interface HelixSettings {
  voice_enabled: boolean
  wake_word: string
  wake_word_provider: 'openwakeword'
  custom_wake_words?: string[]
  wake_word_threshold?: number
  voice_stt_provider?: string
  voice_tts_provider?: string
  voice_tts_voice?: string
  vad_threshold?: number
  mcp_servers?: MCPServerConfig[]
  camera_enabled: boolean
  camera_device_index: number
  gesture_sensitivity: number
  gesture_mappings?: Record<string, { action: string; label: string; customCommand?: string }>
  start_with_windows: boolean
  start_minimized?: boolean
  default_model: string | null
  preferred_provider: ProviderID | null
  fallback_enabled: boolean
  cross_provider_fallback: boolean
  auto_approve_up_to: 'READ_ONLY' | 'LOW_RISK' | 'MODIFY'
  permissions_mode?: 'ALWAYS_ASK' | 'AUTO_APPROVE' | 'SMART_APPROVAL'
  cost_preference: 'low' | 'balanced' | 'high'
  speed_preference: 'low' | 'balanced' | 'high'
  quality_preference: 'low' | 'balanced' | 'high'
  log_level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  protected_paths: string[]
  protected_apps: string[]
  agent_ws_port: number
  display_index?: number
  screen_capture_interval_ms?: number
  ocr_engine?: 'local' | 'windows_media_ocr'
  mouse_move_duration_ms?: number
  keystroke_delay_ms?: number
  pyautogui_fail_safe?: boolean
  shell_type?: 'powershell' | 'cmd' | 'wsl'
  shell_timeout_seconds?: number
  block_elevated_execution?: boolean
  browser_engine?: 'chromium' | 'firefox' | 'webkit'
  browser_headless?: boolean
  search_provider?: 'google' | 'duckduckgo' | 'bing'
  research_depth?: number
  block_downloads?: boolean
  block_untrusted_domains?: boolean
  always_on_top?: boolean
  global_summon_shortcut?: string
  emergency_stop_shortcut?: string
  custom_models?: ModelDefinition[]
  custom_endpoints?: Array<{ id: string; name: string; baseUrl: string; apiKey?: string; enabled: boolean }>
  hand_commands?: HandCommand[]
  application_memory?: Record<string, unknown>
  memory_context_limit?: number
  memory_auto_compaction?: boolean
  embedding_model?: string
  memory_similarity_threshold?: number
}

export interface HandCommand {
  id: string
  name: string
  action: string
  customCommand?: string
  samples: Array<{ landmarks: number[][]; capturedAt: string }>
  enabled: boolean
}

export interface HandLandmarkEvent {
  camera_index: number
  timestamp: number
  preview_frame?: string
  hands: Array<{
    points: number[][]
    gesture: string | null
    confidence: number
  }>
}
