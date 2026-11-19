/**
 * Client-side service to interact with local Ollama instance (http://127.0.0.1:11434)
 * Allows checking Ollama health and listing downloaded models.
 */

export interface OllamaModelInfo {
  name: string
  size: number
  digest: string
  modified_at: string
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
