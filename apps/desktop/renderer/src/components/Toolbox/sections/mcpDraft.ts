mport type { MCPServerConfig } from '../../../types/global'
import type { SettingsSaveResult } from '../../../hooks/settingsSave'

export function mcpSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/MCP URL transport is not supported/i.test(message)) {
    return 'URL-based MCP servers are not supported. Configure a local stdio launch command.'
  }
  return message || 'Could not save MCP configuration.'
}

export async function saveMcpServerDraft(
  draft: { name: string; command: string },
  servers: MCPServerConfig[],
  editingName: string | null,
  persist: (next: MCPServerConfig[]) => Promise<SettingsSaveResult>,
  onSaved: () => void,
): Promise<boolean> {
  const name = draft.name.trim()
  const command = draft.command.trim()
  if (!name || !command) return false
  const next = [
    ...servers.filter((server) => server.name !== editingName && server.name !== name),
    { name, command, enabled: true },
  ]
  if (!(await persist(next)).ok) return false
  onSaved()
  return true
}
