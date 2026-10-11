import { useEffect, useState } from 'react'
import type { HelixSettings, MCPServerConfig, MCPServerStatus } from '../../../types/global'
import { isLegacyMcpServer, type SettingsSaveResult } from '../../../hooks/settingsSave'
import { mcpSaveErrorMessage, saveMcpServerDraft } from './mcpDraft'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<SettingsSaveResult>
  saveError: string | null
}

const blankServer = { name: '', command: '' }

export default function MCPSection({ settings, onSave, saveError }: Props) {
  const servers = settings.mcp_servers ?? []
  const [draft, setDraft] = useState(blankServer)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await window.helix.getMcpServers()
        if (active) setStatuses(result)
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load MCP server status.')
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 1500)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [settings.mcp_servers])

  const persist = async (next: MCPServerConfig[]): Promise<SettingsSaveResult> => {
    setBusy(true)
    setError(null)
    try {
      const result = await onSave({ mcp_servers: next })
      if (!result.ok) setError(mcpSaveErrorMessage(result.error))
      return result
    } finally {
      setBusy(false)
    }
  }

  const saveServer = async () => {
    await saveMcpServerDraft(draft, servers, editingName, persist, () => {
      setDraft(blankServer)
      setEditingName(null)
    })
  }

  const removeServer = (name: string) => {
    void persist(servers.filter((server) => server.name !== name))
  }

  const toggleServer = (name: string, enabled: boolean) => {
    void persist(servers.map((server) => server.name === name ? { ...server, enabled } : server))
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">MCP Servers</h2>
      <p className="toolbox-section__desc">
        Connect local Model Context Protocol servers over stdio to add their tools to HELIX. URL/HTTP servers are not supported. Only add launch commands from sources you trust; enabled servers run locally.
      </p>
      {(error || saveError) && <p className="toolbox-error" role="alert">{error || saveError}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">{editingName ? `Edit ${editingName}` : 'Add MCP server'}</span>
          {editingName && <button className="validate-btn" type="button" onClick={() => { setDraft(blankServer); setEditingName(null) }}>Cancel</button>}
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="mcp-name">Server name</label>
          <input id="mcp-name" className="form-input" value={draft.name} disabled={Boolean(editingName)} placeholder="e.g. local-files" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="mcp-command">Local stdio launch command</label>
          <input id="mcp-command" className="form-input" value={draft.command} placeholder="e.g. npx -y @example/server" onChange={(event) => setDraft({ ...draft, command: event.target.value })} />
        </div>
        <button type="button" className="validate-btn toolbox-action-button" disabled={busy || !draft.name.trim() || !draft.command.trim()} onClick={() => void saveServer()}>
          {busy ? 'Saving…' : editingName ? 'Save server' : 'Add server'}
        </button>
      </div>
      <h3 className="toolbox-card__title toolbox-skill-list-title">Configured servers</h3>
      {servers.length === 0 ? (
        <p className="text-xs text-muted">No MCP servers configured.</p>
      ) : servers.map((server) => {
        const legacy = isLegacyMcpServer(server)
        const status = statuses.find((item) => item.name === server.name)
        const label = legacy ? 'unsupported' : status?.status ?? 'pending'
        return (
          <article className="toolbox-card" key={server.name}>
            <div className="toolbox-card__header">
              <div>
                <div className="toolbox-card__title">{server.name}</div>
                {!legacy && <code className="toolbox-mcp-command">{server.command}</code>}
                <div className={`toolbox-mcp-status toolbox-mcp-status--${label}`}>
                  {label === 'connected'
                    ? `Connected · ${status?.tool_count ?? 0} tools`
                    : label === 'connecting'
                      ? 'Connecting…'
                      : label === 'disabled'
                        ? 'Disabled'
                        : label === 'unsupported'
                          ? status?.error ?? 'URL-based MCP servers are not supported.'
                          : label === 'error'
                            ? status?.error ?? 'Connection failed'
                            : 'Waiting for connection'}
                </div>
              </div>
              {!legacy && (
                <label className="toggle" title={server.enabled ? 'Disable server' : 'Enable server'}>
                  <input type="checkbox" checked={server.enabled} disabled={busy} onChange={(event) => toggleServer(server.name, event.target.checked)} />
                  <span className="toggle__slider" />
                </label>
              )}
            </div>
            <div className="toolbox-skill-actions">
              {!legacy && (
                <button type="button" className="validate-btn" disabled={busy} onClick={() => {
                  setDraft({ name: server.name, command: server.command })
                  setEditingName(server.name)
                }}>Edit</button>
              )}
              <button type="button" className="validate-btn toolbox-danger-button" disabled={busy} onClick={() => removeServer(server.name)}>Remove</button>
            </div>
          </article>
        )
      })}
    </section>
  )
}
