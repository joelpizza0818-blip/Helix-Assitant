import { useCallback, useEffect, useState } from 'react'
import type {
  CapabilityPackState,
  CapabilitySnapshot,
  InstallationProfile,
} from '../../../types/global'

export default function CapabilitiesSection() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await window.helix.refreshCapabilities()
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read installed capabilities.')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const changeProfile = async (profile: InstallationProfile) => {
    setBusy('profile')
    try {
      setSnapshot(await window.helix.setInstallationProfile(profile))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the installation profile.')
    } finally {
      setBusy(null)
    }
  }

  const install = async (pack: CapabilityPackState) => {
    setBusy(pack.id)
    try {
      const { status: _status, installedPath: _installedPath, error: _error, ...manifest } = pack
      await window.helix.installCapability(manifest)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not install ${pack.capability}.`)
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (pack: CapabilityPackState) => {
    setError(null)
    await window.helix.cancelCapability(pack.id)
  }

  if (!snapshot) return <div className="toolbox__loading">Loading capabilities...</div>

  return (
    <section className="toolbox-card">
      <h2 className="toolbox-card__title">Capabilities & installation</h2>
      <p className="text-xs text-muted">
        Packs are accepted only after HTTPS, signature, size and SHA-256 validation. Downloads are staged atomically.
      </p>
      <div className="form-row">
        <label className="form-label" htmlFor="installation-profile">Installation profile</label>
        <select
          id="installation-profile"
          className="form-input"
          value={snapshot.profile}
          disabled={busy === 'profile'}
          onChange={(event) => void changeProfile(event.target.value as InstallationProfile)}
        >
          <option value="complete">Complete</option>
          <option value="progressive">Progressive</option>
        </select>
      </div>
      {snapshot.profile === 'progressive' && snapshot.missingCount > 0 && (
        <div className="toolbox-card" style={{ marginTop: 12 }}>
          <strong>Progressive capabilities unavailable</strong>
          {snapshot.packs.length === 0 && (
            <p className="toolbox-error" role="alert">
              This Lite release has no signed capability catalog. Tools requiring an optional pack will wait only until the agent reports the missing capability, then fail explicitly; no pack can be downloaded yet.
            </p>
          )}
          {snapshot.packs.filter((pack) => pack.status !== 'installed').map((pack) => (
            <div key={`${pack.id}-${pack.version}`} className="form-row">
              <span>{pack.capability} · {pack.version}</span>
              {busy === pack.id ? (
                <button type="button" className="validate-btn" onClick={() => void cancel(pack)}>
                  Cancel download
                </button>
              ) : (
                <button type="button" className="validate-btn" disabled={busy !== null} onClick={() => void install(pack)}>
                  Install ({Math.ceil(pack.sizeBytes / 1024 / 1024)} MB)
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {snapshot.profile === 'complete' && snapshot.missingCount > 0 && snapshot.packs.length > 0 && (
        <p className="text-xs text-muted" role="status">Complete installation is incomplete; repair the missing signed packs.</p>
      )}
      {snapshot.packs.length === 0 && (
        <p className="text-xs text-muted" role="status">
          No signed capability catalog is configured for this build; pack readiness cannot be verified.
        </p>
      )}
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <button type="button" className="validate-btn" onClick={() => void refresh()} disabled={busy !== null}>Refresh status</button>
    </section>
  )
}
