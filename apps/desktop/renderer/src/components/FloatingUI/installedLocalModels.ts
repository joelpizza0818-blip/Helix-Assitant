export interface InstalledLocalModelItem {
  id: string
  name: string
  description: string
  provider: 'ollama' | 'llama_server'
  tier: 'local'
  badge?: string
}

interface InstalledOllamaModel {
  name: string
  size_gb: number
}

interface InstalledGgufModel {
  name: string
  path: string
  size_gb: number
}

export function getInstalledLocalModelItems(
  ollamaModels: InstalledOllamaModel[],
  ggufModels: InstalledGgufModel[],
): InstalledLocalModelItem[] {
  return [
    ...ollamaModels.filter((model) => !/:cloud$/i.test(model.name)).map((model) => ({
      id: model.name,
      name: model.name,
      description: `Ollama · Modelo local descargado (${model.size_gb} GB)`,
      provider: 'ollama' as const,
      tier: 'local' as const,
    })),
    ...ggufModels.map((model) => ({
      id: model.path,
      name: model.name,
      description: `GGUF · Modelo local descargado (${model.size_gb} GB)`,
      provider: 'llama_server' as const,
      tier: 'local' as const,
      badge: 'GGUF',
    })),
  ]
}
