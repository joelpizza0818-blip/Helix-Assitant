mport type { HelixSettings, LegacyMCPServerConfig, MCPServerConfig } from '../types/global'

export type SettingsSaveResult =
  | { ok: true }
  | { ok: false; error: Error }

export type PreparedSettingsSave =
  | { ok: true; merged: HelixSettings; payload: HelixSettings }
  | { ok: false; error: Error }

export function isLegacyMcpServer(
  server: MCPServerConfig,
): server is LegacyMCPServerConfig {
  return 'url' in server || 'server_url' in server
}

export function prepareSettingsSave(
  current: HelixSettings,
  partial: Partial<HelixSettings>,
): PreparedSettingsSave {
  const merged = { ...current, ...partial }
  const explicitlySavingMcp = Object.prototype.hasOwnProperty.call(partial, 'mcp_servers')

  if (explicitlySavingMcp && (partial.mcp_servers ?? []).some(isLegacyMcpServer)) {
    return {
      ok: false,
      error: new Error('MCP URL transport is not supported; configure a local stdio launch command.'),
    }
  }

  const payload = { ...merged }
  if (!explicitlySavingMcp && (current.mcp_servers ?? []).some(isLegacyMcpServer)) {
    delete payload.mcp_servers
  }

  return { ok: true, merged, payload }
}
