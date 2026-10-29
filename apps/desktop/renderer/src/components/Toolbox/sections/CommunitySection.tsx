import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  COMMUNITY_INSTALLED_AGENTS_KEY,
  COMMUNITY_INSTALLED_PLUGINS_KEY,
  communityRequest,
  type HelixProfile,
} from '../../../lib/desktopSupabase'
import '../Toolbox.css'

type CommunityType = 'plugin' | 'skill' | 'agent'
type CommunityStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type CommunityView = 'marketplace' | 'mine' | 'create' | 'moderation'
type AgentRole = 'planning' | 'coding' | 'automation' | 'research' | 'analysis' | 'general'

interface CommunityItem {
  id: string
  type: CommunityType
  name: string
  description: string
  manifest: Record<string, unknown>
  status: CommunityStatus
  reviewNote?: string | null
  createdAt: string
  creator?: { displayName: string | null }
}

interface CommunityDraft {
  type: CommunityType
  name: string
  description: string
  url: string
  triggers: string
  instructions: string
  role: AgentRole
  capabilities: string
  color: string
}

const EMPTY_DRAFT: CommunityDraft = {
  type: 'plugin',
  name: '',
  description: '',
  url: '',
  triggers: '',
  instructions: '',
  role: 'research',
  capabilities: '',
  color: '#ee6018',
}
interface InstalledCommunityPlugin {
  id: string
  name: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInstalledCommunityPlugin(value: unknown): value is InstalledCommunityPlugin {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.url !== 'string') {
    return false
  }
  try {
    const url = new URL(value.url)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function getPluginUrl(item: CommunityItem): string | null {
  if (!isRecord(item.manifest)) return null
  const rawUrl = item.manifest.url
  if (typeof rawUrl !== 'string') return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function getAgentManifest(item: CommunityItem): {
  role: AgentRole
  capabilities: string[]
  color: string
  instructions: string
} | null {
  if (!isRecord(item.manifest)) return null
  const { role, capabilities, color, instructions } = item.manifest
  if (
    typeof role !== 'string'
    || !['planning', 'coding', 'automation', 'research', 'analysis', 'general'].includes(role)
    || !Array.isArray(capabilities)
    || !capabilities.every((value) => typeof value === 'string')
    || typeof color !== 'string'
    || !/^#[0-9a-f]{6}$/i.test(color)
    || (instructions !== undefined && typeof instructions !== 'string')
  ) return null
  return {
    role: role as AgentRole,
    capabilities,
    color,
    instructions: typeof instructions === 'string' ? instructions : '',
  }
}

function statusLabel(status: CommunityStatus): string {
  if (status === 'APPROVED') return 'Aprobado'
  if (status === 'REJECTED') return 'Rechazado'
  return 'En revisión'
}

export default function CommunitySection({
  profile,
}: {
  profile: HelixProfile | null
}) {
  const isModerator = profile?.rank === 'admin' || profile?.rank === 'master-admin'
  const [view, setView] = useState<CommunityView>('marketplace')
  const [typeFilter, setTypeFilter] = useState<'all' | CommunityType>('all')
  const [items, setItems] = useState<CommunityItem[]>([])
  const [myItems, setMyItems] = useState<CommunityItem[]>([])
  const [moderationItems, setModerationItems] = useState<CommunityItem[]>([])
  const [installedPluginIds, setInstalledPluginIds] = useState<string[]>([])
  const [installedAgentIds, setInstalledAgentIds] = useState<string[]>([])
  const [draft, setDraft] = useState<CommunityDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadMarketplace = async () => {
    setError(null)
    setListBusy(true)
    try {
      setItems(await communityRequest<CommunityItem[]>('/'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar Community.')
    } finally {
      setListBusy(false)
    }
  }

  const loadMine = async () => {
    if (!profile) {
      setError('Conecta tu perfil de HELIX para ver tus publicaciones.')
      return
    }
    setError(null)
    setListBusy(true)
    try {
      setMyItems(await communityRequest<CommunityItem[]>('/mine', {}, true))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar tus publicaciones.')
    } finally {
      setListBusy(false)
    }
  }

  const loadModeration = async () => {
    setError(null)
    setListBusy(true)
    try {
      setModerationItems(await communityRequest<CommunityItem[]>('/moderation', {}, true))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la cola de revisión.')
    } finally {
      setListBusy(false)
    }
  }

  useEffect(() => {
    void loadMarketplace()
    try {
      const saved = JSON.parse(localStorage.getItem(COMMUNITY_INSTALLED_PLUGINS_KEY) ?? '[]')
      if (Array.isArray(saved)) {
        setInstalledPluginIds(
          [...new Set(saved.filter(isInstalledCommunityPlugin).map((item) => item.id))],
        )
      }
      const savedAgents = JSON.parse(localStorage.getItem(COMMUNITY_INSTALLED_AGENTS_KEY) ?? '[]')
      if (Array.isArray(savedAgents)) {
        setInstalledAgentIds([...new Set(savedAgents.filter((item): item is string => typeof item === 'string'))])
      }
    } catch {
      setError('No se pudo leer la lista local de elementos instalados.')
    }
  }, [])

  useEffect(() => {
    if (view === 'mine') void loadMine()
    if (view === 'moderation' && isModerator) void loadModeration()
  }, [view, profile?.profileId, isModerator])

  const marketplaceItems = useMemo(
    () => items.filter((item) => typeFilter === 'all' || item.type === typeFilter),
    [items, typeFilter],
  )

  const installPlugin = (item: CommunityItem) => {
    const url = getPluginUrl(item)
    if (!url) {
      setError('Este plugin no tiene una URL HTTPS válida y no se puede instalar.')
      return
    }
    try {
      const saved = JSON.parse(localStorage.getItem(COMMUNITY_INSTALLED_PLUGINS_KEY) ?? '[]')
      const current = Array.isArray(saved) ? saved.filter(isInstalledCommunityPlugin) : []
      const next = [
        ...current.filter((entry) => entry.id !== item.id),
        { id: item.id, name: item.name, url },
      ]
      localStorage.setItem(COMMUNITY_INSTALLED_PLUGINS_KEY, JSON.stringify(next))
      setInstalledPluginIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id])
      setNotice(`${item.name} se añadió a tus plugins.`)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo instalar el plugin.')
    }
  }

  const installSkill = async (item: CommunityItem) => {
    const manifest = item.manifest
    if (!isRecord(manifest)) {
      setError('La skill no contiene un manifiesto válido.')
      return
    }
    const triggers = manifest.triggers
    const tools = manifest.tools
    const instructions = manifest.instructions
    if (
      !Array.isArray(triggers)
      || !triggers.every((value) => typeof value === 'string')
      || !Array.isArray(tools)
      || !tools.every((value) => typeof value === 'string')
      || typeof instructions !== 'string'
    ) {
      setError('La skill no contiene un manifiesto válido.')
      return
    }
    if (!window.confirm(
      `Instalar "${item.name}" como instrucciones locales? Revisa el contenido enviado por la comunidad antes de usarlo.`,
    )) return
    setBusyItem(item.id)
    setError(null)
    try {
      await window.helix.saveSkill({
        name: `community-${item.id.slice(0, 8)}`,
        description: item.description,
        triggers,
        tools,
        instructions,
      })
      setNotice(`${item.name} se instaló como skill local.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo instalar la skill.')
    } finally {
      setBusyItem(null)
    }
  }

  const installAgent = async (item: CommunityItem) => {
    const manifest = getAgentManifest(item)
    if (!manifest) {
      setError('Este agente no contiene un perfil válido.')
      return
    }
    if (!window.confirm(
      `Instalar "${item.name}" como perfil local? Sus instrucciones son texto y no incluyen código ejecutable.`,
    )) return
    setBusyItem(item.id)
    setError(null)
    try {
      const profile = await window.helix.createSubagentProfile({
        name: item.name,
        role: manifest.role,
        description: item.description,
        capabilities: manifest.capabilities,
        color: manifest.color,
        instructions: manifest.instructions,
      })
      setInstalledAgentIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id])
      setNotice(`${profile.name} se añadió a tus subagentes; puedes personalizar su perfil en el panel.`)
      try {
        const saved = JSON.parse(localStorage.getItem(COMMUNITY_INSTALLED_AGENTS_KEY) ?? '[]')
        const current = Array.isArray(saved)
          ? saved.filter((value): value is string => typeof value === 'string')
          : []
        const next = [...new Set([...current, item.id])]
        localStorage.setItem(COMMUNITY_INSTALLED_AGENTS_KEY, JSON.stringify(next))
      } catch (cause) {
        setError(cause instanceof Error
          ? `El agente se instaló, pero no se pudo guardar su indicador local: ${cause.message}`
          : 'El agente se instaló, pero no se pudo guardar su indicador local.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo instalar el agente.')
    } finally {
      setBusyItem(null)
    }
  }

  const openPlugin = async (item: CommunityItem) => {
    const url = getPluginUrl(item)
    if (!url) {
      setError('Este plugin no tiene una URL HTTPS válida.')
      return
    }
    setBusyItem(item.id)
    setError(null)
    try {
      await window.helix.openManagedBrowserTab(url)
      setNotice(`${item.name} se abrió en la pestaña dedicada de HELIX.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `No se pudo abrir ${item.name}.`)
    } finally {
      setBusyItem(null)
    }
  }

  const submitDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!profile) {
      setError('Conecta tu perfil de HELIX para publicar.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const manifest = draft.type === 'plugin'
        ? { url: draft.url.trim() }
        : draft.type === 'skill'
          ? {
            triggers: draft.triggers.split(',').map((item) => item.trim()).filter(Boolean),
            tools: [],
            instructions: draft.instructions.trim(),
          }
          : {
            role: draft.role,
            capabilities: draft.capabilities.split(',').map((item) => item.trim()).filter(Boolean),
            color: draft.color,
            instructions: draft.instructions.trim(),
          }
      await communityRequest<CommunityItem>('/', {
        method: 'POST',
        body: JSON.stringify({
          type: draft.type,
          name: draft.name.trim(),
          description: draft.description.trim(),
          manifest,
        }),
      }, true)
      setDraft(EMPTY_DRAFT)
      setNotice('Publicación enviada. Será visible en el mercado cuando termine la revisión.')
      setView('mine')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la publicación.')
    } finally {
      setBusy(false)
    }
  }

  const reviewItem = async (item: CommunityItem, status: 'APPROVED' | 'REJECTED') => {
    const reviewNote = status === 'REJECTED'
      ? window.prompt('Motivo de rechazo (opcional):') ?? undefined
      : undefined
    setBusyItem(item.id)
    setError(null)
    try {
      await communityRequest(`/${encodeURIComponent(item.id)}/review`, {
        method: 'POST',
        body: JSON.stringify({ status, reviewNote }),
      }, true)
      setModerationItems((current) => current.filter((entry) => entry.id !== item.id))
      setNotice(`Publicación ${status === 'APPROVED' ? 'aprobada' : 'rechazada'}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la revisión.')
    } finally {
      setBusyItem(null)
    }
  }

  const displayedItems = view === 'marketplace'
    ? marketplaceItems
    : view === 'mine'
      ? myItems
      : view === 'moderation'
        ? moderationItems
        : []

  return (
    <section className="toolbox-section community-section">
      <div className="community-heading">
        <div>
          <h2 className="toolbox-section__title">Community</h2>
          <p className="toolbox-section__desc">
            Explora, instala y publica plugins, skills y perfiles de agentes. Las publicaciones requieren revisión antes de aparecer en el mercado.
          </p>
        </div>
        <span className="community-review-badge">Revisión previa</span>
      </div>

      <div className="community-tabs" role="tablist" aria-label="Community">
        <button type="button" className={view === 'marketplace' ? 'is-active' : ''} onClick={() => setView('marketplace')}>Mercado</button>
        <button type="button" className={view === 'mine' ? 'is-active' : ''} onClick={() => setView('mine')}>Mis publicaciones</button>
        <button type="button" className={view === 'create' ? 'is-active' : ''} onClick={() => setView('create')}>Crear</button>
        {isModerator && (
          <button type="button" className={view === 'moderation' ? 'is-active' : ''} onClick={() => setView('moderation')}>Revisión</button>
        )}
      </div>

      {error && <p className="toolbox-error" role="alert">{error}</p>}
      {notice && <p className="community-notice" role="status">{notice}</p>}

      {view === 'marketplace' && (
        <div className="community-filter-row" aria-label="Filtrar publicaciones">
          {(['all', 'plugin', 'skill', 'agent'] as const).map((filter) => (
            <button
              type="button"
              key={filter}
              className={typeFilter === filter ? 'is-active' : ''}
              onClick={() => setTypeFilter(filter)}
            >
              {filter === 'all' ? 'Todo' : filter === 'plugin' ? 'Plugins' : filter === 'skill' ? 'Skills' : 'Agentes'}
            </button>
          ))}
          <button type="button" className="community-text-button" onClick={() => void loadMarketplace()}>Actualizar</button>
        </div>
      )}

      {view === 'create' && (
        <form className="community-creator" onSubmit={(event) => void submitDraft(event)}>
          {!profile && <p className="community-hint">Conecta tu perfil HELIX antes de publicar.</p>}
          <label className="form-row">
            <span className="form-label">Tipo de publicación</span>
            <select
              className="form-input"
              value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as CommunityType })}
            >
              <option value="plugin">Plugin web</option>
              <option value="skill">Skill</option>
              <option value="agent">Perfil de agente</option>
            </select>
          </label>
          <label className="form-row">
            <span className="form-label">Nombre</span>
            <input className="form-input" maxLength={draft.type === 'agent' ? 40 : 80} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="form-row">
            <span className="form-label">Descripción</span>
            <textarea className="form-input community-description-input" maxLength={draft.type === 'agent' ? 500 : 600} minLength={12} required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          {draft.type === 'plugin' ? (
            <>
              <label className="form-row">
                <span className="form-label">Sitio HTTPS</span>
                <input className="form-input" type="url" required placeholder="https://example.com" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
              </label>
              <p className="community-hint">Los plugins comunitarios solo registran una URL segura; no se ejecuta código de terceros.</p>
            </>
          ) : draft.type === 'skill' ? (
            <>
              <label className="form-row">
                <span className="form-label">Activadores (separados por comas)</span>
                <input className="form-input" required value={draft.triggers} onChange={(event) => setDraft({ ...draft, triggers: event.target.value })} />
              </label>
              <label className="form-row">
                <span className="form-label">Instrucciones</span>
                <textarea className="form-input community-instructions-input" required maxLength={15000} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
              </label>
              <p className="community-hint">Las skills se guardan como texto de instrucciones; no admiten scripts ni paquetes ejecutables.</p>
            </>
          ) : (
            <>
              <label className="form-row">
                <span className="form-label">Especialidad</span>
                <select className="form-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as AgentRole })}>
                  {(['planning', 'coding', 'automation', 'research', 'analysis', 'general'] as const).map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="form-row">
                <span className="form-label">Capacidades (separadas por comas)</span>
                <input className="form-input" maxLength={820} value={draft.capabilities} onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })} />
              </label>
              <label className="form-row">
                <span className="form-label">Color</span>
                <input className="form-input" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
              </label>
              <label className="form-row">
                <span className="form-label">Instrucciones adicionales (opcional)</span>
                <textarea className="form-input community-instructions-input" maxLength={6000} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
              </label>
              <p className="community-hint">Se publica un perfil y texto de instrucciones; no se admiten scripts, herramientas con permisos propios ni claves de proveedor.</p>
            </>
          )}
          <button className="validate-btn community-primary-button" type="submit" disabled={busy || !profile}>
            {busy ? 'Enviando…' : 'Enviar a revisión'}
          </button>
        </form>
      )}

      {view !== 'create' && listBusy && (
        <div className="community-empty" role="status">Cargando publicaciones…</div>
      )}
      {view !== 'create' && !listBusy && displayedItems.length === 0 && (
        <div className="community-empty">
          {view === 'marketplace'
            ? 'Aún no hay publicaciones aprobadas para este filtro.'
            : view === 'moderation'
              ? 'No hay publicaciones pendientes de revisión.'
              : 'Todavía no tienes publicaciones.'}
        </div>
      )}

      {view !== 'create' && displayedItems.length > 0 && (
        <div className="community-item-list">
          {displayedItems.map((item) => {
            const pluginUrl = item.type === 'plugin' ? getPluginUrl(item) : null
            const installed = installedPluginIds.includes(item.id)
            const installedAgent = installedAgentIds.includes(item.id)
            const skillTriggers = isRecord(item.manifest) && Array.isArray(item.manifest.triggers)
              ? item.manifest.triggers.filter((value): value is string => typeof value === 'string')
              : []
            const agentManifest = item.type === 'agent' ? getAgentManifest(item) : null
            return (
              <article className="community-item-card" key={item.id}>
                <div className="community-item-card__header">
                  <span className={`community-item-type community-item-type--${item.type}`}>
                    {item.type === 'plugin' ? 'PLUGIN' : item.type === 'skill' ? 'SKILL' : 'AGENTE'}
                  </span>
                  {view === 'mine' && (
                    <span className={`community-status community-status--${item.status.toLowerCase()}`}>
                      {statusLabel(item.status)}
                    </span>
                  )}
                  {view === 'moderation' && (
                    <span className="community-status community-status--pending">En revisión</span>
                  )}
                </div>
                <h3>{item.name}</h3>
                <p className="community-item-description">{item.description}</p>
                {item.type === 'plugin' && pluginUrl && (
                  <p className="community-item-meta">{new URL(pluginUrl).hostname}</p>
                )}
                {item.type === 'skill' && skillTriggers.length > 0 && (
                  <p className="community-item-meta">Activadores: {skillTriggers.join(', ')}</p>
                )}
                {agentManifest && (
                  <p className="community-item-meta">
                    Especialidad: {agentManifest.role} · {agentManifest.capabilities.join(', ')}
                  </p>
                )}
                {view === 'marketplace' && item.type === 'plugin' && (
                  <div className="community-item-actions">
                    <button type="button" className="validate-btn" disabled={!pluginUrl} onClick={() => installPlugin(item)}>
                      {installed ? 'Instalado' : 'Añadir plugin'}
                    </button>
                    <button type="button" className="community-secondary-button" disabled={!pluginUrl || busyItem !== null} onClick={() => void openPlugin(item)}>
                      {busyItem === item.id ? 'Abriendo…' : 'Abrir en HELIX'}
                    </button>
                  </div>
                )}
                {view === 'marketplace' && item.type === 'skill' && (
                  <button type="button" className="validate-btn" disabled={busyItem !== null} onClick={() => void installSkill(item)}>
                    {busyItem === item.id ? 'Instalando…' : 'Revisar e instalar'}
                  </button>
                )}
                {view === 'marketplace' && item.type === 'agent' && (
                  <button type="button" className="validate-btn" disabled={busyItem !== null || !agentManifest} onClick={() => void installAgent(item)}>
                    {busyItem === item.id ? 'Instalando…' : installedAgent ? 'Instalado' : 'Añadir agente'}
                  </button>
                )}
                {view === 'mine' && item.reviewNote && (
                  <p className="community-review-note">Nota de revisión: {item.reviewNote}</p>
                )}
                {view === 'moderation' && (
                  <div className="community-item-actions">
                    <button type="button" className="validate-btn" disabled={busyItem !== null} onClick={() => void reviewItem(item, 'APPROVED')}>Aprobar</button>
                    <button type="button" className="community-secondary-button" disabled={busyItem !== null} onClick={() => void reviewItem(item, 'REJECTED')}>Rechazar</button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
      <p className="community-disclaimer">
        Revisa el destino y el contenido de cada publicación. Los plugins abren sitios externos; skills y agentes usan instrucciones de texto y pueden influir en las acciones del agente.
      </p>
    </section>
  )
}
