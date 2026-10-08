import { createHash, randomUUID } from 'crypto'
import { clipboard, nativeImage, type NativeImage } from 'electron'

const MAX_HISTORY_ITEMS = 30
const MAX_TEXT_LENGTH = 25_000
const MAX_IMAGE_BYTES = 500_000
const MAX_IMAGE_DIMENSION = 512
const POLL_INTERVAL_MS = 750

export interface ClipboardHistoryItem {
  id: string
  kind: 'text' | 'image'
  timestamp: string
  text?: string
  dataUrl?: string
}

export class ClipboardHistory {
  private items: ClipboardHistoryItem[] = []
  private monitoring = true
  private lastSignature = ''
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onChange: (items: ClipboardHistoryItem[]) => void,
    private readonly onMonitoringChange: (enabled: boolean) => void,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.capture(), POLL_INTERVAL_MS)
    this.timer.unref()
    this.capture()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  getHistory(): ClipboardHistoryItem[] {
    return this.items.map((item) => ({ ...item }))
  }

  isMonitoring(): boolean {
    return this.monitoring
  }

  setMonitoring(enabled: boolean): void {
    if (this.monitoring === enabled) return
    this.monitoring = enabled
    this.onMonitoringChange(enabled)
    if (enabled) this.capture()
  }

  clear(): void {
    this.items = []
    this.onChange([])
  }

  restore(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('Clipboard history item no longer exists.')

    if (item.kind === 'text' && typeof item.text === 'string') {
      clipboard.writeText(item.text)
      this.lastSignature = this.signature('text', item.text)
      return
    }
    if (item.kind === 'image' && typeof item.dataUrl === 'string') {
      clipboard.writeImage(nativeImage.createFromDataURL(item.dataUrl))
      this.lastSignature = this.signature('image', item.dataUrl)
      return
    }
    throw new Error('Clipboard history item has invalid content.')
  }

  private capture(): void {
    if (!this.monitoring) return
    try {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        this.captureImage(image)
        return
      }

      const text = clipboard.readText()
      if (!text) {
        this.lastSignature = ''
        return
      }
      const boundedText = text.slice(0, MAX_TEXT_LENGTH)
      this.addItem({
        id: randomUUID(),
        kind: 'text',
        timestamp: new Date().toISOString(),
        text: boundedText,
      }, this.signature('text', boundedText))
    } catch (error) {
      console.error('[ClipboardHistory] Could not read the system clipboard:', error)
    }
  }

  private captureImage(image: NativeImage): void {
    const { width, height } = image.getSize()
    if (width <= 0 || height <= 0) return
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height))
    const resized = image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good',
    })
    let bytes = resized.toJPEG(70)
    if (bytes.length > MAX_IMAGE_BYTES) {
      bytes = resized.resize({ width: 320, height: 320, quality: 'good' }).toJPEG(50)
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      console.warn('[ClipboardHistory] Skipping a clipboard image that exceeds the memory limit.')
      return
    }

    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
    const signature = this.signature('image', bytes)
    this.addItem({
      id: randomUUID(),
      kind: 'image',
      timestamp: new Date().toISOString(),
      dataUrl,
    }, signature)
  }

  private addItem(item: ClipboardHistoryItem, signature: string): void {
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.items = [item, ...this.items].slice(0, MAX_HISTORY_ITEMS)
    this.onChange(this.getHistory())
  }

  private signature(kind: 'text' | 'image', content: string | Buffer): string {
    const hash = createHash('sha256').update(content).digest('hex')
    return `${kind}:${hash}`
  }
}
