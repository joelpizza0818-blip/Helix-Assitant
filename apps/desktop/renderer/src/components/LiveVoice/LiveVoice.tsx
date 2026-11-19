import React, { useEffect, useState } from 'react'
import { useVoiceSession, VoiceState } from '../../hooks/useVoiceSession'
import { HelixNucleus } from './HelixNucleus'
import { HelixLogo } from '../HelixLogo/HelixLogo'
import './LiveVoice.css'

interface LiveVoiceProps {
  isOpen: boolean
  isSuppressed: boolean
  onSuppressionChange: (suppressed: boolean) => void | Promise<void>
  silenceMs: number
  onClose: () => void
  onSwitchToChat?: (conversationId?: string) => void
}

function getStateLabel(state: VoiceState): string {
  switch (state) {
    case 'INITIALIZING':
      return 'Conectando con Helix...'
    case 'LISTENING':
      return 'Escuchando tu voz...'
    case 'PROCESSING':
      return 'Comprendiendo audio...'
    case 'THINKING':
      return 'Helix está pensando...'
    case 'SPEAKING':
      return 'Helix está hablando'
    case 'AWAITING_CONFIRMATION':
      return 'Esperando tu confirmación'
    case 'INTERRUPTED':
      return 'Interrumpido · Escuchando...'
    case 'MUTED':
      return 'Micrófono silenciado'
    case 'ERROR':
      return 'Error de audio local'
    case 'STOPPING':
      return 'Finalizando sesión...'
    default:
      return 'En espera'
  }
}

