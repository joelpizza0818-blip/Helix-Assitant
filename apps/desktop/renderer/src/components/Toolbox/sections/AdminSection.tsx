import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdminBackup, AdminConfig } from '../../../types/global'
import {
  adminRequest,
  getAccessToken,
  type AdminErrorReport,
  type HelixProfile,
} from '../../../lib/desktopSupabase'
import '../Toolbox.css'

const emptyConfig: AdminConfig = { autoUpdate: true, checkIntervalHours: 24, channel: 'stable', publicVersion: '', backups: [] }

interface AdminSectionProps {
  profile: HelixProfile
  onPendingReportsCount: (count: number) => void
}

interface ProfileListResponse { success: true; profiles: HelixProfile[] }
interface ReportListResponse { success: true; reports: AdminErrorReport[] }
interface LiteReleasePolicy {
  publicVersion: string
  channel: 'stable'
  updatedAt?: string
}
interface LiteReleasePolicyResponse { success: true; data: LiteReleasePolicy }

export default function AdminSection({ profile, onPendingReportsCount }: AdminSectionProps) {
  const [config, setConfig] = useState<AdminConfig>(emptyConfig)
  const [litePublicVersion, setLitePublicVersion] = useState('')
  const [isSavingLitePolicy, setIsSavingLitePolicy] = useState(false)
  const [litePolicySaved, setLitePolicySaved] = useState(false)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reportTitle, setReportTitle] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<HelixProfile[]>([])
  const [reports, setReports] = useState<AdminErrorReport[]>([])
  const [search, setSearch] = useState('')
  const [rankFilter, setRankFilter] = useState('all')
  const [loadingDirectory, setLoadingDirectory] = useState(false)

  // System logs state for installed build diagnostics
  const [logs, setLogs] = useState<string[]>([])
  const [logPath, setLogPath] = useState<string>('')
  const [agentLogPath, setAgentLogPath] = useState<string | undefined>(undefined)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState('')
  const [logLevel, setLogLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [copiedLogs, setCopiedLogs] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  const isMaster = profile.rank === 'master-admin'
  const isLiteRuntime = '__TAURI_INTERNALS__' in window

  const refreshDirectory = useCallback(async () => {
    if (!isMaster) return
    setLoadingDirectory(true)
    try {
      const [userResult, reportResult] = await Promise.all([
        adminRequest<ProfileListResponse>('profiles'),
        adminRequest<ReportListResponse>('reports'),
      ])
      setProfiles(userResult.profiles)
      setReports(reportResult.reports)
      onPendingReportsCount(reportResult.reports.filter((report) => report.status === 'open').length)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh admin inbox.')
    } finally {
      setLoadingDirectory(false)
    }
  }, [isMaster, onPendingReportsCount])

  useEffect(() => {
    let active = true
    const load = async () => {
      if (profile.rank === 'admin' || isMaster) {
        try {
          let loaded: AdminConfig | null = null
          if (!isLiteRuntime) {
            const token = await getAccessToken()
            if (!token) throw new Error('Vuelve a conectar tu perfil de GitHub.')
            loaded = await window.helix.getAdminConfig(token)
          }
          if (!active) return
          if (loaded) {
            setConfig(loaded)
            setSyncStatus(loaded.synced ? 'Política Electron cargada.' : loaded.syncError || 'Usando la política local.')
          }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración admin.')
        }
        try {
          const liteResult = await adminRequest<LiteReleasePolicyResponse>('lite-policy')
          if (active) setLitePublicVersion(liteResult.data.publicVersion)
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la política HELIX Lite.')
        }
      }
      await refreshDirectory()
    }
    void load()
    const timer = isMaster ? window.setInterval(() => void refreshDirectory(), 45000) : undefined
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [isLiteRuntime, isMaster, profile.rank, refreshDirectory])

  const visibleProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return profiles.filter((item) => {
      const matchesRank = rankFilter === 'all' || item.rank === rankFilter
      const matchesQuery = !query
        || item.displayName.toLocaleLowerCase().includes(query)
        || item.githubLogin.toLocaleLowerCase().includes(query)
        || (item.githubUserId ?? '').includes(query)
        || item.profileId.toLocaleLowerCase().includes(query)
      return matchesRank && matchesQuery
    })
  }, [profiles, rankFilter, search])

  const savePolicy = async () => {
    setError(null)
    setIsSaving(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Vuelve a conectar tu perfil de GitHub.')
      const updated = await window.helix.saveAdminConfig(token, config)
      setConfig(updated)
      setSaved(updated.synced === true)
      setSyncStatus(updated.synced ? 'Política pública actualizada.' : updated.syncError || 'No se sincronizó la política.')
      window.setTimeout(() => setSaved(false), 1600)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la política.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveLitePolicy = async () => {
    setError(null)
    setSyncStatus(null)
    setIsSavingLitePolicy(true)
    try {
      const version = litePublicVersion.trim()
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error('La versión Lite debe usar el formato mayor.menor.parche, por ejemplo 0.1.11.')
      }
      const updated = await adminRequest<LiteReleasePolicyResponse>('lite-policy', {
        method: 'PUT',
        body: JSON.stringify({ publicVersion: version }),
      })
      setLitePublicVersion(updated.data.publicVersion)
      setSyncStatus(`Versión pública de HELIX Lite actualizada a ${updated.data.publicVersion}.`)
      setLitePolicySaved(true)
      window.setTimeout(() => setLitePolicySaved(false), 1600)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo publicar la política de HELIX Lite.')
    } finally {
      setIsSavingLitePolicy(false)
    }
  }

  const createBackup = async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Vuelve a conectar tu perfil de GitHub.')
      const created = await window.helix.createVersionBackup(token, version)
      setConfig((current) => ({ ...current, backups: [created, ...current.backups.filter((item) => item.version !== created.version)] }))
      setVersion('')
      setSyncStatus(created.synced ? `Copia verificada de la versión ${created.version}.` : created.syncError || 'No se sincronizó la copia.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la copia.')
    }
  }

  const submitReport = async () => {
    setError(null)
    setReportStatus(null)
    setIsSubmittingReport(true)
    try {
      const appVersion = await window.helix.getAppVersion()
      await adminRequest('reports', {
        method: 'POST',
        body: JSON.stringify({ title: reportTitle, description: reportDescription, appVersion }),
      })
      setReportTitle('')
      setReportDescription('')
      setReportStatus('Reporte enviado al master-admin.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el reporte.')
    } finally {
      setIsSubmittingReport(false)
    }
  }

  const updateRank = async (target: HelixProfile, rank: 'user' | 'admin') => {
    setError(null)
    try {
      const updated = await adminRequest<{ success: true; profile: HelixProfile }>(
        `profiles/${encodeURIComponent(target.profileId)}/rank`,
        { method: 'PUT', body: JSON.stringify({ rank }) },
      )
      setProfiles((current) => current.map((item) => item.profileId === updated.profile.profileId ? updated.profile : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el rango.')
    }
  }

  const resolveReport = async (report: AdminErrorReport) => {
    setError(null)
    try {
      await adminRequest(`reports/${encodeURIComponent(report.id)}`, { method: 'PUT' })
      await refreshDirectory()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo resolver el reporte.')
    }
  }

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true)
    setLogsError(null)
    try {
      let token = ''
      if (!isLiteRuntime) {
        token = (await getAccessToken()) || ''
      }
      const res = await window.helix.getAdminLogs(token)
      if (res && res.success) {
        setLogs(res.logs || [])
        setLogPath(res.logPath || '')
        setAgentLogPath(res.agentLogPath)
      }
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : 'No se pudieron obtener los registros.')
    } finally {
      setLoadingLogs(false)
    }
  }, [isLiteRuntime])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      void fetchLogs()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, fetchLogs])

  const filteredLogs = useMemo(() => {
    const query = logFilter.trim().toLowerCase()
    return logs.filter((line) => {
      const lower = line.toLowerCase()
      if (query && !lower.includes(query)) return false
      if (logLevel === 'error') {
        return lower.includes('error') || lower.includes('[python:err]') || lower.includes('critical') || lower.includes('exception')
      }
      if (logLevel === 'warn') {
        return lower.includes('warn') || lower.includes('warning')
      }
      if (logLevel === 'info') {
        return lower.includes('info')
      }
      return true
    })
  }, [logs, logFilter, logLevel])

  const clearLogs = useCallback(async () => {
    if (!window.confirm('¿Deseas limpiar el registro del sistema?')) return
    setClearingLogs(true)
    setLogsError(null)
    try {
      let token = ''
      if (!isLiteRuntime) {
        token = (await getAccessToken()) || ''
      }
      await window.helix.clearAdminLogs(token)
      await fetchLogs()
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : 'No se pudieron limpiar los registros.')
    } finally {
      setClearingLogs(false)
    }
  }, [fetchLogs, isLiteRuntime])

  const copyLogsToClipboard = useCallback(async () => {
    try {
      const text = filteredLogs.join('\n')
      await navigator.clipboard.writeText(text)
      setCopiedLogs(true)
      window.setTimeout(() => setCopiedLogs(false), 2000)
    } catch {
      setLogsError('No se pudieron copiar los registros al portapapeles.')
    }
  }, [filteredLogs])

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Admin</h2>
      <p className="toolbox-section__desc">
        Sesión: @{profile.githubLogin} · {profile.rank}
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      {syncStatus && <p className="text-xs text-muted" role="status">{syncStatus}</p>}

      {isMaster && (
        <>
          {!isLiteRuntime && <div className="toolbox-card">
            <div className="toolbox-card__title">Política de versiones</div>
            <div className="form-row" style={{ marginTop: '12px', marginBottom: '8px' }}>
              <span className="form-label">Actualizaciones automáticas</span>
              <label className="toggle">
                <input type="checkbox" checked={config.autoUpdate} onChange={(event) => setConfig({ ...config, autoUpdate: event.target.checked })} />
                <span className="toggle__slider" />
              </label>
            </div>
            <p className="text-xs text-muted">Si se desactiva, los usuarios aún pueden buscar actualizaciones manualmente.</p>
            <div className="form-row">
              <label className="form-label" htmlFor="update-channel">Canal</label>
              <select id="update-channel" className="form-input" value={config.channel} onChange={(event) => setConfig({ ...config, channel: event.target.value as AdminConfig['channel'] })}>
                <option value="stable">Estable</option><option value="beta">Beta</option>
              </select>
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="update-interval">Intervalo de comprobación (horas)</label>
              <input id="update-interval" className="form-input" type="number" min="1" max="720" value={config.checkIntervalHours} onChange={(event) => setConfig({ ...config, checkIntervalHours: Number(event.target.value) })} />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="public-version">Versión pública</label>
              <input id="public-version" className="form-input" value={config.publicVersion} onChange={(event) => setConfig({ ...config, publicVersion: event.target.value })} placeholder="0.1.4" />
            </div>
            <button type="button" className="validate-btn" disabled={isSaving} onClick={() => void savePolicy()}>
              {isSaving ? 'Guardando…' : saved ? 'Guardado' : 'Guardar política'}
            </button>
          </div>}
          <div className="toolbox-card">
            <div className="toolbox-card__title">Publicación HELIX Lite (Tauri)</div>
            <p className="text-xs text-muted">
              Política independiente de HELIX Normal/Electron. Solo se acepta una release Lite estable ya publicada con instalador y checksum.
            </p>
            <div className="form-row">
              <label className="form-label" htmlFor="lite-public-version">Versión pública Lite</label>
              <input
                id="lite-public-version"
                className="form-input"
                value={litePublicVersion}
                onChange={(event) => setLitePublicVersion(event.target.value)}
                placeholder="0.1.11"
                pattern="\d+\.\d+\.\d+"
                inputMode="numeric"
              />
            </div>
            <button
              type="button"
              className="validate-btn"
              disabled={isSavingLitePolicy || !litePublicVersion.trim()}
              onClick={() => void saveLitePolicy()}
            >
              {isSavingLitePolicy ? 'Verificando y guardando…' : litePolicySaved ? 'Publicada' : 'Guardar versión Lite'}
            </button>
          </div>
          <div className="toolbox-card">
            <div className="toolbox-card__title">Perfiles y rangos</div>
            <div className="helix-admin-filters">
              <input className="form-input" aria-label="Buscar perfiles" placeholder="Nombre, usuario o ID" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select className="form-input" aria-label="Filtrar por rango" value={rankFilter} onChange={(event) => setRankFilter(event.target.value)}>
                <option value="all">Todos los rangos</option><option value="user">Usuario</option><option value="admin">Admin</option><option value="master-admin">Master-admin</option>
              </select>
              <button type="button" className="validate-btn" disabled={loadingDirectory} onClick={() => void refreshDirectory()}>{loadingDirectory ? 'Actualizando…' : 'Actualizar lista'}</button>
            </div>
            <div className="helix-admin-profile-list">
              {visibleProfiles.map((item) => (
                <article className="helix-admin-profile" key={item.profileId}>
                  {item.avatarUrl
                    ? <img className="helix-profile-avatar" src={item.avatarUrl} alt="" />
                    : <div className="helix-profile-avatar helix-profile-avatar--placeholder">{item.githubLogin.slice(0, 1).toUpperCase()}</div>}
                  <div className="helix-admin-profile__identity">
                    <strong>{item.displayName}</strong>
                    <span>@{item.githubLogin}</span>
                    <code>Perfil: {item.profileId}</code>
                    <code>GitHub: {item.githubUserId || 'Pendiente de vincular'}</code>
                  </div>
                  {item.rank === 'master-admin'
                    ? <span className="helix-profile-rank">master-admin</span>
                    : <select aria-label={`Rango de ${item.githubLogin}`} value={item.rank} onChange={(event) => void updateRank(item, event.target.value as 'user' | 'admin')}>
                      <option value="user">Usuario</option><option value="admin">Admin</option>
                    </select>}
                </article>
              ))}
              {!visibleProfiles.length && <p className="text-xs text-muted">No se encontraron perfiles.</p>}
            </div>
          </div>
          {!isLiteRuntime && <div className="toolbox-card">
            <div className="toolbox-card__title">Reportes recibidos · {reports.filter((report) => report.status === 'open').length} pendientes</div>
            {reports.map((report) => (
              <article className="helix-admin-report" key={report.id}>
                <div className="helix-admin-report__meta">
                  <strong>{report.title}</strong>
                  <span>@{report.github_user_roles?.github_login ?? 'perfil desconocido'} · {new Date(report.created_at).toLocaleString()}</span>
                  <span>HELIX {report.app_version} · {report.status === 'open' ? 'Pendiente' : 'Resuelto'}</span>
                </div>
                <p>{report.description}</p>
                {report.status === 'open' && <button type="button" className="validate-btn" onClick={() => void resolveReport(report)}>Marcar resuelto</button>}
              </article>
            ))}
            {!reports.length && <p className="text-xs text-muted">Todavía no hay reportes.</p>}
          </div>}
        </>
      )}

      {!isLiteRuntime && <div className="toolbox-card">
        <div className="toolbox-card__title">Copias de seguridad de versiones</div>
        <p className="text-xs text-muted">Registra una versión publicada y verificada como referencia conocida.</p>
        <div className="form-row">
          <label className="form-label" htmlFor="backup-version">Versión</label>
          <input id="backup-version" className="form-input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.4" />
        </div>
        <button type="button" className="validate-btn" disabled={!version.trim()} onClick={() => void createBackup()}>Crear registro de copia</button>
        {config.backups.map((item: AdminBackup) => (
          <p className="text-xs text-muted" key={`${item.version}-${item.createdAt}`}>
            {item.version} · {new Date(item.createdAt).toLocaleString()}
            {' '}<button type="button" className="validate-btn" disabled={!isMaster} onClick={() => setConfig((current) => ({ ...current, publicVersion: item.version }))}>Seleccionar</button>
          </p>
        ))}
      </div>}

      <div className="toolbox-card">
        <div className="toolbox-card__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Registros del Sistema (Admin)</span>
          <span className="text-xs text-muted">{filteredLogs.length} / {logs.length} líneas</span>
        </div>
        <p className="text-xs text-muted">
          Registros en tiempo real de la versión instalada y el agente en segundo plano. Solo visible para administradores.
        </p>
        {logPath && (
          <p className="text-xs text-muted" style={{ wordBreak: 'break-all' }}>
            <strong>Archivo:</strong> <code>{logPath}</code>
          </p>
        )}
        {agentLogPath && (
          <p className="text-xs text-muted" style={{ wordBreak: 'break-all' }}>
            <strong>Agente:</strong> <code>{agentLogPath}</code>
          </p>
        )}
        {logsError && <p className="toolbox-error" role="alert">{logsError}</p>}

        <div className="helix-admin-logs-toolbar">
          <input
            className="form-input"
            aria-label="Buscar en logs"
            placeholder="Filtrar por texto..."
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
          />
          <select
            className="form-input"
            aria-label="Nivel de logs"
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value as 'all' | 'info' | 'warn' | 'error')}
            style={{ maxWidth: '110px' }}
          >
            <option value="all">Todos</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>
          <label className="toggle" style={{ fontSize: '11px', gap: '6px' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span className="toggle__slider" />
            Auto (3s)
          </label>
          <button
            type="button"
            className="validate-btn"
            disabled={loadingLogs}
            onClick={() => void fetchLogs()}
          >
            {loadingLogs ? 'Cargando…' : 'Actualizar'}
          </button>
          <button
            type="button"
            className="validate-btn"
            disabled={!filteredLogs.length}
            onClick={() => void copyLogsToClipboard()}
          >
            {copiedLogs ? '¡Copiado!' : 'Copiar'}
          </button>
          <button
            type="button"
            className="validate-btn"
            disabled={clearingLogs || !logs.length}
            onClick={() => void clearLogs()}
          >
            {clearingLogs ? 'Limpiando…' : 'Limpiar'}
          </button>
        </div>

        <div className="helix-admin-logs-viewer" role="region" aria-label="Consola de logs de administrador">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((line, index) => {
              const lower = line.toLowerCase()
              let lineClass = 'helix-admin-logs-line'
              if (lower.includes('error') || lower.includes('[python:err]') || lower.includes('exception')) {
                lineClass += ' helix-admin-logs-line--error'
              } else if (lower.includes('warn')) {
                lineClass += ' helix-admin-logs-line--warn'
              } else if (line.includes('[Python]')) {
                lineClass += ' helix-admin-logs-line--python'
              } else if (line.includes('[Main]')) {
                lineClass += ' helix-admin-logs-line--main'
              }
              return (
                <div key={index} className={lineClass}>
                  {line}
                </div>
              )
            })
          ) : (
            <div className="text-xs text-muted" style={{ fontStyle: 'italic', padding: '12px 0' }}>
              {loadingLogs ? 'Cargando registros…' : 'No hay registros que coincidan con el filtro.'}
            </div>
          )}
        </div>
      </div>

      <div className="toolbox-card">
        <div className="toolbox-card__title">Enviar reporte de error</div>
        <p className="text-xs text-muted">Se enviará tu descripción y versión de HELIX. No adjunta conversaciones, comandos ni registros automáticamente.</p>
        {reportStatus && <p className="text-xs text-muted" role="status">{reportStatus}</p>}
        <div className="form-row">
          <label className="form-label" htmlFor="error-report-title">Resumen</label>
          <input id="error-report-title" className="form-input" maxLength={120} value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="error-report-description">Descripción</label>
          <textarea id="error-report-description" className="form-input" maxLength={5000} rows={5} value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} />
        </div>
        <button type="button" className="validate-btn" disabled={isSubmittingReport || !reportTitle.trim() || !reportDescription.trim()} onClick={() => void submitReport()}>
          {isSubmittingReport ? 'Enviando…' : 'Enviar al master-admin'}
        </button>
      </div>
    </section>
  )
}
