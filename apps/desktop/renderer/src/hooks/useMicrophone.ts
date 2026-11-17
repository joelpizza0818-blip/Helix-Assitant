import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseMicrophoneOptions {
  sampleRate?: number
  onAudioChunk?: (pcm16: Uint8Array, rms: number) => void
  vadThreshold?: number
}

export interface UseMicrophoneReturn {
  isCapturing: boolean
  isMuted: boolean
  audioLevel: number // 0.0 to 1.0
  error: string | null
  startCapture: () => Promise<boolean>
  stopCapture: () => void
  setMuted: (muted: boolean) => void
}

/**
 * High-performance microphone capture hook.
 * Captures 16kHz mono audio, converts Float32 to 16-bit PCM little-endian,
 * measures RMS volume in real-time, and delivers PCM chunks for WebSocket streaming.
 */
export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const { sampleRate = 16000, onAudioChunk } = options
  const onAudioChunkRef = useRef(onAudioChunk)
  onAudioChunkRef.current = onAudioChunk

  const [isCapturing, setIsCapturing] = useState(false)
  const [isMuted, setIsMutedState] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const isMutedRef = useRef(false)
  isMutedRef.current = isMuted

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const stopCapture = useCallback(() => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect()
      } catch {}
      processorRef.current = null
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch {}
      sourceRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        void audioContextRef.current.close()
      } catch {}
      audioContextRef.current = null
    }
    setIsCapturing(false)
    setAudioLevel(0)
  }, [])

  const startCapture = useCallback(async (): Promise<boolean> => {
    stopCapture()
    setError(null)

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('El navegador o entorno actual no soporta captura de micrófono.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx({ sampleRate })
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      audioContextRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      // Buffer size: 2048 gives ~128ms chunks at 16kHz
      const processor = audioCtx.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (isMutedRef.current) {
          setAudioLevel(0)
          return
        }

        const inputData = event.inputBuffer.getChannelData(0)
        const length = inputData.length
        if (length === 0) return

        // Compute RMS for reactive UI visualization
        let sumSquares = 0
        for (let i = 0; i < length; i++) {
          const sample = inputData[i]
          sumSquares += sample * sample
        }
        const rms = Math.sqrt(sumSquares / length)
        // Normalize 0.0 to 1.0 with a realistic dynamic curve
        const normalizedLevel = Math.min(1, Math.max(0, rms * 4.5))
        setAudioLevel(normalizedLevel)

        // Convert Float32Array to 16-bit signed PCM (Little Endian)
        const pcm16 = new Uint8Array(length * 2)
        const view = new DataView(pcm16.buffer)
        for (let i = 0; i < length; i++) {
          // Clamp to [-1.0, 1.0]
          const s = Math.max(-1, Math.min(1, inputData[i]))
          // Convert to 16-bit integer
          const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF
          view.setInt16(i * 2, int16, true)
        }

        if (onAudioChunkRef.current) {
          onAudioChunkRef.current(pcm16, normalizedLevel)
        }
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      setIsCapturing(true)
      return true
    } catch (err: unknown) {
      console.error('[useMicrophone] Failed to open microphone:', err)
      const msg = err instanceof Error ? err.message : 'No se pudo acceder al micrófono.'
      setError(msg)
      stopCapture()
      return false
    }
  }, [sampleRate, stopCapture])

  const setMuted = useCallback((muted: boolean) => {
    setIsMutedState(muted)
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !muted
      })
    }
  }, [])

  useEffect(() => {
    return () => {
      stopCapture()
    }
  }, [stopCapture])

  return {
    isCapturing,
    isMuted,
    audioLevel,
    error,
    startCapture,
    stopCapture,
    setMuted,
  }
}
