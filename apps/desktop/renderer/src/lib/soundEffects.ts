import { getCustomSound } from './customSoundStore'

export const SUCCESS_SOUND_PRESETS = [
  { id: 'helix_chime', label: 'Helix Chime' },
  { id: 'soft_ding', label: 'Soft Ding' },
  { id: 'bright_chime', label: 'Bright Chime' },
  { id: 'ascending', label: 'Ascending Notes' },
  { id: 'double_ping', label: 'Double Ping' },
  { id: 'retro_coin', label: 'Retro Coin' },
  { id: 'sparkle', label: 'Sparkle' },
] as const

export const ERROR_SOUND_PRESETS = [
  { id: 'low_buzz', label: 'Low Buzz' },
  { id: 'descending', label: 'Descending Alert' },
  { id: 'double_buzz', label: 'Double Buzz' },
  { id: 'soft_alert', label: 'Soft Alert' },
  { id: 'warning_pulse', label: 'Warning Pulse' },
] as const

export type SoundKind = 'success' | 'error'
export type SuccessSoundPreset = typeof SUCCESS_SOUND_PRESETS[number]['id'] | 'custom'
export type ErrorSoundPreset = typeof ERROR_SOUND_PRESETS[number]['id'] | 'custom'

interface Note {
  frequency: number
  endFrequency?: number
  delay: number
  duration: number
  waveform: OscillatorType
  volume?: number
}

const SUCCESS_NOTES: Record<Exclude<SuccessSoundPreset, 'custom'>, Note[]> = {
  helix_chime: [
    { frequency: 523.25, delay: 0, duration: 0.25, waveform: 'sine' },
    { frequency: 659.25, delay: 0.08, duration: 0.25, waveform: 'sine' },
    { frequency: 783.99, delay: 0.16, duration: 0.25, waveform: 'sine' },
  ],
  soft_ding: [{ frequency: 659.25, delay: 0, duration: 0.34, waveform: 'sine', volume: 0.08 }],
  bright_chime: [
    { frequency: 880, delay: 0, duration: 0.22, waveform: 'sine', volume: 0.08 },
    { frequency: 1174.66, delay: 0.09, duration: 0.28, waveform: 'sine', volume: 0.07 },
  ],
  ascending: [
    { frequency: 392, delay: 0, duration: 0.15, waveform: 'triangle' },
    { frequency: 523.25, delay: 0.1, duration: 0.15, waveform: 'triangle' },
    { frequency: 659.25, delay: 0.2, duration: 0.22, waveform: 'triangle' },
  ],
  double_ping: [
    { frequency: 740, delay: 0, duration: 0.12, waveform: 'sine', volume: 0.08 },
    { frequency: 988, delay: 0.17, duration: 0.18, waveform: 'sine', volume: 0.08 },
  ],
  retro_coin: [
    { frequency: 988, delay: 0, duration: 0.11, waveform: 'square', volume: 0.045 },
    { frequency: 1318.51, delay: 0.09, duration: 0.23, waveform: 'square', volume: 0.04 },
  ],
  sparkle: [
    { frequency: 1046.5, delay: 0, duration: 0.1, waveform: 'sine', volume: 0.06 },
    { frequency: 1318.51, delay: 0.08, duration: 0.12, waveform: 'sine', volume: 0.06 },
    { frequency: 1567.98, delay: 0.17, duration: 0.2, waveform: 'sine', volume: 0.055 },
  ],
}

const ERROR_NOTES: Record<Exclude<ErrorSoundPreset, 'custom'>, Note[]> = {
  low_buzz: [{ frequency: 320, endFrequency: 180, delay: 0, duration: 0.28, waveform: 'triangle', volume: 0.12 }],
  descending: [
    { frequency: 520, endFrequency: 390, delay: 0, duration: 0.2, waveform: 'triangle', volume: 0.09 },
    { frequency: 390, endFrequency: 260, delay: 0.16, duration: 0.24, waveform: 'triangle', volume: 0.09 },
  ],
  double_buzz: [
    { frequency: 240, endFrequency: 180, delay: 0, duration: 0.14, waveform: 'square', volume: 0.055 },
    { frequency: 240, endFrequency: 180, delay: 0.2, duration: 0.14, waveform: 'square', volume: 0.055 },
  ],
  soft_alert: [
    { frequency: 440, delay: 0, duration: 0.14, waveform: 'sine', volume: 0.07 },
    { frequency: 349.23, delay: 0.16, duration: 0.22, waveform: 'sine', volume: 0.07 },
  ],
  warning_pulse: [
    { frequency: 660, delay: 0, duration: 0.12, waveform: 'triangle', volume: 0.065 },
    { frequency: 440, delay: 0.15, duration: 0.22, waveform: 'triangle', volume: 0.065 },
  ],
}

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null
  if (!audioCtx) audioCtx = new window.AudioContext()
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch((error: unknown) => {
      console.error('[SoundEffects] Could not resume the audio context:', error)
    })
  }
  return audioCtx
}

function playNotes(notes: Note[]): boolean {
  const ctx = getAudioContext()
  if (!ctx) return false

  const now = ctx.currentTime
  for (const note of notes) {
    const startsAt = now + note.delay
    const endsAt = startsAt + note.duration
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = note.waveform
    oscillator.frequency.setValueAtTime(note.frequency, startsAt)
    if (note.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, endsAt)
    gain.gain.setValueAtTime(0.001, startsAt)
    gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.1, startsAt + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, endsAt)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(startsAt)
    oscillator.stop(endsAt + 0.01)
  }
  return true
}

export async function playConfiguredSound(kind: SoundKind, preset: string): Promise<void> {
  if (preset === 'custom') {
    const blob = await getCustomSound(kind)
    if (!blob) throw new Error(`No custom ${kind} sound has been uploaded.`)
    if (typeof Audio === 'undefined' || typeof URL === 'undefined') {
      throw new Error('Audio playback is unavailable in this environment.')
    }

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    const releaseUrl = () => URL.revokeObjectURL(url)
    audio.addEventListener('ended', releaseUrl, { once: true })
    audio.addEventListener('error', releaseUrl, { once: true })
    try {
      await audio.play()
    } catch {
      releaseUrl()
      throw new Error('The selected sound could not be played. The codec may be unsupported or playback may be blocked.')
    }
    return
  }

  if (kind === 'success') {
    const notes = SUCCESS_NOTES[preset as keyof typeof SUCCESS_NOTES]
    if (!notes) throw new Error(`Unknown success sound preset: ${preset}`)
    if (!playNotes(notes)) throw new Error('Web Audio is unavailable in this environment.')
    return
  }

  const notes = ERROR_NOTES[preset as keyof typeof ERROR_NOTES]
  if (!notes) throw new Error(`Unknown error sound preset: ${preset}`)
  if (!playNotes(notes)) throw new Error('Web Audio is unavailable in this environment.')
}

export function playSuccessChime(): void {
  void playNotes(SUCCESS_NOTES.helix_chime)
}

export function playErrorAlert(): void {
  void playNotes(ERROR_NOTES.low_buzz)
}

export function playTerminalBlip(): void {
  void playNotes([{ frequency: 880, delay: 0, duration: 0.05, waveform: 'sine', volume: 0.06 }])
}