export const LiveVoice: React.FC<LiveVoiceProps> = ({
  isOpen,
  isSuppressed,
  onSuppressionChange,
  silenceMs,
  onClose,
  onSwitchToChat,
}) => {
  const {
    sessionId,
    conversationId,
    state,
    isMuted,
    audioLevel,
    transcript,
    lastUserSpeech,
    lastAssistantSpeech,
    pendingConfirmation,
    error,
    startSession,
    stopSession,
    toggleMute,
    interrupt,
    confirmAction,
  } = useVoiceSession({ silenceMs })

  const [hasStarted, setHasStarted] = useState(false)
  const [nucleusSize, setNucleusSize] = useState(400)

  // The same overlay works in the compact 420x640 floating window and in the
  // expanded 920x720 Live Voice window, so the nucleus has to follow the
  // available space instead of assuming a fixed size.
  useEffect(() => {
    if (!isOpen) return

    const updateSize = () => {
      if (isSuppressed) {
        setNucleusSize(
          Math.max(100, Math.min(284, window.innerWidth - 16, window.innerHeight - 16)),
        )
        return
      }
      const verticalChrome = pendingConfirmation ? 350 : 320
      const available = Math.max(180, window.innerHeight - verticalChrome)
      setNucleusSize(Math.round(Math.min(460, window.innerWidth - 64, available)))
    }

    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [isOpen, isSuppressed, pendingConfirmation])

  // Start live session when opened
  useEffect(() => {
    if (isOpen && !hasStarted) {
      setHasStarted(true)
      void startSession('live')
    } else if (!isOpen && hasStarted) {
      setHasStarted(false)
      void stopSession()
    }
  }, [isOpen, hasStarted, startSession, stopSession])

  // Clean exit and switch back to text chat seamlessly
  const handleExitToChat = async () => {
    await stopSession()
    onClose()
    onSwitchToChat?.(conversationId || undefined)
  }

  const handleEndCall = async () => {
    await stopSession()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className={`live-voice-overlay${isSuppressed ? ' live-voice-overlay--suppressed' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      {/* ── Top Header ────────────────────────────────────────── */}
      <header className="live-voice-header">
        <div className="live-voice-brand">
          <HelixLogo size="sm" showText={true} />
          <div className="live-voice-mode-badge">
            <span className={`live-voice-status-dot ${state.toLowerCase()}`} />
            <span>Live Voice</span>
          </div>
        </div>

        <div className="live-voice-header-actions">
          <button
            type="button"
            className="live-voice-suppress-btn"
            onClick={() => void onSuppressionChange(true)}
            title="Mostrar solo el núcleo"
            aria-label="Mostrar solo el núcleo"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </button>
          <button
            type="button"
            className="live-voice-switch-btn"
            onClick={handleExitToChat}
            title="Continuar esta conversación mediante texto en el chat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Continuar en chat</span>
          </button>
          <button
            type="button"
            className="live-voice-close-icon-btn"
            onClick={handleEndCall}
            title="Cerrar llamada"
            aria-label="Cerrar llamada"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Center Stage: 3D Energetic Nucleus ─────────────────── */}
      <main className="live-voice-stage">
        <div className="live-voice-state-label">
          <span className={`live-voice-state-pulse ${state.toLowerCase()}`} />
          <span>{getStateLabel(state)}</span>
        </div>

        <div
          className="live-voice-nucleus"
          onDoubleClick={
            isSuppressed ? () => void onSuppressionChange(false) : undefined
          }
        >
          <HelixNucleus state={state} audioLevel={audioLevel} size={nucleusSize} />
        </div>

        {error && (
          <div className="live-voice-error-banner">
            {error}
          </div>
        )}
      </main>

      {/* ── Universal Confirmation Card ───────────────────────── */}
      {pendingConfirmation && (
        <section className="live-voice-confirmation-card" aria-live="polite">
          <div className="live-voice-confirmation-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Confirmación requerida</span>
          </div>

          <div className="live-voice-confirmation-speech">
            {pendingConfirmation.speechText || `¿Quieres autorizar la acción "${pendingConfirmation.action}"?`}
          </div>

          {pendingConfirmation.whatWillChange && (
            <div className="live-voice-confirmation-details">
              <strong>Cambio propuesto:</strong> {pendingConfirmation.whatWillChange}
            </div>
          )}

          <div className="live-voice-confirmation-actions">
            <span className="live-voice-voice-hint">
              Puedes responder con naturalidad; te escucharé si quieres continuar o cancelar
            </span>
            <button
              type="button"
              className="live-voice-confirm-btn reject"
              onClick={() => void confirmAction('reject')}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="live-voice-confirm-btn approve"
              onClick={() => void confirmAction('approve')}
            >
              Aprobar acción
            </button>
          </div>
        </section>
      )}

      {/* ── Subtitles / Live Transcript Area ──────────────────── */}
      {!pendingConfirmation && (
        <section className="live-voice-transcript-container" aria-live="polite">
          {transcript ? (
            <div className="live-voice-user-transcript">
              “{transcript}”
            </div>
          ) : state === 'SPEAKING' && lastAssistantSpeech ? (
            <div className="live-voice-assistant-speech">
              {lastAssistantSpeech}
            </div>
          ) : lastUserSpeech ? (
            <div className="live-voice-user-transcript">
              “{lastUserSpeech}”
            </div>
          ) : (
            <div className="live-voice-placeholder-text">
              Habla con naturalidad; puedes continuar, cambiar de tema o interrumpir mientras Helix responde.
            </div>
          )}
        </section>
      )}

      {/* ── Bottom Call Controls ──────────────────────────────── */}
      <footer className="live-voice-controls">
        {/* Mute Button */}
        <button
          type="button"
          className={`live-voice-control-btn ${isMuted ? 'active-mute' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
        >
          {isMuted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          <span className="live-voice-btn-label">{isMuted ? 'Silenciado' : 'Mute'}</span>
        </button>

        {/* Interrupt / Barge-in Button (Active when Helix is speaking) */}
        {['SPEAKING', 'THINKING', 'PROCESSING'].includes(state) && (
          <button
            type="button"
            className="live-voice-control-btn interrupt"
            onClick={interrupt}
            title="Interrumpir y hablar"
            aria-label="Interrumpir y hablar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            <span className="live-voice-btn-label">Interrumpir</span>
          </button>
        )}

        {/* End Session Button */}
        <button
          type="button"
          className="live-voice-control-btn end-call"
          onClick={handleEndCall}
          title="Finalizar llamada de voz"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.8 19.8 0 0 1-3.12-8.68A2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.98 9.91" transform="rotate(135 12 12)" />
          </svg>
          <span className="live-voice-btn-label">Finalizar</span>
        </button>
      </footer>
    </div>
  )
}
