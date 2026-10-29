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
      <p className="toolbox-section__desc">Vincula tu cuenta de GitHub para sincronizar perfil y permisos.</p>
      {!configured && <p className="toolbox-error" role="alert">El inicio de sesión OAuth no está configurado en esta compilación.</p>}
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      {!profile ? (
        <div className="toolbox-card">
          <p className="text-xs text-muted" style={{ marginBottom: '12px' }}>
            Inicia sesión con GitHub para vincular tu identidad y credenciales.
          </p>
          <button type="button" className="validate-btn" disabled={!configured || busy || oauthPending} onClick={onSignIn}>
            {busy ? 'Abriendo GitHub…' : oauthPending ? 'Esperando autorización…' : 'Continuar con GitHub'}
          </button>
          {oauthPending && (
            <button type="button" className="refresh-btn" style={{ marginLeft: '8px' }} onClick={onCancelSignIn}>
              Cancelar espera
            </button>
          )}
        </div>
      ) : (
        <div className="toolbox-card helix-profile-card">
          <div className="helix-profile-header">
            {profile.avatarUrl
              ? <img className="helix-profile-avatar" src={profile.avatarUrl} alt={`Avatar de ${profile.githubLogin}`} />
              : <div className="helix-profile-avatar helix-profile-avatar--placeholder">{profile.githubLogin.slice(0, 1).toUpperCase()}</div>}
            <div className="helix-profile-info">
              <strong className="helix-profile-name">{profile.displayName || profile.githubLogin}</strong>
              <span className="helix-profile-handle">@{profile.githubLogin}</span>
              <span className="status-badge status-badge--healthy helix-profile-rank">{profile.rank}</span>
            </div>
          </div>

          <div className="helix-profile-body">
            <div className="form-row" style={{ margin: '16px 0 12px' }}>
              <label className="form-label" htmlFor="profile-display-name">Nombre visible</label>
              <input
                id="profile-display-name"
                className="form-input"
                value={displayName}
                maxLength={80}
                placeholder="Nombre para HELIX"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

            <div className="helix-profile-id-row">
              <div className="helix-profile-id-box">
                <span className="helix-profile-id-label">ID DE PERFIL</span>
                <code className="text-mono">{profile.profileId}</code>
              </div>
              <div className="helix-profile-id-box">
                <span className="helix-profile-id-label">ID DE GITHUB</span>
                <code className="text-mono">{profile.githubUserId ?? 'Pendiente de vincular'}</code>
              </div>
            </div>

            {saveError && <p className="toolbox-error" role="alert" style={{ marginTop: '10px' }}>{saveError}</p>}
            {saved && <p className="text-xs text-muted" role="status" style={{ marginTop: '10px' }}>Nombre guardado.</p>}

            <div className="helix-profile-actions">
              <button type="button" className="validate-btn" disabled={busy || !displayName.trim()} onClick={() => void saveName()}>
                Guardar nombre
              </button>
              <button type="button" className="toolbox-danger-button" disabled={busy} onClick={onSignOut}>
                Desconectar GitHub
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
