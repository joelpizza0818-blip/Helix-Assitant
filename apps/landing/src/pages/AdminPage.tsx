import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveSiteNavigation } from '../components/ResponsiveSiteNavigation'
import {
  mapAdminAnnouncement,
  mapAdminInstaller,
  requestAdmin,
  type AdminProfile,
  type AnnouncementCategory,
  type LandingAnnouncement,
  type LandingInstaller,
  type InstallerEdition,
  type InstallerPlatform,
} from '../lib/landingContent'
import './AdminPage.css'

type AdminTab = 'announcements' | 'installers' | 'ranks'
type ApiList<T> = { success: boolean; [key: string]: unknown } & Record<string, unknown>

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = [
  'RELEASE',
  'FEATURE',
  'SECURITY',
  'MOBILE',
  'ECOSYSTEM',
  'COMPATIBILITY',
]
const INSTALLER_PLATFORMS: InstallerPlatform[] = ['windows', 'linux', 'macos', 'android', 'ios']
const INSTALLER_EDITIONS: InstallerEdition[] = ['normal', 'lite', 'mobile']
const EDITIONS_BY_PLATFORM: Record<InstallerPlatform, InstallerEdition[]> = {
  windows: ['normal', 'lite'],
  linux: ['normal', 'lite'],
  macos: ['normal', 'lite'],
  android: ['mobile'],
  ios: ['mobile'],
}

interface AnnouncementDraft {
  id?: string
  category: AnnouncementCategory
  title: string
  summary: string
  content: string
  links: string
}

interface InstallerDraft {
  platform: InstallerPlatform
  edition: InstallerEdition
  version: string
  installerUrl: string
  checksumUrl: string
  releaseUrl: string
}

const emptyAnnouncement: AnnouncementDraft = {
  category: 'FEATURE',
  title: '',
  summary: '',
  content: '',
  links: '',
}

const emptyInstaller: InstallerDraft = {
  platform: 'windows',
  edition: 'normal',
  version: '',
  installerUrl: '',
  checksumUrl: '',
  releaseUrl: '',
}

function readList<T>(payload: ApiList<T>, key: string): T[] {
  const entries = payload[key]
  if (!Array.isArray(entries)) throw new Error('Admin service returned an invalid list.')
  return entries as T[]
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(date))
}

