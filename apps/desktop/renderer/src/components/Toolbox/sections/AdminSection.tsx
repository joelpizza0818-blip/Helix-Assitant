import { useEffect, useState } from 'react'
import type { AdminBackup, AdminConfig } from '../../../types/global'
import '../Toolbox.css'

const emptyConfig: AdminConfig = { autoUpdate: true, checkIntervalHours: 24, channel: 'stable', publicVersion: '', backups: [] }

export default function AdminSection() {
  const [config, setConfig] = useState<AdminConfig>(emptyConfig)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.helix.getAdminConfig().then((loaded) => {
      setConfig(loaded)
      setSyncStatus(loaded.synced ? 'Shared release policy loaded.' : loaded.syncError || 'Using this device’s local policy.')
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load admin configuration.'))
  }, [])

  const save = async () => {
    setError(null)
    setIsSaving(true)
    try {
      const updated = await window.helix.saveAdminConfig(config)
      setConfig(updated)
      setSaved(updated.synced === true)
      setSyncStatus(updated.synced ? 'Public release policy updated.' : updated.syncError || 'Saved on this device only; shared policy was not changed.')
      window.setTimeout(() => setSaved(false), 1600)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save admin configuration.')
    } finally {
      setIsSaving(false)
    }
  }
  const backup = async () => {
    setError(null)
    try {
      const created = await window.helix.createVersionBackup(version)
      setConfig((current) => ({ ...current, backups: [created, ...current.backups.filter((item) => item.version !== created.version)] }))
      setVersion('')
      setSyncStatus(created.synced ? `Verified release ${created.version} and saved backup record.` : created.syncError || 'Backup record was saved locally only.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create backup.')
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Admin</h2>
      <p className="toolbox-section__desc">
        GitHub admin: joelpizza0818-blip. Changes require a running HELIX API server and a verified release in the private installer repository.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      {syncStatus && <p className="text-xs text-muted" role="status">{syncStatus}</p>}
      <div className="toolbox-card">
        <label className="toggle">
          <input type="checkbox" checked={config.autoUpdate} onChange={(event) => setConfig({ ...config, autoUpdate: event.target.checked })} />
          <span className="toggle__slider" />
          Automatic updates
        </label>
        <p className="text-xs text-muted">Disables scheduled checks on clients when the shared policy sync succeeds. Users can still check for updates manually.</p>
        <div className="form-row">
          <label className="form-label" htmlFor="update-channel">Channel</label>
          <select id="update-channel" className="form-input" value={config.channel} onChange={(event) => setConfig({ ...config, channel: event.target.value as AdminConfig['channel'] })}>
            <option value="stable">Stable</option><option value="beta">Beta</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="update-interval">Check every hours</label>
          <input id="update-interval" className="form-input" type="number" min="1" max="720" value={config.checkIntervalHours} onChange={(event) => setConfig({ ...config, checkIntervalHours: Number(event.target.value) })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="public-version">Public version</label>
          <input id="public-version" className="form-input" value={config.publicVersion} onChange={(event) => setConfig({ ...config, publicVersion: event.target.value })} placeholder="0.1.3" />
        </div>
        <button type="button" className="validate-btn" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : saved ? 'Saved' : 'Save admin policy'}
        </button>
      </div>
      <div className="toolbox-card">
        <div className="toolbox-card__title">Version backups</div>
        <p className="text-xs text-muted">Register a verified release as a known-good version. Select its version above and save the policy to roll back the public release.</p>
        <div className="form-row">
          <label className="form-label" htmlFor="backup-version">Version</label>
          <input id="backup-version" className="form-input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.2" />
        </div>
        <button type="button" className="validate-btn" disabled={!version.trim()} onClick={() => void backup()}>Create backup record</button>
        {config.backups.map((item: AdminBackup) => (
          <p className="text-xs text-muted" key={`${item.version}-${item.createdAt}`}>
            ✓ {item.version} · {new Date(item.createdAt).toLocaleString()}
            {' '}<button type="button" className="validate-btn" onClick={() => setConfig((current) => ({ ...current, publicVersion: item.version }))}>Select</button>
          </p>
        ))}
      </div>
    </section>
  )
}
