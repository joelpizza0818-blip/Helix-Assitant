// Global type declarations for the HELIX preload bridge
// This is injected by electron/preload.ts via contextBridge

/// <reference types="vite/client" />

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
    attachments?: ChatAttachment[]
  }) => void
  cancelTask: (taskId: string) => void
  emergencyStop: () => void
  confirmAction: (requestId: string) => void
  rejectAction: (requestId: string) => void
  quit: () => void
  openToolbox: () => void
  openAgentPanel: () => void
  setFloatingWindowMode: (mode: 'full' | 'suppressed') => Promise<void>
  openExternal: (url: string) => void
  openManagedBrowserTab: (url: string) => Promise<{ session_id: string; url: string }>
  getAppVersion: () => Promise<string>
  createMobilePairing: () => Promise<MobilePairingInvitation>
  getMobileRelayUrl: () => Promise<string>
  setMobileRelayUrl: (url: string) => Promise<string>
  getMobileWorkerUrl: () => Promise<string>
  setMobileWorkerUrl: (url: string) => Promise<string>
  getMobileRelayStatus: () => Promise<MobileRelayStatus>
  getMobileDevices: () => Promise<MobileDevice[]>
  revokeMobileDevice: (deviceId: string) => Promise<void>
  getMobilePairings?: () => Promise<MobilePairingRequest[]>
  resolveMobilePairing?: (requestId: string, approved: boolean) => Promise<void>
  getMobileTextRequests?: () => Promise<MobileTextRequest[]>
  resolveMobileTextRequest?: (requestId: string, approved: boolean) => Promise<void>
  onMobilePairingRequest?: (fn: (request: MobilePairingRequest) => void) => () => void
  onMobileTextRequest?: (fn: (request: MobileTextRequest) => void) => () => void
  onMobileRelayStatus?: (fn: (status: MobileRelayStatus) => void) => () => void

  getSettings: () => Promise<HelixSettings>
  saveSettings: (settings: Partial<HelixSettings>) => Promise<void>
  testTts: (text?: string) => Promise<TtsTestResult>
  getMemoryStatus: () => Promise<MemoryStatus>
  clearMemory: () => Promise<{ cleared: boolean }>
  getUserMemories: () => Promise<UserMemory[]>
  saveUserMemory: (text: string, category: UserMemory['category']) => Promise<UserMemory>
  updateUserMemory: (memoryId: string, text: string, category: UserMemory['category']) => Promise<UserMemory>
  deleteUserMemory: (memoryId: string) => Promise<{ deleted: boolean; memory_id: string }>
  getTasks: () => Promise<TaskDefinition[]>
  getSubagentProfiles: () => Promise<AgentProfile[]>
  getSubagentStatus: () => Promise<AgentLifecycleEvent[]>
  getSubagentRoutingOptions: () => Promise<AgentRoutingOptions>
  createSubagentProfile: (profile: AgentProfileDraft) => Promise<AgentProfile>
  updateSubagentProfile: (profileId: string, profile: AgentProfileDraft) => Promise<AgentProfile>
  setSubagentRoute: (
    profileId: string,
    provider: string | null,
    model: string | null,
    keySlot: number | null,
  ) => Promise<AgentProfile>
  chatWithSubagent: (
    profileId: string,
    message: string,
  ) => Promise<AgentChatResponse>
  getSubagentMemories: (profileId: string) => Promise<UserMemory[]>
  saveSubagentMemory: (
    profileId: string,
    text: string,
    category: UserMemory['category'],
  ) => Promise<UserMemory>
  updateSubagentMemory: (
    profileId: string,
    memoryId: string,
    text: string,
    category: UserMemory['category'],
  ) => Promise<UserMemory>
  deleteSubagentMemory: (
    profileId: string,
    memoryId: string,
  ) => Promise<{ deleted: boolean; memory_id: string }>
  getProviders: () => Promise<ProviderStatus[]>
  getModels: (requirements?: Partial<ModelRequirements>) => Promise<ModelDefinition[]>
  getCapabilities: () => Promise<CapabilitySnapshot>
  refreshCapabilities: () => Promise<CapabilitySnapshot>
  setInstallationProfile: (profile: InstallationProfile) => Promise<CapabilitySnapshot>
  installCapability: (manifest: CapabilityPackManifest) => Promise<CapabilityPackState>
  cancelCapability: (id: string) => Promise<boolean>
  validateKey: (provider: ProviderID, slot: KeySlot, key: string) => Promise<KeyHealth>
  getSkills: () => Promise<SkillSummary[]>
  saveSkill: (skill: SkillDraft) => Promise<SkillSummary>
  deleteSkill: (name: string) => Promise<void>
  getMcpServers: () => Promise<MCPServerStatus[]>

  onAgentMessage: (fn: (msg: AgentMessage) => void) => () => void
  onAgentUpdate: (fn: (event: AgentLifecycleEvent) => void) => () => void
  onVoiceCaptureStarted: (fn: () => void) => () => void
  onVoiceCaptureStopped: (fn: () => void) => () => void
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
  checkForUpdates: () => Promise<{ status: string; version: string }>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdaterStatus: (fn: (status: unknown) => void) => () => void
  onCapabilityDownloadProgress: (fn: (progress: CapabilityDownloadProgress) => void) => () => void
  onOAuthCallback: (fn: (url: string) => void) => () => void
  getAdminStatus: () => Promise<{ configured: boolean; authenticated: boolean }>
  validateAdmin: (accessToken: string) => Promise<{ authenticated: boolean }>
  getAdminConfig: (accessToken: string) => Promise<AdminConfig>
  saveAdminConfig: (accessToken: string, config: AdminConfig) => Promise<AdminConfig>
  createVersionBackup: (accessToken: string, version: string) => Promise<AdminBackup>
  getAdminLogs: (accessToken: string) => Promise<{ success: boolean; logs: string[]; logPath: string; agentLogPath?: string; totalCount: number }>
  clearAdminLogs: (accessToken: string) => Promise<{ success: boolean }>
}

