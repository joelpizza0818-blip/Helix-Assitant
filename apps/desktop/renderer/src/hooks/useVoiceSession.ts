import { useState, useRef, useCallback, useEffect } from 'react'
import { useMicrophone } from './useMicrophone'

export type VoiceState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'THINKING'
  | 'SPEAKING'
  | 'AWAITING_CONFIRMATION'
  | 'INTERRUPTED'
  | 'MUTED'
  | 'ERROR'
  | 'STOPPING'
  | 'CLOSED'

export interface VoiceConfirmation {
  requestId: string
  action: string
  whatWillChange: string
  why: string
  level: string
  speechText: string
  expiresInSeconds?: number
}

export interface VoiceMessageItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  isSpoken?: boolean
  hadCode?: boolean
}

export interface UseVoiceSessionOptions {
  onAssistantMessage?: (text: string, hadCode?: boolean) => void
  onUserMessage?: (text: string) => void
  silenceMs?: number
}

export interface UseVoiceSessionReturn {
  sessionId: string | null
  conversationId: string | null
  state: VoiceState
  mode: 'live' | 'normal' | null
  isActive: boolean
  isMuted: boolean
  audioLevel: number // 0.0 to 1.0 (input or output level)
  transcript: string // current progressive or final transcript
  lastUserSpeech: string
  lastAssistantSpeech: string
  messages: VoiceMessageItem[]
  pendingConfirmation: VoiceConfirmation | null
  error: string | null
  startSession: (mode: 'live' | 'normal') => Promise<boolean>
  stopSession: () => Promise<void>
  toggleMute: () => void
  interrupt: () => void
  confirmAction: (decision: 'approve' | 'reject' | 'modify', instructions?: string) => Promise<void>
}

// Convert Uint8Array PCM to Base64 efficiently
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Convert Base64 to ArrayBuffer for WAV decoding
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

function sendAudioChunk(sessionId: string, pcm16: Uint8Array): void {
  if (!window.helix?.voiceSend) return
  void window.helix.voiceSend({
    type: 'VOICE_AUDIO_CHUNK',
    payload: {
      session_id: sessionId,
      audio_base64: uint8ToBase64(pcm16),
      sample_rate: 16000,
      channels: 1,
    },
  })
}

