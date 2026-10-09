import { useEffect, useState } from 'react'
import type { HelixProfile } from '../../../lib/desktopSupabase'
import '../Toolbox.css'

interface ProfilesSectionProps {
  configured: boolean
  profile: HelixProfile | null
  busy: boolean
  oauthPending: boolean
  error: string | null
  onSignIn: () => void
  onCancelSignIn: () => void
  onSignOut: () => void
  onSaveName: (name: string) => Promise<void>
}

export default function ProfilesSection({
  configured,
  profile,
  busy,
  oauthPending,
  error,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onSaveName,
}: ProfilesSectionProps) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '')
  }, [profile?.profileId, profile?.displayName])

  const saveName = async () => {
    setSaveError(null)
    setSaved(false)
    try {
      await onSaveName(displayName)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'No se pudo guardar el nombre.')
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Perfil</h2>
      <p className="toolbox-section__desc">Vincula tu cuenta de GitHub para guardar tu perfil HELIX y sus permisos de forma segura.</p>
      {!configured && <p className="toolbox-error" role="alert">El inicio de sesión OAuth no está configurado en esta compilación.</p>}
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      {!profile ? (
        <div className="toolbox-card">
          <p className="text-xs text-muted">El perfil se crea con tu nombre e imagen de GitHub. Solo tendrás que autorizar esta aplicación una vez.</p>
          <button type="button" className="validate-btn" disabled={!configured || busy || oauthPending} onClick={onSignIn}>
            {busy ? 'Abriendo GitHub…' : oauthPending ? 'Esperando autorización de GitHub…' : 'Continuar con GitHub'}
          </button>
          {oauthPending && <button type="button" className="validate-btn" onClick={onCancelSignIn}>Cancelar espera</button>}
        </div>
      ) : (
        <div className="toolbox-card helix-profile-card">
          {profile.avatarUrl
            ? <img className="helix-profile-avatar" src={profile.avatarUrl} alt={`Avatar de ${profile.githubLogin}`} />
            : <div className="helix-profile-avatar helix-profile-avatar--placeholder">{profile.githubLogin.slice(0, 1).toUpperCase()}</div>}
          <div className="helix-profile-info">
            <strong>{profile.displayName}</strong>
            <span>@{profile.githubLogin}</span>
            <span className="helix-profile-rank">{profile.rank}</span>
          </div>
          <label className="form-label" htmlFor="profile-display-name">Nombre visible</label>
          <input
            id="profile-display-name"
            className="form-input"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <div className="helix-profile-id">
            <span>ID de perfil</span>
            <code>{profile.profileId}</code>
          </div>
          <div className="helix-profile-id">
            <span>ID de GitHub</span>
            <code>{profile.githubUserId ?? 'Pendiente de vincular'}</code>
          </div>
          {saveError && <p className="toolbox-error" role="alert">{saveError}</p>}
          {saved && <p className="text-xs text-muted" role="status">Nombre guardado.</p>}
          <div className="helix-profile-actions">
            <button type="button" className="validate-btn" disabled={busy || !displayName.trim()} onClick={() => void saveName()}>Guardar nombre</button>
            <button type="button" className="validate-btn" disabled={busy} onClick={onSignOut}>Desconectar GitHub</button>
          </div>
        </div>
      )}
    </section>
  )
}
