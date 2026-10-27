import { useEffect, useState } from 'react'
import type { MobilePairingInvitation } from '../../../types/global'
import '../Toolbox.css'

function formatExpiry(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function MobileSection() {
  const [invitation, setInvitation] = useState<MobilePairingInvitation | null>(null)
  const [busy, setBusy] = useState(false)
  const [relayUrl, setRelayUrl] = useState('')
  const [relayBusy, setRelayBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.helix.getMobileRelayUrl()
      .then((value) => {
        if (active) setRelayUrl(value)
      })
      .catch(() => {
        // Relay is optional; SSH pairing remains available when no URL is configured.
      })
    return () => {
      active = false
    }
  }, [])

  const createPairing = async () => {
    setBusy(true)
    setError(null)
    try {
      setInvitation(await window.helix.createMobilePairing())
      setCopied(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la vinculación móvil.')
    } finally {
      setBusy(false)
    }
  }

  const copyInvitation = async () => {
    if (!invitation) return
    const text = JSON.stringify({
      version: invitation.version,
      host: invitation.host,
      sshPort: invitation.sshPort,
      remoteWsPort: invitation.remoteWsPort,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      ...(invitation.relayWssUrl ? { relayWssUrl: invitation.relayWssUrl } : {}),
    }, null, 2)
    try {
      await window.helix.copyTextToClipboard(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo copiar la invitación.')
    }
  }

  const saveRelayUrl = async () => {
    setRelayBusy(true)
    setError(null)
    try {
      const saved = await window.helix.setMobileRelayUrl(relayUrl.trim())
      setRelayUrl(saved)
      setInvitation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la URL del Relay.')
    } finally {
      setRelayBusy(false)
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Mobile Link</h2>
      <p className="toolbox-section__desc">
        El relay enruta mensajes hacia el agente local. El pairing actual no limita permisos por dispositivo; úsalo solo entre tus propios dispositivos y no envíes datos sensibles.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Relay preferido</span>
          <span className="text-xs text-muted">WSS en producción</span>
        </div>
        <p className="text-xs text-muted">
          Configura el endpoint del relay para que el teléfono no dependa de abrir SSH en tu red. Usa <code>wss://</code> detrás de TLS; <code>ws://</code> sirve solo para pruebas locales.
        </p>
        <label className="form-label" htmlFor="mobile-relay-url">URL del Relay</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="mobile-relay-url"
            className="form-input"
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
            placeholder="wss://relay.example.com/mobile"
            spellCheck={false}
            inputMode="url"
          />
          <button type="button" className="validate-btn" disabled={relayBusy} onClick={() => void saveRelayUrl()}>
            {relayBusy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Invitación de dispositivo</span>
          <span className="text-xs text-muted">30 min · se invalida al rotar</span>
        </div>
        <p className="text-xs text-muted">
          Genera una invitación para vincular un teléfono. Al generar otra, el token anterior queda invalidado; todavía no hay revocación individual por dispositivo.
        </p>
        {invitation && (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            <div className="form-row"><span className="form-label">Host SSH</span><code>{invitation.host}:{invitation.sshPort}</code></div>
            <div className="form-row"><span className="form-label">WebSocket local</span><code>127.0.0.1:{invitation.remoteWsPort}</code></div>
            <div className="form-row"><span className="form-label">Relay</span><span>{invitation.relayWssUrl ?? 'No configurado · se usará SSH'}</span></div>
            <div className="form-row"><span className="form-label">Expira</span><span>{formatExpiry(invitation.expiresAt)}</span></div>
            <label className="form-label" htmlFor="mobile-pairing-token">Token temporal</label>
            <input id="mobile-pairing-token" className="form-input" value={invitation.token} readOnly />
            <button type="button" className="validate-btn" onClick={() => void copyInvitation()}>
              {copied ? 'Invitación copiada' : 'Copiar configuración móvil'}
            </button>
          </div>
        )}
        <button type="button" className="validate-btn" disabled={busy} onClick={() => void createPairing()} style={{ marginTop: 14 }}>
          {busy ? 'Generando…' : invitation ? 'Rotar invitación' : 'Generar invitación'}
        </button>
      </div>
      <div className="toolbox-card">
        <div className="toolbox-card__title">Checklist de conexión</div>
        <ol className="text-xs text-muted" style={{ lineHeight: 1.6, paddingLeft: 20 }}>
          <li>Activa un servidor SSH en el Desktop y permite el puerto 22 solo en tu red privada.</li>
          <li>En móvil, selecciona SSH seguro y pega la invitación; añade la clave privada y la huella del host.</li>
          <li>Prueba primero <code>GET_TASKS</code>; después envía una instrucción desde el chat.</li>
        </ol>
      </div>
    </section>
  )
}