export interface AdminBackup { version: string; createdAt: string; currentVersion: string | null; synced?: boolean; syncError?: string }

export interface AgentProfile {
  profile_id: string
  name: string
  role: AgentRole
  description: string
  capabilities: string[]
  color: string
  instructions: string
  model_route: {
    provider: string
    model: string
    key_slot: number
  } | null
  created_by: string
  created_at: string
}

export type AgentRole = 'planning' | 'coding' | 'automation' | 'research' | 'analysis' | 'general'

export interface AgentProfileDraft {
  name: string
  role: AgentRole
  description: string
  capabilities: string[]
  color: string
  instructions: string
}

export interface AgentRoutingOptions {
  providers: Array<{
    id: string
    name: string
    key_slots: number[]
  }>
  models: Array<{
    id: string
    name: string
    provider: string
  }>
}

export interface AgentChatResponse {
  profile_id: string
  name: string
  color: string
  response: string
}

export interface MobilePairingInvitation {
  version: 1 | 2
  host: string
  sshPort: number
  remoteWsPort: number
  token: string
  expiresAt: string
  relayWssUrl?: string
  requiresDeviceApproval?: boolean
}

export interface MobileDevice {
  device_id: string
  device_name: string
  created_at: number
}

export interface MobilePairingRequest {
  request_id: string
  device_name: string
}

export interface MobileTextRequest {
  request_id: string
  device_id: string
  device_name: string
  text: string
}

export interface MobileRelayStatus {
  configured: boolean
  connected: boolean
}

export type InstallationProfile = 'progressive' | 'complete'
export type CapabilityPackStatus = 'installed' | 'missing' | 'incompatible' | 'error'
export interface CapabilityPackManifest {
  id: string
  version: string
  capability: string
  format: 'python-plugin'
  requiredForComplete: boolean
  platform: 'win32'
  arch: 'x64' | 'arm64'
  coreVersionRange: string
  sizeBytes: number
  url: string
  sha256: string
  signature: string
}
export interface CapabilityPackState extends CapabilityPackManifest {
  status: CapabilityPackStatus
  installedPath?: string
  error?: string
}
export interface CapabilitySnapshot {
  profile: InstallationProfile
  packs: CapabilityPackState[]
  missingCount: number
  requiredMissingCount: number
  ready: boolean
}

export interface CapabilityDownloadProgress {
  id: string
  receivedBytes: number
  totalBytes: number
  status: 'downloading' | 'installed' | 'failed' | 'canceled'
  error?: string
}
export interface AdminConfig {
  autoUpdate: boolean
  checkIntervalHours: number
  channel: 'stable' | 'beta'
  publicVersion: string
  backups: AdminBackup[]
  synced?: boolean
  syncError?: string
}

export interface TtsTestResult {
  ok: boolean
  provider: string
  fallback_used?: boolean
  error?: string
}

export interface MemoryStatus {
  pgvector_ready: boolean
  provider: 'pgvector' | 'local'
  embedding_model: string
  similarity_threshold: number
  dimensions: number | null
  message: string
}

export interface UserMemory {
  id: string
  text: string
  category: 'preference' | 'fact' | 'project' | 'instruction' | 'general'
  importance: number
  created_at: string
  updated_at: string
}

