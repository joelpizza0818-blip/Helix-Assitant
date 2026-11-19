import React, { useCallback, useEffect, useState } from 'react'
import type { LlamaCatalogModel, LlamaServerStatus } from '../../../types/global'
import { getUserFacingError } from '../../../lib/userError'
import {
  getOllamaStatus,
  pullOllamaModelViaIpc,
  type OllamaStatus,
} from '../../../services/modelCatalogService'
import '../Toolbox.css'

const MODEL_LEVELS = ['Ligero', 'Estándar', 'Medio-alto', 'Alto'] as const

const OLLAMA_MODELS: {
  id: string
  name: string
  level: (typeof MODEL_LEVELS)[number]
  size: string
  ram: string
  description: string
}[] = [
  {
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder 1.5B',
    level: 'Ligero',
    size: '~1 GB',
    ram: '4 GB',
    description: 'Programación y terminal en equipos modestos.',
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek R1 1.5B',
    level: 'Ligero',
    size: '~1.1 GB',
    ram: '4 GB',
    description: 'Razonamiento ligero para tareas sencillas.',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    level: 'Estándar',
    size: '~2 GB',
    ram: '6 GB',
    description: 'Asistente general rápido con soporte de herramientas.',
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    level: 'Medio-alto',
    size: '~4.7 GB',
    ram: '12 GB',
    description: 'Más capacidad para programación y tareas de agente.',
  },
  {
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 7B',
    level: 'Medio-alto',
    size: '~4.7 GB',
    ram: '12 GB',
    description: 'Razonamiento local de mayor capacidad.',
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    level: 'Medio-alto',
    size: '~4.1 GB',
    ram: '12 GB',
    description: 'Modelo general equilibrado.',
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B',
    level: 'Medio-alto',
    size: '~5.4 GB',
    ram: '16 GB',
    description: 'Modelo general de mayor capacidad.',
  },
  {
    id: 'llama3.3:70b',
    name: 'Llama 3.3 70B',
    level: 'Alto',
    size: '~40 GB',
    ram: '60 GB',
    description: 'Modelo muy grande; comprueba RAM y espacio antes de descargar.',
  },
]

interface Props {
  onModelStoreChanged?: () => void
}