export function useVoiceSession(options: UseVoiceSessionOptions = {}): UseVoiceSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [state, setState] = useState<VoiceState>('IDLE')
  const [mode, setMode] = useState<'live' | 'normal' | null>(null)
  const [transcript, setTranscript] = useState('')
  const [lastUserSpeech, setLastUserSpeech] = useState('')
  const [lastAssistantSpeech, setLastAssistantSpeech] = useState('')
  const [messages, setMessages] = useState<VoiceMessageItem[]>([])
  const [pendingConfirmation, setPendingConfirmation] = useState<VoiceConfirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speakingLevel, setSpeakingLevel] = useState(0)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const sessionIdRef = useRef<string | null>(null)
  const stateRef = useRef<VoiceState>('IDLE')
  const userMutedRef = useRef(false)
  const bargeInAudioRef = useRef<Uint8Array[]>([])
  const bargeInActivityFramesRef = useRef(0)

  const applyState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  // Audio playback queue
  const audioContextRef = useRef<AudioContext | null>(null)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playbackQueueRef = useRef<Array<{ segmentIndex: number; audioBuffer: AudioBuffer }>>([])
  const isPlayingRef = useRef(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const lastLevelUpdateRef = useRef(0)

  // Playback acknowledgement state. The backend expects one VOICE_PLAYBACK_DONE
  // after the whole sequence, with the last segment index that was heard.
  const highestPlayedIndexRef = useRef(-1)
  const speakingEndRef = useRef<{ total: number } | null>(null)
  const playbackDoneSentRef = useRef(false)

  // Initialize playback audio context
  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioContextRef.current = new AudioCtx()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  // Stop playback instantly (used on Barge-in / Interrupt)
  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.onended = null
        src.stop()
        src.disconnect()
      } catch {}
    })
    activeSourcesRef.current = []
    playbackQueueRef.current = []
    isPlayingRef.current = false
    highestPlayedIndexRef.current = -1
    speakingEndRef.current = null
    playbackDoneSentRef.current = false
    lastLevelUpdateRef.current = 0
    setSpeakingLevel(0)
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  // Stream microphone audio to backend with instant client-side barge-in
  const handleMicrophoneChunk = useCallback((pcm16: Uint8Array, rms?: number) => {
    const currentSession = sessionIdRef.current
    if (!currentSession || !window.helix?.voiceSend) return

    const currentState = stateRef.current

    if (
      currentState === 'SPEAKING' ||
      currentState === 'THINKING' ||
      currentState === 'PROCESSING'
    ) {
      const volume = typeof rms === 'number' ? rms : 0
      const buffered = bargeInAudioRef.current
      buffered.push(pcm16)
      if (buffered.length > 4) buffered.shift()
      bargeInActivityFramesRef.current =
        volume >= 0.1 ? bargeInActivityFramesRef.current + 1 : 0
      if (bargeInActivityFramesRef.current < 2) {
        return
      }
      const audioToSend = [...buffered]
      bargeInAudioRef.current = []
      bargeInActivityFramesRef.current = 0
      if (currentState === 'SPEAKING') stopAllPlayback()
      applyState('INTERRUPTED')
      void window.helix.voiceSend({
        type: 'VOICE_INTERRUPT',
        payload: { session_id: currentSession },
      })
      audioToSend.forEach((chunk) => sendAudioChunk(currentSession, chunk))
      return
    }

    if (
      currentState !== 'LISTENING' &&
      currentState !== 'INTERRUPTED' &&
      currentState !== 'AWAITING_CONFIRMATION'
    ) {
      bargeInAudioRef.current = []
      bargeInActivityFramesRef.current = 0
      return
    }
    bargeInAudioRef.current = []
    bargeInActivityFramesRef.current = 0
    sendAudioChunk(currentSession, pcm16)
  }, [applyState, stopAllPlayback])

  const {
    isMuted,
    audioLevel: microphoneLevel,
    error: microphoneError,
    startCapture,
    stopCapture,
    setMuted,
  } = useMicrophone({
    sampleRate: 16000,
    onAudioChunk: handleMicrophoneChunk,
  })

  // Stable handles used by the single long-lived event subscription below.
  const microphoneControlsRef = useRef({ stopCapture, setMuted })
  microphoneControlsRef.current = { stopCapture, setMuted }

  // The backend waits for a single acknowledgement once every queued segment
  // has been heard. Sending one per segment would finalize the turn early.
  const maybeSignalPlaybackDone = useCallback(() => {
    if (
      playbackDoneSentRef.current ||
      !speakingEndRef.current ||
      isPlayingRef.current ||
      activeSourcesRef.current.length > 0 ||
      playbackQueueRef.current.length > 0 ||
      highestPlayedIndexRef.current < 0
    ) {
      return
    }
    playbackDoneSentRef.current = true
    if (sessionIdRef.current && window.helix?.voiceSend) {
      void window.helix.voiceSend({
        type: 'VOICE_PLAYBACK_DONE',
        payload: {
          session_id: sessionIdRef.current,
          last_index: highestPlayedIndexRef.current,
        },
      })
    }
  }, [])

  // Playback scheduler for sequential WAV audio segments
  const processPlaybackQueue = useCallback(async () => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) return
    const nextItem = playbackQueueRef.current.shift()
    if (!nextItem) return

    isPlayingRef.current = true
    const audioCtx = getAudioContext()

    try {
      const source = audioCtx.createBufferSource()
      source.buffer = nextItem.audioBuffer

      // Attach analyser node for speaking visualization
      let analyser = analyserRef.current
      if (!analyser) {
        analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        analyserRef.current = analyser
      }

      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      activeSourcesRef.current.push(source)

      // Start reactive level monitoring, throttled to avoid 60fps re-renders.
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateLevel = () => {
        if (!isPlayingRef.current) {
          setSpeakingLevel(0)
          return
        }
        const now = performance.now()
        if (now - lastLevelUpdateRef.current >= 50) {
          lastLevelUpdateRef.current = now
          analyser!.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]
          }
          const avg = sum / dataArray.length
          setSpeakingLevel(Math.min(1, avg / 128))
        }
        animFrameRef.current = requestAnimationFrame(updateLevel)
      }
      animFrameRef.current = requestAnimationFrame(updateLevel)

      source.onended = () => {
        const idx = activeSourcesRef.current.indexOf(source)
        if (idx === -1) return // already cancelled by barge-in / stop
        activeSourcesRef.current.splice(idx, 1)
        highestPlayedIndexRef.current = Math.max(
          highestPlayedIndexRef.current,
          nextItem.segmentIndex
        )

        isPlayingRef.current = false
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current)
          animFrameRef.current = null
        }
        setSpeakingLevel(0)

        // Trigger next segment if any queued, otherwise acknowledge playback.
        if (playbackQueueRef.current.length > 0) {
          void processPlaybackQueue()
        } else {
          maybeSignalPlaybackDone()
        }
      }

      source.start()
    } catch (err) {
      console.error('[useVoiceSession] Error playing audio segment:', err)
      isPlayingRef.current = false
      setSpeakingLevel(0)
      void processPlaybackQueue()
    }
  }, [getAudioContext, maybeSignalPlaybackDone])

  // Single long-lived subscription to VOICE_* events from the Python agent.
  // No hook state or options object appears in the dependency list, so
  // re-renders can never drop an event mid-session.
  useEffect(() => {
    if (!window.helix?.onVoiceEvent) return

    const unsubscribe = window.helix.onVoiceEvent((event: { type: string; payload: Record<string, unknown> }) => {
      const { type, payload } = event
      const eventSessionId = payload?.session_id as string | undefined
      const activeSessionId = sessionIdRef.current

      // Only the window that owns the active session may react. This keeps
      // Normal Audio and Live Voice (and multiple windows) from playing each
      // other's audio.
      if (!activeSessionId) return
      if (eventSessionId && eventSessionId !== activeSessionId) return

      const micControls = microphoneControlsRef.current

      switch (type) {
        case 'VOICE_SESSION_READY': {
          setConversationId((payload.conversation_id as string) || null)
          setError(null)
          break
        }

        case 'VOICE_STATE': {
          const nextState = payload.state as VoiceState
          applyState(nextState)

          if (nextState === 'INTERRUPTED') {
            stopAllPlayback()
          } else if (nextState === 'MUTED') {
            userMutedRef.current = true
            micControls.setMuted(true)
          } else if (nextState === 'LISTENING' && !userMutedRef.current) {
            micControls.setMuted(false)
            bargeInAudioRef.current = []
            bargeInActivityFramesRef.current = 0
          }
          break
        }

        case 'VOICE_TRANSCRIPT': {
          const text = (payload.text as string) || ''
          const isFinal = Boolean(payload.final)
          setTranscript(text)

          if (isFinal && text.trim()) {
            const cleanText = text.trim()
            setLastUserSpeech(cleanText)
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'user',
                text: cleanText,
                timestamp: new Date().toISOString(),
                isSpoken: true,
              },
            ])
            optionsRef.current.onUserMessage?.(cleanText)
            setTranscript('')
          }
          break
        }

        case 'VOICE_ASSISTANT_TEXT': {
          const rawText = (payload.text as string) || ''
          const speechText = (payload.speech_text as string) || rawText
          const hadCode = Boolean(payload.had_code)

          setLastAssistantSpeech(speechText || rawText)
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: rawText,
              timestamp: new Date().toISOString(),
              isSpoken: Boolean(speechText),
              hadCode,
            },
          ])
          optionsRef.current.onAssistantMessage?.(rawText, hadCode)
          break
        }

        case 'VOICE_AUDIO_SEGMENT': {
          const segmentIndex =
            (payload.index as number) ?? (payload.segment_index as number) ?? 0
          const base64Audio = payload.audio_base64 as string
          if (!base64Audio) break

          try {
            const arrayBuffer = base64ToArrayBuffer(base64Audio)
            const audioCtx = getAudioContext()
            audioCtx.decodeAudioData(
              arrayBuffer,
              (audioBuffer) => {
                playbackQueueRef.current.push({ segmentIndex, audioBuffer })
                void processPlaybackQueue()
              },
              (decodeErr) => {
                console.error('[useVoiceSession] Error decoding audio segment:', decodeErr)
              }
            )
          } catch (err) {
            console.error('[useVoiceSession] Failed to process audio segment:', err)
          }
          break
        }

        case 'VOICE_SPEAKING_END': {
          const total = Number(payload.segment_count)
          speakingEndRef.current = { total: Number.isFinite(total) ? total : 0 }
          maybeSignalPlaybackDone()
          break
        }

        case 'VOICE_AUDIO_STOP':
        case 'VOICE_INTERRUPTED': {
          stopAllPlayback()
          break
        }

        case 'VOICE_CONFIRMATION_REQUEST': {
          setPendingConfirmation({
            requestId: (payload.request_id as string) || '',
            action: (payload.action as string) || '',
            whatWillChange: (payload.what_will_change as string) || '',
            why: (payload.why as string) || '',
            level: (payload.level as string) || 'medium',
            speechText: (payload.speech_text as string) || '',
            expiresInSeconds: (payload.expires_in_seconds as number) || 120,
          })
          break
        }

        case 'VOICE_CONFIRMATION_RESOLVED': {
          setPendingConfirmation(null)
          break
        }

        case 'VOICE_ERROR': {
          const msg = (payload.message as string) || 'Ocurrió un error en la sesión de voz.'
          setError(msg)
          break
        }

        case 'VOICE_SESSION_CLOSED': {
          stopAllPlayback()
          micControls.stopCapture()
          sessionIdRef.current = null
          setSessionId(null)
          applyState('CLOSED')
          setPendingConfirmation(null)
          break
        }
      }
    })

    return () => {
      unsubscribe()
    }
  }, [applyState, getAudioContext, maybeSignalPlaybackDone, processPlaybackQueue, stopAllPlayback])

  // Release microphone and playback resources if the consuming surface unmounts.
  useEffect(() => {
    return () => {
      stopAllPlayback()
      microphoneControlsRef.current.stopCapture()
      const ctx = audioContextRef.current
      if (ctx && ctx.state !== 'closed') {
        void ctx.close().catch(() => {})
      }
      audioContextRef.current = null
    }
  }, [stopAllPlayback])

  // Start Session (Live or Normal)
  const startSession = useCallback(
    async (selectedMode: 'live' | 'normal'): Promise<boolean> => {
      if (sessionIdRef.current) return false

      setError(null)
      stopAllPlayback()

      if (!window.helix?.voiceSend) {
        setError('El puente de voz con el agente local no está disponible.')
        applyState('ERROR')
        return false
      }

      const newSessionId = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
      sessionIdRef.current = newSessionId
      bargeInAudioRef.current = []
      bargeInActivityFramesRef.current = 0
      userMutedRef.current = false
      setSessionId(newSessionId)
      setMode(selectedMode)
      setTranscript('')
      setPendingConfirmation(null)
      setConversationId(null)
      applyState('INITIALIZING')

      // Ensure audio context is ready
      const audioCtx = getAudioContext()
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      // Start microphone capture before announcing the session so a denied
      // permission never leaves a phantom server-side session.
      const micSuccess = await startCapture()
      if (!micSuccess) {
        sessionIdRef.current = null
        setSessionId(null)
        setError('No se pudo acceder al micrófono para iniciar la llamada de voz.')
        applyState('ERROR')
        return false
      }

      const requestedSilence = optionsRef.current.silenceMs
      const silenceMs = typeof requestedSilence === 'number' &&
        Number.isFinite(requestedSilence)
        ? Math.max(200, Math.min(4000, Math.round(requestedSilence)))
        : 1000
      await window.helix.voiceSend({
        type: 'VOICE_SESSION_START',
        payload: {
          session_id: newSessionId,
          mode: selectedMode,
          silence_ms: selectedMode === 'live'
            ? silenceMs
            : 650,
          max_utterance_ms: 30000,
          tts_enabled: true,
          opening_greeting: selectedMode === 'live',
          sample_rate: 16000,
        },
      })

      return true
    },
    [applyState, getAudioContext, startCapture, stopAllPlayback]
  )

  // Stop Session
  const stopSession = useCallback(async () => {
    const currentSession = sessionIdRef.current
    if (!currentSession) return

    applyState('STOPPING')
    stopAllPlayback()
    stopCapture()

    if (window.helix?.voiceSend) {
      try {
        await window.helix.voiceSend({
          type: 'VOICE_SESSION_STOP',
          payload: { session_id: currentSession },
        })
      } catch {}
    }

    sessionIdRef.current = null
    setSessionId(null)
    setPendingConfirmation(null)
    setTranscript('')
    applyState('CLOSED')
  }, [applyState, stopAllPlayback, stopCapture])

  // Toggle Mute
  const toggleMute = useCallback(() => {
    const currentSession = sessionIdRef.current
    if (!currentSession) return

    const nextMuted = !userMutedRef.current
    userMutedRef.current = nextMuted
    setMuted(nextMuted)

    if (window.helix?.voiceSend) {
      void window.helix.voiceSend({
        type: nextMuted ? 'VOICE_MUTE' : 'VOICE_UNMUTE',
        payload: { session_id: currentSession },
      })
    }
  }, [setMuted])

  // Barge-in (Interrupt Assistant immediately)
  const interrupt = useCallback(() => {
    const currentSession = sessionIdRef.current
    if (!currentSession) return

    if (stateRef.current === 'SPEAKING') stopAllPlayback()
    applyState('INTERRUPTED')

    if (window.helix?.voiceSend) {
      void window.helix.voiceSend({
        type: 'VOICE_INTERRUPT',
        payload: { session_id: currentSession },
      })
    }
    const audioToSend = [...bargeInAudioRef.current]
    bargeInAudioRef.current = []
    bargeInActivityFramesRef.current = 0
    audioToSend.forEach((chunk) => sendAudioChunk(currentSession, chunk))
  }, [applyState, stopAllPlayback])

  // Confirm or reject pending action
  const confirmAction = useCallback(
    async (decision: 'approve' | 'reject' | 'modify', instructions?: string) => {
      const currentSession = sessionIdRef.current
      if (!currentSession || !pendingConfirmation || !window.helix?.voiceSend) return

      await window.helix.voiceSend({
        type: 'VOICE_CONFIRMATION',
        payload: {
          session_id: currentSession,
          request_id: pendingConfirmation.requestId,
          decision,
          instructions: instructions || '',
        },
      })
    },
    [pendingConfirmation]
  )

  // The visual audio level reflects mic level when listening, or TTS speaking
  // level while speaking.
  const combinedAudioLevel = state === 'SPEAKING' ? speakingLevel : microphoneLevel

  return {
    sessionId,
    conversationId,
    state,
    mode,
    isActive: sessionId !== null && state !== 'CLOSED' && state !== 'IDLE',
    isMuted,
    audioLevel: combinedAudioLevel,
    transcript,
    lastUserSpeech,
    lastAssistantSpeech,
    messages,
    pendingConfirmation,
    error: error || microphoneError,
    startSession,
    stopSession,
    toggleMute,
    interrupt,
    confirmAction,
  }
}
