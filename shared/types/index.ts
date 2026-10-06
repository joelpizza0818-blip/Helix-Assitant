export type ProviderID = 'openai' | 'anthropic' | 'google';

export type KeySlot = 1 | 2 | 3;

export type KeyHealth = 
  | 'healthy' 
  | 'rate_limited' 
  | 'quota_exceeded' 
  | 'auth_error' 
  | 'unavailable' 
  | 'unconfigured';

export type ModelHealth = 
  | 'available' 
  | 'unavailable' 
  | 'unsupported_for_task';

export enum AgentErrorCode {
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  TEMPORARY_PROVIDER_ERROR = 'TEMPORARY_PROVIDER_ERROR',
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  INVALID_REQUEST = 'INVALID_REQUEST',
  CONTENT_POLICY = 'CONTENT_POLICY',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN'
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  realtime: boolean;
  tool_calling: boolean;
  function_calling: boolean;
  structured_output: boolean;
  computer_use: boolean;
  browser_use: boolean;
  coding: boolean;
  reasoning: boolean;
  streaming: boolean;
  speech_to_text: boolean;
  text_to_speech: boolean;
  low_latency: boolean;
  long_context: boolean;
  context_window: number;
  cost_tier: number;
}

export interface ModelDefinition {
  id: string;
  provider: ProviderID;
  display_name: string;
  capabilities: ModelCapabilities;
  priority: number;
  enabled: boolean;
  fallback_group?: string;
}

export interface ProviderDefinition {
  id: ProviderID;
  name: string;
  enabled: boolean;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskDefinition {
  id: string;
  title: string;
  status: TaskStatus;
  progress: number;
  created_at: number;
}

export type PermissionLevel = 'allow' | 'deny' | 'prompt';

export interface PermissionRequest {
  id: string;
  tool_name: string;
  reason: string;
  level: PermissionLevel;
}

export type GestureEvent = 
  | 'GESTURE_CONFIRM' 
  | 'GESTURE_REJECT' 
  | 'GESTURE_SEARCH' 
  | 'GESTURE_STOP' 
  | 'GESTURE_CLOSE' 
  | 'GESTURE_OPEN';

export type AgentEvent = string;

export interface AgentMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export interface HelixSettings {
  voiceEnabled: boolean;
  startWithWindows: boolean;
  agentWsPort: number;
  logLevel: string;
  cameraEnabled: boolean;
}

export interface ConfirmationRequest {
  id: string;
  prompt: string;
}

export interface FallbackEvent {
  provider: ProviderID;
  fromKeySlot: KeySlot;
  toKeySlot: KeySlot;
  reason: string;
}

export interface ProviderStatus {
  id: ProviderID;
  health: KeyHealth;
}

export type AgentStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
