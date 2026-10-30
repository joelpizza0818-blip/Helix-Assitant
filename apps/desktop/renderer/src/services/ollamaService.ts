/**
 * Client-side service to interact with local Ollama instance (http://127.0.0.1:11434)
 * Allows checking Ollama health, listing downloaded models, and pulling new models with progress.
 */

export interface OllamaModelInfo {
  name: string
  size: number
  digest: string
  modified_at: string
}

export interface OllamaProgressCallback {
  (status: string, percentage: number): void
}

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

export async function checkOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1200)
    const res = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

export async function getInstalledOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000)
    })
    if (!res.ok) return []
    const data = await res.json() as { models?: OllamaModelInfo[] }
    return (data.models || []).map((m) => m.name.toLowerCase())
  } catch {
    return []
  }
}

export async function pullOllamaModel(
  modelName: string,
  onProgress?: OllamaProgressCallback
): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true })
    })

    if (!res.ok || !res.body) {
      return false
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const payload = JSON.parse(line) as {
            status?: string
            total?: number
            completed?: number
          }
          let pct = 0
          if (payload.total && payload.completed) {
            pct = Math.round((payload.completed / payload.total) * 100)
          }
          onProgress?.(payload.status || 'Descargando…', pct)
        } catch {
          // ignore stream parse errors
        }
      }
    }

    return true
  } catch (err) {
    console.error('Error pulling Ollama model:', err)
    return false
  }
}
