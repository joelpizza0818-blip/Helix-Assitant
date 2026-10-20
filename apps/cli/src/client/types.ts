xport interface AgentMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp?: string;
  request_id?: string;
  error?: string;
}

export interface UserTextMessagePayload {
  text: string;
  conversation_id: string;
  conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: Array<{
    name: string;
    mime_type: string;
    size?: number;
    data_base64: string;
  }>;
}

export interface SkillSummary {
  name: string;
  description: string;
  triggers?: string[];
  instructions?: string;
  custom?: boolean;
}

export interface McpToolSummary {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  status?: 'connected' | 'idle' | 'connecting' | 'error';
  error?: string;
  tools?: McpToolSummary[];
}

export interface ProviderKeySlot {
  slot: number;
  health: 'healthy' | 'degraded' | 'cooldown' | 'unconfigured' | 'error';
  configured: boolean;
  masked?: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  configured: boolean;
  keys: ProviderKeySlot[];
  models_available: number;
}

export interface ModelSummary {
  id: string;
  name?: string;
  provider: string;
  capabilities?: Record<string, boolean>;
}

export interface TaskSummary {
  task_id: string;
  prompt?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  created_at?: string;
  result?: string;
  error?: string;
}

export interface HelixSettings {
  voice_enabled?: boolean;
  wake_word?: string;
  mcp_servers?: McpServerConfig[];
  default_model?: string | null;
  preferred_provider?: string | null;
  log_level?: string;
  agent_ws_port?: number;
  [key: string]: unknown;
}

export interface ConfirmationRequest {
  id?: string;
  request_id?: string;
  action?: string;
  description?: string;
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH';
  tool?: string;
  arguments?: Record<string, unknown>;
}