export default function ModelStoreSection({ onModelStoreChanged }: Props) {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [llamaStatus, setLlamaStatus] = useState<LlamaServerStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadingRuntime, setDownloadingRuntime] = useState(false)
  const [llamaActionPending, setLlamaActionPending] = useState(false)

  const refreshStore = useCallback(async () => {
    setRefreshing(true)
    const [ollamaResult, llamaResult] = await Promise.allSettled([
      getOllamaStatus(),
      window.helix.getLlamaServerStatus(),
    ])
    if (ollamaResult.status === 'fulfilled') {
      setOllamaStatus(ollamaResult.value)
    } else {
      console.warn('[ModelStore] Could not refresh Ollama status.', ollamaResult.reason)
    }
    if (llamaResult.status === 'fulfilled') {
      setLlamaStatus(llamaResult.value)
    } else {
      console.warn('[ModelStore] Could not refresh llama.cpp status.', llamaResult.reason)
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void refreshStore()
  }, [refreshStore])

  const handleDownloadOllamaModel = async (modelId: string) => {
    setDownloadingModel(modelId)
    setDownloadProgress(0)
    setDownloadMessage('Comprobando Ollama…')
    try {
      const ollama = await window.helix.ensureOllama?.()
      if (!ollama?.ok) {
        throw new Error(
          ollama?.status === 'not_installed'
            ? 'Ollama no está instalado. Instálalo desde ollama.com y vuelve a intentarlo.'
            : 'No se pudo iniciar Ollama. Abre Ollama e inténtalo de nuevo.',
        )
      }

      const started = await pullOllamaModelViaIpc(modelId, 'start')
      if (!started) {
        throw new Error('No se pudo contactar al agente para iniciar la descarga.')
      }
      if (started.status === 'INCOMPATIBLE') {
        throw new Error(`Hardware insuficiente: ${started.issues?.join(', ') || 'revisa la RAM y el espacio en disco.'}`)
      }
      if (started.status === 'UNAVAILABLE' || started.status === 'ERROR') {
        throw new Error(started.message || 'El servicio local no está disponible.')
      }

      let completed = started.status === 'READY'
      if (!completed && started.status === 'INSTALLING') {
        const deadline = Date.now() + 60 * 60 * 1000
        while (Date.now() < deadline) {
          const status = await getOllamaStatus()
          if (!status?.running) {
            throw new Error('Se perdió la conexión con Ollama durante la descarga.')
          }
          const pull = status.pulls?.find((item) => item.model.toLowerCase() === modelId.toLowerCase())
          if (pull) {
            setDownloadProgress(Math.round(pull.percent))
            setDownloadMessage(pull.status === 'downloading' ? 'Descargando modelo…' : pull.status)
            if (pull.error) throw new Error(pull.error)
            if (pull.done) {
              if (pull.status !== 'success') {
                throw new Error(`La descarga terminó sin éxito (${pull.status}).`)
              }
              completed = true
              break
            }
          }
          if (status.models.some((model) => model.name.toLowerCase() === modelId.toLowerCase())) {
            completed = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        if (!completed) {
          await pullOllamaModelViaIpc(modelId, 'cancel')
          throw new Error('La descarga superó el límite de una hora y se canceló.')
        }
      } else if (!completed) {
        throw new Error(started.message || `No se pudo iniciar la descarga (${started.status}).`)
      }

      setDownloadProgress(100)
      setDownloadMessage('Modelo instalado. Ya aparece en el selector flotante.')
      await refreshStore()
      onModelStoreChanged?.()
    } catch (error: unknown) {
      setDownloadMessage(getUserFacingError(error, 'No se pudo descargar el modelo Ollama.'))
    } finally {
      setTimeout(() => {
        setDownloadingModel(null)
        setDownloadProgress(0)
      }, 5000)
    }
  }

  const handleDownloadGgufModel = async (modelId: string) => {
    setDownloadingModel(modelId)
    setDownloadProgress(0)
    setDownloadMessage(`Descargando ${modelId} desde Hugging Face…`)
    try {
      const result = await window.helix.downloadGgufModel(modelId)
      setLlamaStatus(result.server_status)
      if (result.error) {
        throw new Error(result.error)
      }
      if (!result.done) {
        throw new Error('La descarga no se completó.')
      }
      setDownloadProgress(100)
      setDownloadMessage('Modelo GGUF instalado. Ya aparece en el selector flotante.')
      onModelStoreChanged?.()
    } catch (error: unknown) {
      setDownloadMessage(getUserFacingError(error, 'No se pudo descargar el modelo GGUF.'))
    } finally {
      setTimeout(() => {
        setDownloadingModel(null)
        setDownloadProgress(0)
      }, 5000)
    }
  }

  const handleDownloadRuntime = async () => {
    setDownloadingRuntime(true)
    setDownloadMessage('Descargando llama.cpp (llama-server)…')
    try {
      const result = await window.helix.downloadLlamaServer()
      setLlamaStatus(result.server_status)
      if (result.error) {
        throw new Error(result.error)
      }
      if (!result.done) {
        throw new Error('No se pudo completar la descarga.')
      }
      setDownloadMessage('llama-server instalado.')
    } catch (error: unknown) {
      setDownloadMessage(getUserFacingError(error, 'No se pudo instalar llama.cpp.'))
    } finally {
      setDownloadingRuntime(false)
    }
  }

  const handleUseGgufModel = async (modelPath: string) => {
    setLlamaActionPending(true)
    try {
      const result = await window.helix.startLlamaServer(modelPath)
      setLlamaStatus(result.status)
      if (!result.success) {
        setDownloadMessage('No se pudo iniciar llama-server con este modelo.')
      }
    } catch (error: unknown) {
      setDownloadMessage(getUserFacingError(error, 'No se pudo activar el modelo GGUF.'))
    } finally {
      setLlamaActionPending(false)
    }
  }

  const installedOllamaModels = new Set(
    ollamaStatus?.models.map((model) => model.name.toLowerCase()) ?? [],
  )

  return (
    <div>
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Model Store</span>
            <p className="toolbox-section__desc" style={{ margin: '4px 0 0' }}>
              Descarga modelos locales aquí. El selector flotante muestra únicamente los modelos ya instalados.
            </p>
          </div>
          <button type="button" className="validate-btn" disabled={refreshing} onClick={() => void refreshStore()}>
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Ollama · modelos locales</span>
            <p className="toolbox-section__desc" style={{ margin: '4px 0 0' }}>
              Descarga explícita. Los tamaños y RAM sugerida son aproximados; el modelo grande requiere mucho espacio.
            </p>
          </div>
          <span className={`status-badge ${ollamaStatus?.running ? 'status-badge--healthy' : 'status-badge--unconfigured'}`}>
            {!ollamaStatus ? 'Comprobando' : ollamaStatus.running ? 'Ollama activo' : ollamaStatus.installed ? 'Ollama detenido' : 'No instalado'}
          </span>
        </div>

        {MODEL_LEVELS.map((level) => {
          const levelModels = OLLAMA_MODELS.filter((model) => model.level === level)
          return (
            <section key={level} style={{ marginTop: 16 }}>
              <strong className="text-xs text-muted">{level}</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {levelModels.map((model) => {
                  const installed = installedOllamaModels.has(model.id.toLowerCase())
                  const downloading = downloadingModel === model.id
                  return (
                    <div key={model.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--canvas)', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }}>
                      <div>
                        <span className="text-sm weight-medium text-bone">{model.name}</span>
                        <p className="text-xs text-muted" style={{ margin: '2px 0' }}>{model.size} · RAM sugerida {model.ram} · {model.description}</p>
                        {downloading && (
                          <div className="model-dropdown__progress-box">
                            <div className="model-dropdown__progress-bar">
                              <div className="model-dropdown__progress-fill" style={{ width: `${Math.max(downloadProgress, 4)}%` }} />
                            </div>
                            <span className="model-dropdown__progress-status">{downloadMessage}</span>
                          </div>
                        )}
                      </div>
                      {installed ? (
                        <span className="status-badge status-badge--healthy" style={{ fontSize: 11 }}>Descargado ✓</span>
                      ) : (
                        <button type="button" className="validate-btn" disabled={Boolean(downloadingModel) || downloadingRuntime} onClick={() => void handleDownloadOllamaModel(model.id)}>
                          {downloading ? `${downloadProgress}%` : 'Descargar'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">llama.cpp · modelos GGUF</span>
            <p className="toolbox-section__desc" style={{ margin: '4px 0 0' }}>
              Modelos abiertos de Hugging Face. Las recomendaciones de RAM incluyen memoria de trabajo estimada.
            </p>
          </div>
          <span className={`status-badge ${llamaStatus?.installed ? 'status-badge--healthy' : 'status-badge--unconfigured'}`}>
            {!llamaStatus ? 'Buscando' : llamaStatus.installed ? 'llama-server listo' : llamaStatus.llama_cpp_installed ? 'llama.cpp detectado' : 'No instalado'}
          </span>
        </div>

        {llamaStatus && !llamaStatus.llama_cpp_installed && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 10, marginTop: 10, background: 'rgba(238, 96, 24, 0.08)', borderRadius: 'var(--radius-btn)', border: '1px solid rgba(238, 96, 24, 0.25)' }}>
            <div>
              <span className="text-sm weight-medium" style={{ color: '#ff914d' }}>No se encontró llama.cpp</span>
              <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Instala el runtime portátil para usar modelos GGUF.</p>
            </div>
            <button type="button" className="validate-btn" disabled={downloadingRuntime} onClick={() => void handleDownloadRuntime()}>
              {downloadingRuntime ? 'Descargando…' : 'Descargar runtime'}
            </button>
          </div>
        )}

        {llamaStatus?.llama_cpp_installed && !llamaStatus.installed && (
          <p className="text-xs text-muted" style={{ marginTop: 10 }}>
            Se detectó llama.cpp, pero no llama-server. Configura <code>LLAMA_SERVER_PATH</code> para habilitar la inferencia.
          </p>
        )}

        {llamaStatus?.models.map((model) => (
          <div key={model.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', marginTop: 6, background: 'var(--canvas)', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }}>
            <div>
              <span className="text-sm weight-medium text-bone">{model.name}</span>
              <p className="text-xs text-muted" style={{ margin: '2px 0' }}>{model.size_gb} GB · {model.path}</p>
            </div>
            {llamaStatus.active_model === model.path ? (
              <span className="status-badge status-badge--healthy" style={{ fontSize: 11 }}>En uso</span>
            ) : (
              <button type="button" className="validate-btn" disabled={llamaActionPending || !llamaStatus.installed} onClick={() => void handleUseGgufModel(model.path)}>
                {llamaActionPending ? 'Iniciando…' : 'Usar modelo'}
              </button>
            )}
          </div>
        ))}

        {llamaStatus && llamaStatus.curated_catalog.length > 0 && MODEL_LEVELS.map((level) => {
          const models = llamaStatus.curated_catalog.filter((model: LlamaCatalogModel) => model.category === level)
          if (!models.length) return null
          return (
            <section key={level} style={{ marginTop: 16 }}>
              <strong className="text-xs text-muted">{level}</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {models.map((model) => {
                  const downloaded = llamaStatus.models.some((local) => local.path.toLowerCase().endsWith(model.filename.toLowerCase()))
                  const downloading = downloadingModel === model.id
                  return (
                    <div key={model.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--canvas)', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }}>
                      <div>
                        <span className="text-sm weight-medium text-bone">{model.display_name}</span>
                        <p className="text-xs text-muted" style={{ margin: '2px 0' }}>
                          {model.parameters} · {model.quantization} · {model.size_gb} GB · RAM sugerida {model.recommended_ram_gb} GB
                        </p>
                        <p className="text-xs text-muted" style={{ margin: '2px 0' }}>{model.description}</p>
                        {downloading && <span className="model-dropdown__progress-status">{downloadMessage}</span>}
                      </div>
                      {downloaded ? (
                        <span className="status-badge status-badge--healthy" style={{ fontSize: 11 }}>Descargado ✓</span>
                      ) : (
                        <button type="button" className="validate-btn" disabled={Boolean(downloadingModel) || downloadingRuntime} onClick={() => void handleDownloadGgufModel(model.id)}>
                          {downloading ? 'Descargando…' : 'Descargar modelo'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {downloadMessage && (
        <p role="status" className="text-xs" style={{ color: 'var(--orange)', margin: '4px 0 12px' }}>
          {downloadMessage}
        </p>
      )}
    </div>
  )
}