export function AdminPage() {
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [announcements, setAnnouncements] = useState<LandingAnnouncement[]>([])
  const [installers, setInstallers] = useState<LandingInstaller[]>([])
  const [profiles, setProfiles] = useState<AdminProfile[]>([])
  const [tab, setTab] = useState<AdminTab>('announcements')
  const [announcementDraft, setAnnouncementDraft] = useState<AnnouncementDraft>(emptyAnnouncement)
  const [installerDraft, setInstallerDraft] = useState<InstallerDraft>(emptyInstaller)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadContent = useCallback(async () => {
    const [announcementResponse, installerResponse] = await Promise.all([
      requestAdmin<ApiList<Record<string, unknown>>>('announcements'),
      requestAdmin<ApiList<Record<string, unknown>>>('installers'),
    ])
    setAnnouncements(readList<Record<string, unknown>>(announcementResponse, 'announcements').map(mapAdminAnnouncement))
    setInstallers(readList<Record<string, unknown>>(installerResponse, 'installers').map(mapAdminInstaller))
  }, [])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const authorization = await requestAdmin<{ authenticated: boolean; profile: AdminProfile }>('authorization')
        if (!active) return
        setProfile(authorization.profile)
        if (!authorization.authenticated) {
          setError('Tu cuenta de GitHub no tiene un rango admin. Solicita acceso a un master-admin.')
          return
        }
        try {
          await requestAdmin('installers/import-history', 'POST')
        } catch (syncError: unknown) {
          if (active) {
            setError(syncError instanceof Error
              ? `No se pudo sincronizar el histórico de GitHub: ${syncError.message}`
              : 'No se pudo sincronizar el histórico de GitHub.')
          }
        }
        await loadContent()
        if (authorization.profile.rank === 'master-admin') {
          const response = await requestAdmin<ApiList<AdminProfile>>('profiles')
          if (active) setProfiles(readList<AdminProfile>(response, 'profiles'))
        }
      } catch (loadError: unknown) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el panel admin.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void initialize()
    return () => { active = false }
  }, [loadContent])

  const groupedInstallers = useMemo(() => (
    INSTALLER_PLATFORMS.map((platform) => ({
      platform,
      editions: EDITIONS_BY_PLATFORM[platform].map((edition) => ({
        edition,
        entries: installers
          .filter((installer) => installer.platform === platform && installer.edition === edition)
          .sort((a, b) => Date.parse(b.releaseDate) - Date.parse(a.releaseDate)),
      })),
    }))
  ), [installers])

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(successMessage)
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'La operación no se pudo completar.')
    } finally {
      setSaving(false)
    }
  }

  const saveAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = announcementDraft.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    let links: Array<{ text: string; url: string; external: boolean }>
    try {
      links = announcementDraft.links.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [text, url] = line.split('|').map((part) => part.trim())
        if (!text || !url) throw new Error('Cada enlace debe usar el formato: texto | https://... o /ruta')
        return { text, url, external: /^https:\/\//i.test(url) }
      })
    } catch (parseError: unknown) {
      setError(parseError instanceof Error ? parseError.message : 'Los enlaces del anuncio son inválidos.')
      setNotice(null)
      return
    }
    const payload = {
      category: announcementDraft.category,
      title: announcementDraft.title,
      summary: announcementDraft.summary,
      content,
      links,
    }

    await runAction(async () => {
      if (announcementDraft.id) {
        await requestAdmin(`announcements/${announcementDraft.id}`, 'PUT', payload)
      } else {
        await requestAdmin('announcements', 'POST', payload)
      }
      setAnnouncementDraft(emptyAnnouncement)
      await loadContent()
    }, announcementDraft.id ? 'Anuncio guardado.' : 'Anuncio creado como borrador.')
  }

  const editAnnouncement = (announcement: LandingAnnouncement) => {
    setTab('announcements')
    setAnnouncementDraft({
      id: announcement.id,
      category: announcement.category,
      title: announcement.title,
      summary: announcement.summary,
      content: announcement.content.join('\n'),
      links: announcement.links.map((link) => `${link.text} | ${link.url}`).join('\n'),
    })
    setError(null)
    setNotice(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const changeAnnouncementPublication = (announcement: LandingAnnouncement) => runAction(async () => {
    await requestAdmin(`announcements/${announcement.id}/publication`, 'PUT', { isPublished: !announcement.isPublished })
    await loadContent()
  }, announcement.isPublished ? 'Anuncio retirado de la landing.' : 'Anuncio publicado en la landing.')

  const deleteAnnouncement = (announcement: LandingAnnouncement) => {
    if (!window.confirm(`¿Eliminar el borrador "${announcement.title}"?`)) return
    void runAction(async () => {
      await requestAdmin(`announcements/${announcement.id}`, 'DELETE')
      await loadContent()
    }, 'Borrador eliminado.')
  }

  const saveInstaller = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runAction(async () => {
      await requestAdmin('installers', 'POST', installerDraft)
      setInstallerDraft(emptyInstaller)
      await loadContent()
    }, 'Versión añadida al histórico como borrador.')
  }

  const importInstallerHistory = () => runAction(async () => {
    await requestAdmin('installers/import-history', 'POST')
    await loadContent()
  }, 'Histórico de GitHub sincronizado.')

  const changeInstallerPublication = (installer: LandingInstaller) => runAction(async () => {
    await requestAdmin(`installers/${installer.id}/publication`, 'PUT', { isPublished: !installer.isPublished })
    await loadContent()
  }, installer.isPublished ? 'Versión retirada del catálogo público.' : 'Versión seleccionada para el catálogo público.')

  const deleteInstaller = (installer: LandingInstaller) => {
    if (!window.confirm(`¿Eliminar la versión ${installer.version} de ${installer.platform} / ${installer.edition}?`)) return
    void runAction(async () => {
      await requestAdmin(`installers/${installer.id}`, 'DELETE')
      await loadContent()
    }, 'Versión eliminada del histórico.')
  }

  const assignRank = async (target: AdminProfile, rank: 'user' | 'admin') => {
    await runAction(async () => {
      const response = await requestAdmin<{ profile: AdminProfile }>(`profiles/${target.profileId}/rank`, 'PUT', { rank })
      setProfiles((existing) => existing.map((item) => item.profileId === target.profileId ? response.profile : item))
    }, `Rango actualizado para ${target.githubLogin}.`)
  }

  if (loading) {
    return (
      <div className="admin-page">
        <ResponsiveSiteNavigation />
        <main className="admin-shell"><p role="status">Comprobando permisos y cargando el panel…</p></main>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <ResponsiveSiteNavigation />
      <main className="admin-shell">
        <header className="admin-heading">
          <div>
            <p className="admin-eyebrow">HELIX CONTROL ROOM</p>
            <h1>Administración de la landing</h1>
            <p>Sesión GitHub: <strong>{profile?.githubLogin}</strong> · rango <strong>{profile?.rank}</strong></p>
          </div>
          <Link to="/announcements">Ver landing pública</Link>
        </header>

        {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
        {notice && <p className="admin-alert admin-alert--success" role="status">{notice}</p>}

        {profile && profile.rank !== 'user' ? (
          <>
            <div className="admin-tabs" role="tablist" aria-label="Secciones de administración">
              <button type="button" role="tab" aria-selected={tab === 'announcements'} onClick={() => setTab('announcements')}>Anuncios</button>
              <button type="button" role="tab" aria-selected={tab === 'installers'} onClick={() => setTab('installers')}>Instaladores</button>
              {profile.rank === 'master-admin' && (
                <button type="button" role="tab" aria-selected={tab === 'ranks'} onClick={() => setTab('ranks')}>Rangos admin</button>
              )}
            </div>

            {tab === 'announcements' && (
              <section className="admin-section">
                <form className="admin-form" onSubmit={(event) => { void saveAnnouncement(event) }}>
                  <div className="admin-section-heading">
                    <div>
                      <h2>{announcementDraft.id ? 'Editar anuncio' : 'Nuevo anuncio'}</h2>
                      <p>Los nuevos anuncios se guardan como borrador y no aparecen en la landing hasta publicarlos.</p>
                    </div>
                    {announcementDraft.id && (
                      <button type="button" className="admin-button admin-button--quiet" onClick={() => setAnnouncementDraft(emptyAnnouncement)}>Cancelar edición</button>
                    )}
                  </div>
                  <div className="admin-form-grid">
                    <label>
                      Categoría
                      <select value={announcementDraft.category} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, category: event.target.value as AnnouncementCategory })}>
                        {ANNOUNCEMENT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </label>
                    <label className="admin-form-grid__wide">
                      Título
                      <input required maxLength={180} value={announcementDraft.title} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, title: event.target.value })} />
                    </label>
                    <label className="admin-form-grid__wide">
                      Resumen
                      <textarea required maxLength={700} rows={3} value={announcementDraft.summary} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, summary: event.target.value })} />
                    </label>
                    <label className="admin-form-grid__wide">
                      Puntos destacados (uno por línea)
                      <textarea rows={5} value={announcementDraft.content} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, content: event.target.value })} />
                    </label>
                    <label className="admin-form-grid__wide">
                      Enlaces opcionales (uno por línea: texto | /ruta o URL https)
                      <textarea rows={3} value={announcementDraft.links} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, links: event.target.value })} />
                    </label>
                  </div>
                  <button className="admin-button" disabled={saving} type="submit">{saving ? 'Guardando…' : 'Guardar borrador'}</button>
                </form>

                <div className="admin-record-list">
                  <h2>Anuncios e histórico</h2>
                  {announcements.length === 0 && <p className="admin-empty">Aún no hay anuncios guardados.</p>}
                  {announcements.map((announcement) => (
                    <article className="admin-record" key={announcement.id}>
                      <div className="admin-record__copy">
                        <div className="admin-record__meta">
                          <span>{announcement.category}</span>
                          <span className={announcement.isPublished ? 'admin-status admin-status--published' : 'admin-status'}>{announcement.isPublished ? 'Público' : 'Borrador'}</span>
                          <time>{dateLabel(announcement.publishedAt ?? announcement.createdAt)}</time>
                        </div>
                        <h3>{announcement.title}</h3>
                        <p>{announcement.summary}</p>
                      </div>
                      <div className="admin-record__actions">
                        <button className="admin-button admin-button--quiet" type="button" disabled={saving} onClick={() => editAnnouncement(announcement)}>Editar</button>
                        <button className="admin-button" type="button" disabled={saving} onClick={() => { void changeAnnouncementPublication(announcement) }}>{announcement.isPublished ? 'Retirar' : 'Publicar'}</button>
                        {!announcement.isPublished && <button className="admin-button admin-button--danger" type="button" disabled={saving} onClick={() => deleteAnnouncement(announcement)}>Eliminar</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {tab === 'installers' && (
              <section className="admin-section">
                <form className="admin-form" onSubmit={saveInstaller}>
                  <div className="admin-section-heading">
                    <div>
                      <h2>Añadir versión al histórico</h2>
                      <p>Se guardará como borrador. El catálogo público conserva solo la versión que selecciones por SO y edición.</p>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <label>
                      Sistema operativo
                      <select
                        value={installerDraft.platform}
                        onChange={(event) => {
                          const platform = event.target.value as InstallerPlatform
                          setInstallerDraft({ ...installerDraft, platform, edition: EDITIONS_BY_PLATFORM[platform][0] })
                        }}
                      >
                        {INSTALLER_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}
                      </select>
                    </label>
                    <label>
                      Edición
                      <select value={installerDraft.edition} onChange={(event) => setInstallerDraft({ ...installerDraft, edition: event.target.value as InstallerEdition })}>
                        {INSTALLER_EDITIONS.filter((edition) => EDITIONS_BY_PLATFORM[installerDraft.platform].includes(edition)).map((edition) => <option key={edition} value={edition}>{editionLabel(edition)}</option>)}
                      </select>
                    </label>
                    <label>
                      Versión
                      <input required maxLength={40} placeholder="0.3.0" value={installerDraft.version} onChange={(event) => setInstallerDraft({ ...installerDraft, version: event.target.value })} />
                    </label>
                    <label>
                      URL del instalador (HTTPS)
                      <input required type="url" placeholder="https://…" value={installerDraft.installerUrl} onChange={(event) => setInstallerDraft({ ...installerDraft, installerUrl: event.target.value })} />
                    </label>
                    <label>
                      URL del checksum SHA-256 (HTTPS)
                      <input required type="url" placeholder="https://…" value={installerDraft.checksumUrl} onChange={(event) => setInstallerDraft({ ...installerDraft, checksumUrl: event.target.value })} />
                    </label>
                    <label>
                      URL de la release / publicación (HTTPS)
                      <input required type="url" placeholder="https://…" value={installerDraft.releaseUrl} onChange={(event) => setInstallerDraft({ ...installerDraft, releaseUrl: event.target.value })} />
                    </label>
                  </div>
                  <button className="admin-button" disabled={saving} type="submit">{saving ? 'Guardando…' : 'Añadir al histórico'}</button>
                </form>

                <div className="admin-catalog">
                  <div className="admin-section-heading">
                    <div>
                      <h2>Histórico completo de instaladores</h2>
                      <p>Se importa el historial de releases de GitHub. Linux y macOS permanecen sin publicar hasta verificar su empaquetado y activos oficiales.</p>
                    </div>
                    <button className="admin-button admin-button--quiet" type="button" disabled={saving} onClick={() => { void importInstallerHistory() }}>
                      Sincronizar historial
                    </button>
                  </div>
                  {groupedInstallers.map(({ platform, editions }) => (
                    <section className="admin-platform-group" key={platform}>
                      <h3>{platformLabel(platform)}</h3>
                      {editions.map(({ edition, entries }) => (
                        <div className="admin-edition-group" key={`${platform}-${edition}`}>
                          <h4>{editionLabel(edition)} <span>{entries.length} versiones</span></h4>
                          {entries.length === 0 ? <p className="admin-empty">Sin versiones registradas.</p> : entries.map((installer) => (
                            <article className="admin-installer-row" key={installer.id}>
                              <div>
                                <strong>v{installer.version}</strong>
                                {installer.isPrerelease && <span className="admin-status">Pre-release</span>}
                                <span className={installer.isPublished ? 'admin-status admin-status--published' : 'admin-status'}>{installer.isPublished ? 'Público' : 'Histórico'}</span>
                                <small>Release {dateLabel(installer.releaseDate)}</small>
                                <a href={installer.releaseUrl} target="_blank" rel="noreferrer">Ver release</a>
                                {installer.installerUrl && <a href={installer.installerUrl} target="_blank" rel="noreferrer">Instalador</a>}
                                {!installer.installerUrl && <small>Instalador no disponible en GitHub</small>}
                                {!installer.checksumUrl && <small>Checksum no disponible</small>}
                              </div>
                              <div className="admin-record__actions">
                                {installer.checksumUrl && <a className="admin-button admin-button--quiet" href={installer.checksumUrl} target="_blank" rel="noreferrer">Checksum</a>}
                                <button
                                  className="admin-button"
                                  type="button"
                                  disabled={saving || !installer.installerUrl || !installer.checksumUrl || installer.isPrerelease || (!installer.isPublished && (platform === 'linux' || platform === 'macos')) || (installer.isPublished && platform === 'windows' && edition !== 'mobile')}
                                  title={!installer.isPublished && (platform === 'linux' || platform === 'macos') ? 'Requiere un workflow de empaquetado y activos oficiales verificados.' : !installer.installerUrl || !installer.checksumUrl ? 'El instalador y checksum deben existir antes de publicar.' : installer.isPrerelease ? 'Las versiones prerelease no se pueden publicar.' : installer.isPublished && platform === 'windows' && edition !== 'mobile' ? 'Publica un reemplazo para cambiar la versión pública.' : undefined}
                                  onClick={() => { void changeInstallerPublication(installer) }}
                                >
                                  {installer.isPublished ? 'Versión pública' : 'Publicar esta versión'}
                                </button>
                                {!installer.isPublished && <button className="admin-button admin-button--danger" type="button" disabled={saving} onClick={() => deleteInstaller(installer)}>Eliminar</button>}
                              </div>
                            </article>
                          ))}
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </section>
            )}

            {tab === 'ranks' && profile.rank === 'master-admin' && (
              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>Asignar administradores</h2>
                    <p>Solo master-admin puede cambiar rangos. El rango master-admin no se puede reasignar desde este panel.</p>
                  </div>
                </div>
                <div className="admin-record-list">
                  {profiles.map((item) => (
                    <article className="admin-record admin-profile-row" key={item.profileId}>
                      <div className="admin-record__copy">
                        <h3>{item.displayName}</h3>
                        <p>@{item.githubLogin}</p>
                      </div>
                      <label>
                        Rango
                        <select
                          value={item.rank === 'master-admin' ? 'master-admin' : item.rank}
                          disabled={saving || item.rank === 'master-admin'}
                          onChange={(event) => { void assignRank(item, event.target.value as 'user' | 'admin') }}
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                          {item.rank === 'master-admin' && <option value="master-admin">master-admin</option>}
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="admin-denied">
            <h2>Acceso reservado a administradores</h2>
            <p>{error ?? 'Tu rango actual no permite administrar la landing.'}</p>
            <Link to="/">Volver a HELIX</Link>
          </section>
        )}
      </main>
    </div>
  )
}

function platformLabel(platform: InstallerPlatform): string {
  return { windows: 'Windows', linux: 'Linux', macos: 'macOS', android: 'Android', ios: 'iOS' }[platform]
}

function editionLabel(edition: InstallerEdition): string {
  return { normal: 'Normal', lite: 'Lite', mobile: 'Móvil' }[edition]
}
