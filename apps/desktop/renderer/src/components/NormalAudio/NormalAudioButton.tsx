import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useMicrophone } from '../../hooks/useMicrophone'
import './NormalAudio.css'

interface NormalAudioButtonProps {
  onTranscript?: (text: string) => void
  disabled?: boolean
  className?: string
  isVoiceActive?: boolean
  isVoiceCapturing?: boolean
  onToggleVoiceActive?: () => void
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--orange, #ee6018)' : 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

interface QueuedSegment {
  index: number
  buffer: AudioBuffer
}

export const NormalAudioButton: React.FC<NormalAudioButtonProps> = ({
  onTranscript,
  disabled = false,
  className = '',
  isVoiceActive = false,
  isVoiceCapturing = false,
  onToggleVoiceActive,
}) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const isRecordingRef = useRef(false)
  const pendingCloseRef = useRef(false)

  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // Sequential TTS playback and playback acknowledgement
  const audioContextRef = useRef<AudioContext | null>(null)
  const playbackQueueRef = useRef<QueuedSegment[]>([])
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const isPlayingRef = useRef(false)
  const highestPlayedIndexRef = useRef(-1)
  const speakingEndRef = useRef(false)
  const playbackDoneSentRef = useRef(false)

  const handleAudioChunk = useCallback((pcm16: Uint8Array) => {
    const currentSession = sessionIdRef.current
    if (!currentSession || !window.helix?.voiceSend) return

    const base64Audio = uint8ToBase64(pcm16)
    void window.helix.voiceSend({
      type: 'VOICE_AUDIO_CHUNK',
      payload: {
        session_id: currentSession,
        audio_base64: base64Audio,
        sample_rate: 16000,
        channels: 1,
      },
    })
  }, [])

  const {
    startCapture,
    stopCapture,
  } = useMicrophone({
    sampleRate: 16000,
    onAudioChunk: handleAudioChunk,
  })

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioContextRef.current = new AudioCtx()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  const stopPlayback = useCallback(() => {
    const source = activeSourceRef.current
    if (source) {
      try {
        source.onended = null
        source.stop()
        source.disconnect()
      } catch {}
    }
    activeSourceRef.current = null
    playbackQueueRef.current = []
    isPlayingRef.current = false
    highestPlayedIndexRef.current = -1
    speakingEndRef.current = false
    playbackDoneSentRef.current = false
  }, [])

  const maybeSignalPlaybackDone = useCallback(() => {
    if (
      playbackDoneSentRef.current ||
      !speakingEndRef.current ||
      isPlayingRef.current ||
      playbackQueueRef.current.length > 0 ||
      highestPlayedIndexRef.current < 0
    ) {
      return
    }
    playbackDoneSentRef.current = true
    const currentSession = sessionIdRef.current
    if (currentSession && window.helix?.voiceSend) {
      void window.helix.voiceSend({
        type: 'VOICE_PLAYBACK_DONE',
        payload: {
          session_id: currentSession,
          last_index: highestPlayedIndexRef.current,
        },
      })
    }
  }, [])

  const playNext = useCallback(() => {
    if (isPlayingRef.current) return
    const next = playbackQueueRef.current.shift()
    if (!next) {
      maybeSignalPlaybackDone()
      return
    }

    isPlayingRef.current = true
    try {
      const audioCtx = getAudioContext()
      const source = audioCtx.createBufferSource()
      source.buffer = next.buffer
      source.connect(audioCtx.destination)
      activeSourceRef.current = source
      source.onended = () => {
        if (activeSourceRef.current !== source) return
        activeSourceRef.current = null
        isPlayingRef.current = false
        highestPlayedIndexRef.current = Math.max(highestPlayedIndexRef.current, next.index)
        if (playbackQueueRef.current.length > 0) {
          playNext()
        } else {
          maybeSignalPlaybackDone()
        }
      }
      source.start()
    } catch (err) {
      console.error('[NormalAudioButton] Playback failed:', err)
      isPlayingRef.current = false
      activeSourceRef.current = null
      maybeSignalPlaybackDone()
    }
  }, [getAudioContext, maybeSignalPlaybackDone])

  const enqueueSegment = useCallback(
    (index: number, base64Wav: string) => {
      try {
        const arrayBuffer = base64ToArrayBuffer(base64Wav)
        const audioCtx = getAudioContext()
        audioCtx.decodeAudioData(
          arrayBuffer,
          (buffer) => {
            playbackQueueRef.current.push({ index, buffer })
            playNext()
          },
          (err) => {
            console.error('[NormalAudioButton] Could not decode audio segment:', err)
          }
        )
      } catch (err) {
        console.error('[NormalAudioButton] Could not process audio segment:', err)
      }
    },
    [getAudioContext, playNext]
  )

  const closeServerSession = useCallback(() => {
    const currentSession = sessionIdRef.current
    if (!currentSession) return
    if (window.helix?.voiceSend) {
      void window.helix.voiceSend({
        type: 'VOICE_SESSION_STOP',
        payload: { session_id: currentSession },
      })
    }
    sessionIdRef.current = null
    pendingCloseRef.current = false
    setIsProcessing(false)
  }, [])

