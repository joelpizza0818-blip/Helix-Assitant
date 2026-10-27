import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type {
  MobileDevice,
  MobilePairingInvitation,
  MobilePairingRequest,
  MobileTextRequest,
} from '../../../types/global'
import '../Toolbox.css'

const DEFAULT_MOBILE_WORKER_URL = 'https://helix-mobile-relay.joelpizza0818.workers.dev'

function formatExpiry(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function invitationPayload(invitation: MobilePairingInvitation): string {
  return JSON.stringify({
    version: invitation.version,
    host: invitation.host,
    sshPort: invitation.sshPort,
    remoteWsPort: invitation.remoteWsPort,
    token: invitation.token,
    expiresAt: invitation.expiresAt,
    ...(invitation.relayWssUrl ? { relayWssUrl: invitation.relayWssUrl } : {}),
    ...(invitation.requiresDeviceApproval ? { requiresDeviceApproval: true } : {}),
  })
}

export default function MobileSection() {
  const [invitation, setInvitation] = useState<MobilePairingInvitation | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [workerUrl, setWorkerUrl] = useState(DEFAULT_MOBILE_WORKER_URL)
  const [workerConfigured, setWorkerConfigured] = useState(false)
  const [workerConnected, setWorkerConnected] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [pairingRequests, setPairingRequests] = useState<MobilePairingRequest[]>([])
  const [textRequests, setTextRequests] = useState<MobileTextRequest[]>([])
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invitationExpired = invitation !== null && Date.parse(invitation.expiresAt) <= now

  useEffect(() => {
    let active = true
    const unsubscribePairings = window.helix.onMobilePairingRequest?.((request) => {
      setPairingRequests((current) => [
        ...current.filter((item) => item.request_id !== request.request_id),
        request,
      ])
    })
    const unsubscribeText = window.helix.onMobileTextRequest?.((request) => {
      setTextRequests((current) => [
        ...current.filter((item) => item.request_id !== request.request_id),
        request,
      ])
    })
    const unsubscribeStatus = window.helix.onMobileRelayStatus?.((status) => {
      setWorkerConfigured(status.configured)
      setWorkerConnected(status.connected)
      if (status.configured && status.connected) {
        void window.helix.getMobileDevices()
          .then(setDevices)
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los dispositivos.')
          })
      }
    })
    void Promise.all([
      window.helix.getMobileWorkerUrl(),
      window.helix.getMobileRelayStatus(),
    ]).then(async ([url, status]) => {
      if (!active) return
      setWorkerUrl(url || DEFAULT_MOBILE_WORKER_URL)
      setWorkerConfigured(status.configured)
      setWorkerConnected(status.connected)
      if (status.configured) {
        const [nextDevices, pendingPairings, pendingTexts] = await Promise.all([
          window.helix.getMobileDevices(),
          window.helix.getMobilePairings?.() ?? Promise.resolve([]),
          window.helix.getMobileTextRequests?.() ?? Promise.resolve([]),
        ])
        if (!active) return
        setDevices(nextDevices)
        setPairingRequests(pendingPairings)
        setTextRequests(pendingTexts)
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el estado del relay.')
    })
    return () => {
      active = false
      unsubscribePairings?.()
      unsubscribeText?.()
      unsubscribeStatus?.()
    }
  }, [])

  useEffect(() => {
    if (!invitation) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [invitation])

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
    if (invitationExpired) {
      setError('La invitación expiró. Genera otra antes de escanear o copiarla.')
      return
    }
    try {
      await window.helix.copyTextToClipboard(JSON.stringify(JSON.parse(invitationPayload(invitation)), null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo copiar la invitación.')
    }
  }

  const saveWorkerUrl = async () => {
    setWorkerBusy(true)
    setError(null)
    try {
      const saved = await window.helix.setMobileWorkerUrl(workerUrl.trim())
      const status = await window.helix.getMobileRelayStatus()
      setWorkerUrl(saved)
      setWorkerConfigured(status.configured)
      setWorkerConnected(status.connected)
      setDevices(status.configured ? await window.helix.getMobileDevices() : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la URL del Worker.')
    } finally {
      setWorkerBusy(false)
    }
  }

  const revokeDevice = async (device: MobileDevice) => {
    if (!window.confirm(`¿Revocar el acceso de "${device.device_name}"?`)) return
    setWorkerBusy(true)
    setError(null)
    try {
      await window.helix.revokeMobileDevice(device.device_id)
      setDevices(await window.helix.getMobileDevices())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo revocar el dispositivo.')
    } finally {
      setWorkerBusy(false)
    }
  }

  const resolvePairing = async (request: MobilePairingRequest, approved: boolean) => {
    if (!window.helix.resolveMobilePairing) return
    setWorkerBusy(true)
    setError(null)
    try {
      await window.helix.resolveMobilePairing(request.request_id, approved)
      setPairingRequests((current) => current.filter((item) => item.request_id !== request.request_id))
      if (approved) setDevices(await window.helix.getMobileDevices())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo resolver la solicitud de vinculación.')
    } finally {
      setWorkerBusy(false)
    }
  }

  const resolveTextRequest = async (request: MobileTextRequest, approved: boolean) => {
    if (!window.helix.resolveMobileTextRequest) return
    setWorkerBusy(true)
    setError(null)
    try {
      await window.helix.resolveMobileTextRequest(request.request_id, approved)
      setTextRequests((current) => current.filter((item) => item.request_id !== request.request_id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo resolver el mensaje móvil.')
    } finally {
      setWorkerBusy(false)
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Mobile Link</h2>
      <p className="toolbox-section__desc">
        Cada dispositivo requiere aprobación en Desktop. Además, cada mensaje remoto muestra una confirmación local antes de llegar al agente.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Cloudflare Worker Relay</span>
          <span className="text-xs text-muted">
            {workerConfigured ? (workerConnected ? 'Conectado' : 'Desconectado') : 'No configurado'}
          </span>
        </div>
        <p className="text-xs text-muted">
          La dirección del relay HELIX está preconfigurada. Puedes cambiarla por un Worker propio; Desktop mantiene una conexión saliente y no requiere abrir puertos.
        </p>
        <label className="form-label" htmlFor="mobile-worker-url">URL del Worker</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="mobile-worker-url"
            className="form-input"
            value={workerUrl}
            onChange={(event) => setWorkerUrl(event.target.value)}
            placeholder="https://helix-mobile-relay.<cuenta>.workers.dev"
            spellCheck={false}
            inputMode="url"
          />
          <button type="button" className="validate-btn" disabled={workerBusy} onClick={() => void saveWorkerUrl()}>
            {workerBusy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {devices.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
            <span className="toolbox-card__title">Dispositivos vinculados</span>
            {devices.map((device) => (
              <div key={device.device_id} className="form-row">
                <span>{device.device_name}</span>
                <button
                  type="button"
                  className="validate-btn"
                  disabled={workerBusy}
                  onClick={() => void revokeDevice(device)}
                >
                  Revocar
                </button>
              </div>
            ))}
          </div>
        )}
        {pairingRequests.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }} aria-live="polite">
            <span className="toolbox-card__title">Solicitudes de vinculación</span>
            {pairingRequests.map((request) => (
              <div key={request.request_id} className="form-row">
                <span>{request.device_name} solicita acceso</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="validate-btn"
                    disabled={workerBusy}
                    onClick={() => void resolvePairing(request, false)}
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    className="validate-btn"
                    disabled={workerBusy}
                    onClick={() => void resolvePairing(request, true)}
                  >
                    Aprobar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {textRequests.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }} aria-live="polite">
            <span className="toolbox-card__title">Mensajes móviles pendientes</span>
            {textRequests.map((request) => (
              <div key={request.request_id} className="toolbox-card" style={{ display: 'grid', gap: 8 }}>
                <span className="form-label">{request.device_name}</span>
                <p className="text-xs text-muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {request.text.length > 1200 ? `${request.text.slice(0, 1200)}…` : request.text}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="validate-btn"
                    disabled={workerBusy}
                    onClick={() => void resolveTextRequest(request, false)}
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    className="validate-btn"
                    disabled={workerBusy}
                    onClick={() => void resolveTextRequest(request, true)}
                  >
                    Enviar al agente
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Invitación de dispositivo</span>
          <span className="text-xs text-muted">
            {invitation ? '5 min · un solo uso' : 'Requiere Worker conectado'}
          </span>
        </div>
        <p className="text-xs text-muted">
          El QR y la alternativa manual comparten una invitación de un solo uso. El token temporal se canjea por credenciales individuales solo después de aprobar el dispositivo.
        </p>
        {invitation && (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            <div className="form-row"><span className="form-label">Relay</span><code>{invitation.relayWssUrl}</code></div>
            <p className="text-xs text-muted">Escanea este QR desde HELIX Mobile o pega la invitación manual antes de que expire.</p>
            {!invitationExpired && (
              <div
                role="img"
                aria-label="QR temporal para vincular HELIX Mobile"
                style={{ display: 'grid', placeItems: 'center', padding: 16, background: '#fff', borderRadius: 8 }}
              >
                <QRCodeSVG value={invitationPayload(invitation)} size={224} includeMargin />
              </div>
            )}
            <div className="form-row"><span className="form-label">Expira</span><span>{formatExpiry(invitation.expiresAt)}</span></div>
            {invitationExpired
              ? <p className="toolbox-error" role="status">QR expirado. Genera una invitación nueva.</p>
              : (
                <>
                  <label className="form-label" htmlFor="mobile-pairing-token">Token temporal</label>
                  <input id="mobile-pairing-token" className="form-input" value={invitation.token} readOnly />
                  <button type="button" className="validate-btn" onClick={() => void copyInvitation()}>
                    {copied ? 'Invitación copiada' : 'Copiar alternativa manual'}
                  </button>
                </>
              )}
          </div>
        )}
        <button
          type="button"
          className="validate-btn"
          disabled={busy || !workerConnected}
          onClick={() => void createPairing()}
          style={{ marginTop: 14 }}
        >
          {busy ? 'Generando…' : invitation ? 'Rotar invitación' : 'Generar QR de vinculación'}
        </button>
        {!workerConnected && <p className="text-xs text-muted">Configura y conecta el Worker Relay para habilitar el QR seguro.</p>}
      </div>
      <div className="toolbox-card">
        <div className="toolbox-card__title">Checklist de conexión</div>
        <ol className="text-xs text-muted" style={{ lineHeight: 1.6, paddingLeft: 20 }}>
          <li>Configura el Worker y genera una invitación temporal.</li>
          <li>Importa la invitación en el móvil y aprueba el dispositivo en Desktop.</li>
          <li>Aprueba cada mensaje remoto desde el equipo antes de que HELIX lo procese.</li>
        </ol>
      </div>
    </section>
  )
}
