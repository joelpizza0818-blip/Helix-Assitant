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

export default function AdminSection({ profile, onPendingReportsCount }: AdminSectionProps) {
  const [config, setConfig] = useState<AdminConfig>(emptyConfig)
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

  const isMaster = profile.rank === 'master-admin'

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
          const token = await getAccessToken()
          if (!token) throw new Error('Vuelve a conectar tu perfil de GitHub.')
          const loaded = await window.helix.getAdminConfig(token)
          if (!active) return
          setConfig(loaded)
          setSyncStatus(loaded.synced ? 'Política compartida cargada.' : loaded.syncError || 'Usando la política local.')
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración admin.')
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
  }, [isMaster, refreshDirectory])

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
          <div className="toolbox-card">
            <div className="toolbox-card__title">Política de versiones</div>
            <label className="toggle">
              <input type="checkbox" checked={config.autoUpdate} onChange={(event) => setConfig({ ...config, autoUpdate: event.target.checked })} />
              <span className="toggle__slider" />
              Actualizaciones automáticas
            </label>
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
          <div className="toolbox-card">
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
          </div>
        </>
      )}

      <div className="toolbox-card">
        <div className="toolbox-card__title">Copias de seguridad de versiones</div>
        <p className="text-xs text-muted">Registra una versión publicada y verificada como referencia conocida.</p>
        <div className="form-row">
          <label className="form-label" htmlFor="backup-version">Versión</label>
          <input id="backup-version" className="form-input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.4" />
        </div>
        <button type="button" className="validate-btn" disabled={!version.trim()} onClick={() => void createBackup()}>Crear registro de copia</button>
        {config.backups.map((item: AdminBackup) => (
          <p className="text-xs text-muted" key={`${item.version}-${item.createdAt}`}>
            ✓ {item.version} · {new Date(item.createdAt).toLocaleString()}
            {' '}<button type="button" className="validate-btn" disabled={!isMaster} onClick={() => setConfig((current) => ({ ...current, publicVersion: item.version }))}>Seleccionar</button>
          </p>
        ))}
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