  // Listen to voice events. The subscription is installed once and filtered to
  // this component's own session, so Live Voice audio never plays twice.
  useEffect(() => {
    if (!window.helix?.onVoiceEvent) return

    const unsubscribe = window.helix.onVoiceEvent(
      (event: { type: string; payload: Record<string, unknown> }) => {
        const { type, payload } = event
        const eventSessionId = payload?.session_id as string | undefined
        const activeSessionId = sessionIdRef.current
        if (!activeSessionId) return
        if (eventSessionId && eventSessionId !== activeSessionId) return

        if (type === 'VOICE_TRANSCRIPT' && payload?.final && payload?.text) {
          const text = (payload.text as string).trim()
          if (text) {
            onTranscriptRef.current?.(text)
          }
        } else if (type === 'VOICE_AUDIO_SEGMENT' && payload?.audio_base64) {
          const index = Number((payload.index as number) ?? (payload.segment_index as number) ?? 0)
          enqueueSegment(index, payload.audio_base64 as string)
        } else if (type === 'VOICE_SPEAKING_END') {
          speakingEndRef.current = true
          maybeSignalPlaybackDone()
        } else if (type === 'VOICE_AUDIO_STOP' || type === 'VOICE_INTERRUPTED') {
          stopPlayback()
        } else if (type === 'VOICE_STATE') {
          const state = payload.state as string
          if (state === 'PROCESSING' || state === 'THINKING' || state === 'SPEAKING') {
            setIsProcessing(true)
          } else if (state === 'IDLE' || state === 'CLOSED' || state === 'ERROR') {
            setIsProcessing(false)
            if (pendingCloseRef.current) {
              closeServerSession()
            }
          }
        } else if (type === 'VOICE_SESSION_CLOSED') {
          setIsRecording(false)
          setIsProcessing(false)
          isRecordingRef.current = false
          stopCapture()
          stopPlayback()
          sessionIdRef.current = null
          pendingCloseRef.current = false
        } else if (type === 'VOICE_ERROR') {
          setIsProcessing(false)
        }
      }
    )

    return () => {
      unsubscribe()
    }
  }, [closeServerSession, enqueueSegment, maybeSignalPlaybackDone, stopCapture, stopPlayback])

  const startRecording = async () => {
    if (disabled || isRecordingRef.current || isProcessing || sessionIdRef.current) return

    const newSessionId = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    sessionIdRef.current = newSessionId
    pendingCloseRef.current = false
    stopPlayback()

    const ok = await startCapture()
    if (!ok) {
      sessionIdRef.current = null
      return
    }

    isRecordingRef.current = true
    setIsRecording(true)

    if (window.helix?.voiceSend) {
      await window.helix.voiceSend({
        type: 'VOICE_SESSION_START',
        payload: {
          session_id: newSessionId,
          mode: 'normal',
          language: 'es',
          silence_ms: 1000,
          tts_enabled: true,
          sample_rate: 16000,
        },
      })
      await window.helix.voiceSend({
        type: 'VOICE_RECORDING_START',
        payload: { session_id: newSessionId },
      })
    }
  }

  const stopRecording = async () => {
    if (!isRecordingRef.current) return
    isRecordingRef.current = false
    setIsRecording(false)
    stopCapture()
    pendingCloseRef.current = true

    const currentSession = sessionIdRef.current
    if (currentSession && window.helix?.voiceSend) {
      await window.helix.voiceSend({
        type: 'VOICE_RECORDING_STOP',
        payload: { session_id: currentSession },
      })
    } else {
      pendingCloseRef.current = false
      sessionIdRef.current = null
    }
  }

  const handleClick = () => {
    if (isRecordingRef.current) {
      void stopRecording()
    } else {
      void startRecording()
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onToggleVoiceActive) {
      e.preventDefault()
      onToggleVoiceActive()
    }
  }

  // Privacy: never leave the microphone open if the button unmounts.
  useEffect(() => {
    return () => {
      isRecordingRef.current = false
      stopCapture()
      stopPlayback()
      const currentSession = sessionIdRef.current
      if (currentSession && window.helix?.voiceSend) {
        void window.helix.voiceSend({
          type: 'VOICE_SESSION_STOP',
          payload: { session_id: currentSession },
        })
      }
      sessionIdRef.current = null
      const ctx = audioContextRef.current
      if (ctx && ctx.state !== 'closed') {
        void ctx.close().catch(() => {})
      }
      audioContextRef.current = null
    }
  }, [stopCapture, stopPlayback])

  const isActive = isRecording || isVoiceCapturing || isVoiceActive
  const title = isRecording
    ? 'Grabando audio · Clic para finalizar e insertar texto'
    : isProcessing
    ? 'Procesando tu voz...'
    : isVoiceCapturing
    ? 'Helix te está escuchando...'
    : 'Grabar mensaje por voz (clic derecho: activar wake-word)'

  return (
    <button
      type="button"
      className={`icon-btn floating-ui__mic-btn normal-audio-btn ${isActive ? 'icon-btn--active' : ''} ${isRecording ? 'normal-audio-btn--recording' : ''} ${isProcessing ? 'normal-audio-btn--processing' : ''} ${className}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
    >
      <MicIcon active={isActive} />

      {(isRecording || isVoiceCapturing) && (
        <span className="floating-ui__mic-wave" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
      )}

      {isRecording && <span className="normal-audio-recording-dot" />}
    </button>
  )
}