// ── Shared types ──────────────────────────────────────────────────────────────

export type UpdaterStatus =
  | { status: 'checking'; currentVersion: string }
  | { status: 'available'; currentVersion: string; version: string }
  | { status: 'current'; currentVersion: string; version: string }
  | { status: 'downloading'; percent: number; transferred: number; total: number }
  | { status: 'downloaded'; currentVersion: string; version: string }
  | { status: 'error'; message: string }
  | { status: 'unsupported' }

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
  parent_id?: string | null
  role?: string | null
  name?: string | null
  function?: string | null
  task_type?: string
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
  attachments?: ChatAttachment[]
  task_id?: string
}

export interface AgentLifecycleEvent {
  event_type?: string
  agent_id: string
  parent_id?: string | null
  profile_id?: string | null
  name?: string | null
  color?: string | null
  role?: string
  status?: string
  task_id?: string | null
  resource?: string | null
  promotion?: string
  progress?: number
  current_action?: string | null
  created_at?: string
  started_at?: string | null
  completed_at?: string | null
  has_result?: boolean
  failed?: boolean
}

export interface ChatAttachment {
  name: string
  mime_type: string
  size: number
  data_base64: string
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

export interface StdioMCPServerConfig {
  name: string
  command: string
  enabled: boolean
}

export type LegacyMCPServerConfig = {
  name: string
  command?: string
  enabled?: boolean
} & (
  | { url: string; server_url?: string }
  | { url?: string; server_url: string }
)

export type MCPServerConfig = StdioMCPServerConfig | LegacyMCPServerConfig

export interface MCPServerStatus {
  name: string
  command?: string
  enabled: boolean
  status: 'connected' | 'connecting' | 'error' | 'disabled' | 'pending' | 'unsupported'
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
  extensionConnected: boolean
  connectionIssue: 'invalid_token' | 'not_detected' | null
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
  source?: 'camera' | 'microphone'
  provider?: ProviderID
  model?: string
  timestamp: string
  model_requests?: ModelRequestEvent[]
}

export interface HelixSettings {
  voice_enabled: boolean
  activation_phrase_enabled?: boolean
  wake_word: string
  wake_word_provider: 'openwakeword'
  custom_wake_words?: string[]
  wake_word_threshold?: number
  voice_stt_provider?: string
  voice_tts_provider?: string
  voice_tts_voice?: string
  voice_response_enabled?: boolean
  vad_threshold?: number
  mcp_servers?: MCPServerConfig[]
  camera_enabled: boolean
  camera_device_index: number
  gesture_sensitivity: number
  gesture_mappings?: Record<string, { action: string; label: string; customCommand?: string }>
  gesture_window_sequence_enabled?: boolean
  start_with_windows: boolean
  start_minimized?: boolean
  default_model: string | null
  preferred_provider: ProviderID | null
  fallback_enabled: boolean
  cross_provider_fallback: boolean
  model_request_timeout_seconds?: number
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
  screen_context_enabled?: boolean
  model_decides_screen_vision_enabled?: boolean
  continuous_screen_vision_enabled?: boolean
  continuous_screen_vision_interval_ms?: number
  complex_workflows_enabled?: boolean
  subagents_enabled?: boolean
  subagents_available?: boolean
  ocr_engine?: 'local' | 'windows_media_ocr'
  mouse_move_duration_ms?: number
  keystroke_delay_ms?: number
  pyautogui_fail_safe?: boolean
  shell_type?: 'powershell' | 'cmd' | 'wsl'
  shell_timeout_seconds?: number
  block_elevated_execution?: boolean
  sandbox_enabled?: boolean
  sandbox_mode?: 'restricted' | 'isolated' | 'windows_sandbox' | 'docker'
  sound_effects_enabled?: boolean
  browser_control_mode?: 'extension' | 'playwright'
  browser_engine?: 'chromium' | 'firefox' | 'webkit'
  browser_headless?: boolean
  search_provider?: 'google' | 'duckduckgo' | 'bing'
  research_depth?: number
  block_downloads?: boolean
  block_untrusted_domains?: boolean
  always_on_top?: boolean
  floating_ui_mode?: 'full' | 'suppressed'
  global_summon_shortcut?: string
  emergency_stop_shortcut?: string
  custom_models?: ModelDefinition[]
  custom_endpoints?: Array<{ id: string; name: string; baseUrl: string; apiKey?: string; enabled: boolean }>
  hand_commands?: HandCommand[]
  application_memory?: Record<string, unknown>
  memory_context_limit?: number
  memory_compact_threshold?: number
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
