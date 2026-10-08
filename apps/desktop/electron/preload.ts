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

  // Open external URL in default browser
  openExternal: (url: string): void => {
    ipcRenderer.send('helix:open-external', url)
  },

  // Request/response operations
  getSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('helix:get-settings'),

  saveSettings: (settings: object): Promise<void> =>
    ipcRenderer.invoke('helix:save-settings', settings),

  getTasks: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-tasks'),

  getProviders: (): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-providers'),

  getModels: (requirements?: object): Promise<unknown[]> =>
    ipcRenderer.invoke('helix:get-models', requirements),

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

  // Event subscriptions (return cleanup function)
  onAgentMessage: (fn: (msg: unknown) => void): (() => void) =>
    createEventListener('helix:agent-message', fn),

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
})
