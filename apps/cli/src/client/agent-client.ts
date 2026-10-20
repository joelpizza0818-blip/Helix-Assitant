mport WebSocket from 'ws';
import { EventEmitter } from 'events';
import type {
  AgentMessage,
  ConfirmationRequest,
  HelixSettings,
  McpServerConfig,
  ModelSummary,
  ProviderSummary,
  SkillSummary,
  TaskSummary,
  UserTextMessagePayload,
} from './types';

type ResponseResolver = (data: unknown, error?: string) => void;

export interface AgentClientOptions {
  wsUrl?: string;
  wsToken?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
}

export class AgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private wsToken?: string;
  private autoReconnect: boolean;
  private reconnectIntervalMs: number;
  private reconnecting: boolean = false;
  private isExplicitlyClosed: boolean = false;
  private pendingRequests: Map<string, ResponseResolver> = new Map();
  private requestTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private isConnected: boolean = false;

  constructor(options: AgentClientOptions = {}) {
    super();
    const { getOrGenerateWsToken } = require('./agent-launcher');
    this.wsUrl = options.wsUrl || 'ws://127.0.0.1:8765';
    this.wsToken = options.wsToken || getOrGenerateWsToken();
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 3000;
  }

  public get connected(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public get url(): string {
    return this.wsUrl;
  }

  private failedAttempts: number = 0;
  private autoSpawnAttempted: boolean = false;
  private _isAgentStarting: boolean = false;

  public get isStarting(): boolean {
    return this._isAgentStarting;
  }

  public connect(): Promise<void> {
    this.isExplicitlyClosed = false;
    return new Promise((resolve, reject) => {
      let settled = false;

      try {
        const headers: Record<string, string> = {};
        if (this.wsToken) {
          headers['Authorization'] = `Bearer ${this.wsToken}`;
        }

        const ws = new WebSocket(this.wsUrl, { headers });
        this.ws = ws;

        ws.on('open', () => {
          this.isConnected = true;
          this.reconnecting = false;
          settled = true;
          this.emit('connected', this.wsUrl);
          resolve();
        });

        ws.on('message', (data: WebSocket.Data) => {
          try {
            const raw = data.toString();
            const message = JSON.parse(raw) as AgentMessage;
            this._handleMessage(message);
          } catch (err) {
            this.emit('parse_error', err);
          }
        });

        ws.on('error', (err: Error) => {
          this.emit('client_error', err);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        ws.on('close', (code: number, reason: Buffer) => {
          this.isConnected = false;
          if (this.ws === ws) {
            this.ws = null;
          }
          if (!this._isAgentStarting) {
            this.emit('disconnected', { code, reason: reason.toString() });
          }

          if (!this.isExplicitlyClosed && this.autoReconnect && !this._isAgentStarting) {
            this._scheduleReconnect();
          }

          if (!settled) {
            settled = true;
            reject(new Error(`WebSocket closed prematurely (${code}): ${reason.toString()}`));
          }
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  private _scheduleReconnect(): void {
    if (this.reconnecting || this.isExplicitlyClosed || this._isAgentStarting) return;
    this.reconnecting = true;
    this.failedAttempts++;

    // If 3 consecutive failures occur, try to auto-launch the local Python agent
    if (this.failedAttempts >= 3 && !this.autoSpawnAttempted) {
      this.autoSpawnAttempted = true;
      this._isAgentStarting = true;
      this.emit('auto_spawning_agent');

      (async () => {
        try {
          const { spawnAgentDaemon, waitForAgentReady, getOrGenerateWsToken } = require('./agent-launcher');
          const token = getOrGenerateWsToken();
          if (!this.wsToken) {
            this.wsToken = token;
          }

          const spawnResult = await spawnAgentDaemon();
          if (!spawnResult.success) {
            this._isAgentStarting = false;
            this.reconnecting = false;
            this.emit('agent_start_failed', { error: spawnResult.error });
            return;
          }

          // Lock retries: poll quietly until background service finishes starting up AND auth succeeds
          const ready = await waitForAgentReady(
            8765,
            this.wsToken,
            45000,
            1000,
            (elapsedSec: number) => {
              this.emit('agent_starting_progress', { elapsedSec });
            }
          );

          this._isAgentStarting = false;

          if (ready) {
            this.failedAttempts = 0;
            this.autoSpawnAttempted = false;
            this.reconnecting = false;
            this.emit('agent_ready');
            try {
              await this.connect();
            } catch {
              this._scheduleReconnect();
            }
          } else {
            this.reconnecting = false;
            this.emit('agent_start_failed', {
              error: 'El servicio del agente no respondiÃ³ en el puerto 8765 dentro de 45s.',
            });
            if (!this.isExplicitlyClosed && this.autoReconnect) {
              this._scheduleReconnect();
            }
          }
        } catch (e) {
          this._isAgentStarting = false;
          this.reconnecting = false;
          this.emit('agent_start_failed', { error: (e as Error).message });
          if (!this.isExplicitlyClosed && this.autoReconnect) {
            this._scheduleReconnect();
          }
        }
      })();

      return;
    }

    this.emit('reconnecting', {
      intervalMs: this.reconnectIntervalMs,
      attempt: this.failedAttempts,
    });

    setTimeout(async () => {
      if (this.isExplicitlyClosed || this._isAgentStarting) {
        this.reconnecting = false;
        return;
      }
      try {
        await this.connect();
        this.failedAttempts = 0;
        this.autoSpawnAttempted = false;
        this.reconnecting = false;
      } catch {
        this.reconnecting = false;
        this._scheduleReconnect();
      }
    }, this.reconnectIntervalMs);
  }

  private _handleMessage(message: AgentMessage): void {
    // 1. Check if it's a response to a pending request
    if (message.request_id && this.pendingRequests.has(message.request_id)) {
      const resolver = this.pendingRequests.get(message.request_id)!;
      const timeout = this.requestTimeouts.get(message.request_id);
      if (timeout) clearTimeout(timeout);
      this.requestTimeouts.delete(message.request_id);
      this.pendingRequests.delete(message.request_id);
      resolver(message.payload, message.error);
      return;
    }

    // 2. Emit corresponding typed events (dispatch once per type)
    const type = message.type || 'unknown';
    this.emit('message', message);
    this.emit(type, message.payload);
  }

  public request<T = unknown>(type: string, payload: unknown = {}, timeoutMs: number = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Agent WebSocket is not connected'));
        return;
      }

      const requestId = `cli_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const message: AgentMessage = {
        type,
        payload,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.requestTimeouts.delete(requestId);
        reject(new Error(`Agent request timeout after ${timeoutMs}ms for ${type}`));
      }, timeoutMs);

      this.requestTimeouts.set(requestId, timeout);
      this.pendingRequests.set(requestId, (data: unknown, error?: string) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data as T);
        }
      });

      this.ws?.send(JSON.stringify(message));
    });
  }

  public send(type: string, payload: unknown = {}): boolean {
    if (!this.connected) return false;
    const message: AgentMessage = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    try {
      this.ws?.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  // --- High level client operations ---

  public sendUserText(
    text: string,
    conversationId: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    attachments?: Array<{ name: string; mime_type: string; size?: number; data_base64: string }>,
  ): boolean {
    const payload: UserTextMessagePayload = {
      text,
      conversation_id: conversationId,
      conversation_history: history,
      attachments,
    };
    return this.send('USER_TEXT', payload);
  }

  public async getTasks(): Promise<TaskSummary[]> {
    return this.request<TaskSummary[]>('GET_TASKS', {});
  }

  public async getProviders(): Promise<ProviderSummary[]> {
    return this.request<ProviderSummary[]>('GET_PROVIDERS', {});
  }

  public async getModels(requirements: Record<string, unknown> = {}): Promise<ModelSummary[]> {
    return this.request<ModelSummary[]>('GET_MODELS', { requirements });
  }

  public async getSettings(): Promise<HelixSettings> {
    return this.request<HelixSettings>('GET_SETTINGS', {});
  }

  public async saveSettings(settings: Partial<HelixSettings>): Promise<HelixSettings> {
    return this.request<HelixSettings>('SAVE_SETTINGS', { settings });
  }

  public async validateKey(provider: string, slot: number, key: string): Promise<string> {
    return this.request<string>('VALIDATE_KEY', { provider, slot, key });
  }

  public async getSkills(): Promise<SkillSummary[]> {
    return this.request<SkillSummary[]>('GET_SKILLS', {});
  }

  public async saveSkill(skill: Record<string, unknown>): Promise<SkillSummary> {
    return this.request<SkillSummary>('SAVE_SKILL', { skill });
  }

  public async deleteSkill(name: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>('DELETE_SKILL', { name });
  }

  public async getMcpServers(): Promise<McpServerConfig[]> {
    return this.request<McpServerConfig[]>('GET_MCP_SERVERS', {});
  }

  public async getMemoryStatus(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET_MEMORY_STATUS', {});
  }

  public async clearMemory(): Promise<void> {
    return this.request<void>('CLEAR_MEMORY', {});
  }

  public cancelTask(taskId: string): void {
    this.send('TASK_CANCEL', { task_id: taskId });
  }

  public emergencyStop(): void {
    this.send('TASK_CANCEL_ALL', {});
  }

  public confirmAction(requestId: string): void {
    this.send('CONFIRMATION_GRANTED', { request_id: requestId });
  }

  public rejectAction(requestId: string): void {
    this.send('CONFIRMATION_REJECTED', { request_id: requestId });
  }

  public close(): void {
    this.isExplicitlyClosed = true;
    for (const timeout of this.requestTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.requestTimeouts.clear();
    for (const resolver of this.pendingRequests.values()) {
      resolver(undefined, 'Client disconnected');
    }
    this.pendingRequests.clear();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
