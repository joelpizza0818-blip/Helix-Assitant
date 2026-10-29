import { useCallback, useEffect, useState } from 'react'
import type {
  CapabilityPackState,
  CapabilityDownloadProgress,
  CapabilitySnapshot,
  InstallationProfile,
} from '../../../types/global'

export default function CapabilitiesSection() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<CapabilityDownloadProgress | null>(null)

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
  useEffect(() => window.helix.onCapabilityDownloadProgress((progress) => {
    setDownloadProgress(progress)
  }), [])

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
    setDownloadProgress({
      id: pack.id,
      receivedBytes: 0,
      totalBytes: pack.sizeBytes,
      status: 'downloading',
    })
    try {
      const { status: _status, installedPath: _installedPath, error: _error, ...manifest } = pack
      await window.helix.installCapability(manifest)
      await refresh()
      setDownloadProgress(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not install ${pack.capability}.`)
      setDownloadProgress(null)
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (pack: CapabilityPackState) => {
    setError(null)
    await window.helix.cancelCapability(pack.id)
  }

  if (!snapshot) {
    return (
      <section className="toolbox-card">
        <h2 className="toolbox-card__title">Capabilities & installation</h2>
        {error ? (
          <p className="toolbox-error" role="alert">{error}</p>
        ) : (
          <div className="toolbox__loading">Loading capabilities...</div>
        )}
        <button type="button" className="validate-btn" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    )
  }

  return (
    <section className="toolbox-card">
      <h2 className="toolbox-card__title">Capabilities & installation</h2>
      <p className="text-xs text-muted">
        Packs are accepted only after HTTPS, signature, size and SHA-256 validation. Downloads are staged atomically.
      </p>
      <p className="text-xs text-muted">
        Signed pack installation also requires HELIX_CAPABILITY_PUBLIC_KEY in the Desktop process environment. Configure the trusted public key and restart HELIX; signature checks cannot be disabled.
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
                <>
                  <span role="status">
                    {downloadProgress?.id === pack.id && downloadProgress.totalBytes > 0
                      ? `${Math.min(100, Math.round(downloadProgress.receivedBytes / downloadProgress.totalBytes * 100))}%`
                      : 'Installing...'}
                  </span>
                  <button type="button" className="validate-btn" onClick={() => void cancel(pack)}>
                    Cancel download
                  </button>
                </>
              ) : (
                <button type="button" className="validate-btn" disabled={busy !== null} onClick={() => void install(pack)}>
                  Install ({Math.ceil(pack.sizeBytes / 1024 / 1024)} MB)
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {snapshot.profile === 'complete' && snapshot.requiredMissingCount > 0 && (
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
