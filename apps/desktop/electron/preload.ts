import { contextBridge, ipcRenderer } from 'electron'

// Type-safe event listener cleanup
function createEventListener<T>(channel: string, fn: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => fn(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Expose HELIX API to renderer via contextBridge
// NEVER expose raw ipcRenderer — only specific allowed methods
contextBridge.exposeInMainWorld('helix', {
  // Send text command to agent
  sendMessage: (payload: {
    text: string
    conversation_id: string
    conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>
    attachments?: Array<{ name: string; mime_type: string; size: number; data_base64: string }>
  }): void => {
    ipcRenderer.send('helix:send-message', payload)
  },

  // Cancel a running background task
  cancelTask: (taskId: string): void => {
    ipcRenderer.send('helix:cancel-task', taskId)
  },

  emergencyStop: (): void => {
    ipcRenderer.send('helix:emergency-stop')
  },

  dismissConfirmationToast: (requestId: string): void => {
    ipcRenderer.send('helix:dismiss-confirmation-toast', requestId)
  },

  // Confirm a pending action
  confirmAction: (requestId: string): void => {
    ipcRenderer.send('helix:confirm-action', requestId)
  },

  // Reject a pending action
  rejectAction: (requestId: string): void => {
    ipcRenderer.send('helix:reject-action', requestId)
  },

  quit: (): void => {
    ipcRenderer.send('helix:quit')
  },

  // Open the Toolbox window
  openToolbox: (): void => {
    ipcRenderer.send('helix:open-toolbox')
  },

  openAgentPanel: (): void => {
    ipcRenderer.send('helix:open-agent-panel')
  },

  setFloatingWindowMode: (mode: 'full' | 'suppressed'): Promise<void> =>
    ipcRenderer.invoke('helix:set-floating-window-mode', mode),

  // Open external URL in default browser
  openExternal: (url: string): void => {
    ipcRenderer.send('helix:open-external', url)
  },
  openManagedBrowserTab: (url: string): Promise<void> =>
    ipcRenderer.invoke('helix:open-managed-browser-tab', url),

  // Request/response operations
  getSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-settings'),

  saveSettings: (settings: object): Promise<void> =>
    ipcRenderer.invoke('helix:save-settings', settings),

  testTts: (text?: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:test-tts', text),

  getMemoryStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-memory-status'),
  clearMemory: (): Promise<{ cleared: boolean }> =>
    ipcRenderer.invoke('helix:clear-memory'),
  getUserMemories: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-user-memories'),
  saveUserMemory: (text: string, category: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:save-user-memory', text, category),
  updateUserMemory: (memoryId: string, text: string, category: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:update-user-memory', memoryId, text, category),
  deleteUserMemory: (memoryId: string): Promise<{ deleted: boolean; memory_id: string }> =>
    ipcRenderer.invoke('helix:delete-user-memory', memoryId),

  getTasks: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-tasks'),

  getSubagentProfiles: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-subagent-profiles'),

  getSubagentStatus: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-subagent-status'),

  getSubagentRoutingOptions: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-subagent-routing-options'),

  setSubagentRoute: (
    profileId: string,
    provider: string | null,
    model: string | null,
    keySlot: number | null,
  ): Promise<unknown> =>
    ipcRenderer.invoke('helix:set-subagent-route', {
      profile_id: profileId,
      provider,
      model,
      key_slot: keySlot,
    }),

  createSubagentProfile: (profile: {
    name: string
    role: string
    description: string
    capabilities: string[]
    color: string
    instructions: string
  }): Promise<unknown> =>
    ipcRenderer.invoke('helix:create-subagent-profile', profile),

  updateSubagentProfile: (
    profileId: string,
    profile: {
      name: string
      role: string
      description: string
      capabilities: string[]
      color: string
      instructions: string
    },
  ): Promise<unknown> =>
    ipcRenderer.invoke('helix:update-subagent-profile', {
      ...profile,
      profile_id: profileId,
    }),

  chatWithSubagent: (profileId: string, message: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:chat-subagent', profileId, message),

  getSubagentMemories: (profileId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-subagent-memories', profileId),

  saveSubagentMemory: (
    profileId: string,
    text: string,
    category: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke('helix:save-subagent-memory', profileId, text, category),

  updateSubagentMemory: (
    profileId: string,
    memoryId: string,
    text: string,
    category: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke('helix:update-subagent-memory', profileId, memoryId, text, category),

  deleteSubagentMemory: (profileId: string, memoryId: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:delete-subagent-memory', profileId, memoryId),

  getProviders: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-providers'),

  getModels: (requirements?: object): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-models', requirements),

  getCapabilities: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-capabilities'),

  refreshCapabilities: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:refresh-capabilities'),

  setInstallationProfile: (profile: 'progressive' | 'complete'): Promise<unknown> =>
    ipcRenderer.invoke('helix:set-installation-profile', profile),

  installCapability: (manifest: object): Promise<unknown> =>
    ipcRenderer.invoke('helix:install-capability', manifest),

  cancelCapability: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('helix:cancel-capability', id),

  // Validate an API key — key goes directly to Python, never logged here
  validateKey: (provider: string, slot: number, key: string): Promise<string> =>
    ipcRenderer.invoke('helix:validate-key', provider, slot, key),

  getSkills: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-skills'),

  saveSkill: (skill: object): Promise<unknown> =>
    ipcRenderer.invoke('helix:save-skill', skill),

  deleteSkill: (name: string): Promise<void> =>
    ipcRenderer.invoke('helix:delete-skill', name),

  getMcpServers: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-mcp-servers'),

  getBrowserExtensionInfo: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-browser-extension-info'),

  openBrowserExtensionFolder: (): Promise<void> =>
    ipcRenderer.invoke('helix:open-browser-extension-folder'),

  copyTextToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('helix:copy-text-to-clipboard', text),

  getClipboardHistory: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-clipboard-history'),

  getClipboardMonitoring: (): Promise<boolean> =>
    ipcRenderer.invoke('helix:get-clipboard-monitoring'),

  setClipboardMonitoring: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('helix:set-clipboard-monitoring', enabled),

  clearClipboardHistory: (): Promise<void> =>
    ipcRenderer.invoke('helix:clear-clipboard-history'),

  restoreClipboardItem: (id: string): Promise<void> =>
    ipcRenderer.invoke('helix:restore-clipboard-item', id),

  checkForUpdates: (): Promise<{ status: string; version: string }> =>
    ipcRenderer.invoke('helix:updater-check'),

  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke('helix:updater-download'),

  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('helix:updater-install'),

  // Event subscriptions (return cleanup function)
  onAgentMessage: (fn: (msg: unknown) => void): (() => void) =>
    createEventListener('helix:agent-message', fn),

  onAgentUpdate: (fn: (event: unknown) => void): (() => void) =>
    createEventListener('helix:agent_update', fn),

  onVoiceCaptureStarted: (fn: () => void): (() => void) =>
    createEventListener('helix:voice_capture_started', fn),

  onVoiceCaptureStopped: (fn: () => void): (() => void) =>
    createEventListener('helix:voice_capture_stopped', fn),

  onTaskUpdate: (fn: (task: unknown) => void): (() => void) =>
    createEventListener('helix:task-update', fn),

  onStatusUpdate: (fn: (status: unknown) => void): (() => void) =>
    createEventListener('helix:status-update', fn),

  onFallbackEvent: (fn: (event: unknown) => void): (() => void) =>
    createEventListener('helix:fallback-event', fn),

  onModelRequest: (fn: (request: unknown) => void): (() => void) =>
    createEventListener('helix:model_request', fn),

  onConfirmationRequest: (fn: (req: unknown) => void): (() => void) =>
    createEventListener('helix:confirmation-request', fn),

  onConfirmationResolved: (fn: (request: { request_id: string }) => void): (() => void) =>
    createEventListener('helix:confirmation-resolved', fn),

  onError: (fn: (err: unknown) => void): (() => void) =>
    createEventListener('helix:error', fn),

  onProviderUpdate: (fn: (providers: unknown) => void): (() => void) =>
    createEventListener('helix:provider-update', fn),

  onHandLandmarks: (fn: (landmarks: unknown) => void): (() => void) =>
    createEventListener('helix:hand-landmarks', fn),

  onSettingsApplied: (fn: (settings: unknown) => void): (() => void) =>
    createEventListener('helix:settings-applied', fn),

  onShowTasks: (fn: () => void): (() => void) =>
    createEventListener('helix:show-tasks', fn),

  onClipboardHistoryChanged: (fn: (items: unknown[]) => void): (() => void) =>
    createEventListener('helix:clipboard-history-changed', fn),

  onClipboardMonitoringChanged: (fn: (enabled: boolean) => void): (() => void) =>
    createEventListener('helix:clipboard-monitoring-changed', fn),

  onUpdaterStatus: (fn: (status: unknown) => void): (() => void) =>
    createEventListener('helix:updater-status', fn),
  onCapabilityDownloadProgress: (fn: (progress: unknown) => void): (() => void) =>
    createEventListener('helix:capability-download-progress', fn),
  onOAuthCallback: (fn: (url: string) => void): (() => void) =>
    createEventListener('helix:oauth-callback', fn),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('helix:app-version'),
  createMobilePairing: (): Promise<{
    version: 1 | 2
    host: string
    sshPort: number
    remoteWsPort: number
    token: string
    expiresAt: string
    relayWssUrl?: string
    requiresDeviceApproval?: boolean
  }> => ipcRenderer.invoke('helix:create-mobile-pairing'),
  getMobileRelayUrl: (): Promise<string> => ipcRenderer.invoke('helix:get-mobile-relay-url'),
  setMobileRelayUrl: (url: string): Promise<string> => ipcRenderer.invoke('helix:set-mobile-relay-url', url),
  getMobileWorkerUrl: (): Promise<string> => ipcRenderer.invoke('helix:get-mobile-worker-url'),
  setMobileWorkerUrl: (url: string): Promise<string> => ipcRenderer.invoke('helix:set-mobile-worker-url', url),
  getMobileRelayStatus: (): Promise<{ configured: boolean; connected: boolean }> =>
    ipcRenderer.invoke('helix:get-mobile-relay-status'),
  getMobileDevices: (): Promise<Array<{ device_id: string; device_name: string; created_at: number }>> =>
    ipcRenderer.invoke('helix:get-mobile-devices'),
  revokeMobileDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('helix:revoke-mobile-device', deviceId),
  getAdminStatus: (): Promise<{ configured: boolean; authenticated: boolean }> =>
    ipcRenderer.invoke('helix:admin-status'),
  validateAdmin: (accessToken: string): Promise<{ authenticated: boolean }> =>
    ipcRenderer.invoke('helix:admin-validate', accessToken),
  getAdminConfig: (accessToken: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:admin-config', accessToken),
  saveAdminConfig: (accessToken: string, config: object): Promise<unknown> =>
    ipcRenderer.invoke('helix:admin-save-config', accessToken, config),
  createVersionBackup: (accessToken: string, version: string): Promise<unknown> =>
    ipcRenderer.invoke('helix:admin-backup', accessToken, version),
  getAdminLogs: (accessToken: string): Promise<{ success: boolean; logs: string[]; logPath: string; agentLogPath?: string; totalCount: number }> =>
    ipcRenderer.invoke('helix:admin-logs', accessToken),
  clearAdminLogs: (accessToken: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('helix:admin-clear-logs', accessToken),
})
