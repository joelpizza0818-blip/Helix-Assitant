import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  AgentMessage, AgentStatus, AgentStatusUpdate, TaskDefinition,
  ConfirmationRequest, FallbackEvent, ProviderStatus, ModelDefinition,
  ProviderID
} from '../types/global'

interface UseAgentReturn {
  messages: AgentMessage[]
  isLoading: boolean
  tasks: TaskDefinition[]
  agentStatus: AgentStatus
  currentModel: string | null
  currentProvider: ProviderID | null
  taskCount: number
  pendingConfirmation: ConfirmationRequest | null
  fallbackEvent: FallbackEvent | null
  providers: ProviderStatus[]
  models: ModelDefinition[]
  sendMessage: (text: string) => void
  cancelTask: (taskId: string) => void
  confirmAction: (requestId: string) => void
  rejectAction: (requestId: string) => void
  loadProviders: () => Promise<void>
  loadModels: () => Promise<void>
  loadTasks: () => Promise<void>
  dismissFallback: () => void
}

export function useAgent(): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [conversationId] = useState(() => crypto.randomUUID())
  const [isLoading, setIsLoading] = useState(false)
  const [tasks, setTasks] = useState<TaskDefinition[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle')
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<ProviderID | null>(null)
  const [taskCount, setTaskCount] = useState(0)
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null)
  const [fallbackEvent, setFallbackEvent] = useState<FallbackEvent | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [models, setModels] = useState<ModelDefinition[]>([])

  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Subscribe to all agent events
    const cleanups: Array<() => void> = []

    if (!window.helix) {
      console.warn('window.helix not available — are we in Electron?')
      return
    }

    cleanups.push(
      window.helix.onAgentMessage((msg) => {
        setMessages((prev) => {
          // Avoid duplicates for streaming
          const last = prev[prev.length - 1]
          if (last && last.role === msg.role && last.streaming && msg.streaming) {
            return [...prev.slice(0, -1), msg]
          }
          return [...prev, msg]
        })
        if (msg.role === 'user') {
          setIsLoading(true)
        } else if (msg.role === 'assistant' && !msg.streaming) {
          setIsLoading(false)
        }
      })
    )

    cleanups.push(
      window.helix.onStatusUpdate((update: AgentStatusUpdate) => {
        setAgentStatus(update.status)
        setCurrentModel(update.model)
        setCurrentProvider(update.provider)
        setTaskCount(update.task_count)
        if (update.status !== 'busy' && update.status !== 'executing') {
          setIsLoading(false)
        }
      })
    )

    cleanups.push(
      window.helix.onTaskUpdate((task) => {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === task.id)
          if (idx === -1) return [...prev, task]
          const updated = [...prev]
          updated[idx] = task
          return updated
        })
      })
    )

    cleanups.push(
      window.helix.onConfirmationRequest((req) => {
        setPendingConfirmation(req)
      })
    )

    cleanups.push(
      window.helix.onConfirmationResolved(({ request_id: requestId }) => {
        setPendingConfirmation((current) => (
          current?.id === requestId ? null : current
        ))
      })
    )

    cleanups.push(
      window.helix.onFallbackEvent((event) => {
        setFallbackEvent(event)
        // Auto-dismiss after 5 seconds
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = setTimeout(() => setFallbackEvent(null), 5000)
      })
    )

    cleanups.push(
      window.helix.onError((err) => {
        console.error('[useAgent] Agent error:', err)
        setIsLoading(false)
        setAgentStatus('error')
      })
    )

    // Initial data load
    loadProviders()
    loadTasks()

    return () => {
      cleanups.forEach((fn) => fn())
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
    }
  }, [])

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return
    const userMessage: AgentMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    }
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)
    const conversationHistory = [
      ...messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: text }
    ]
    window.helix?.sendMessage({
      text,
      conversation_id: conversationId,
      conversation_history: conversationHistory
    })
  }, [messages, conversationId])

  const cancelTask = useCallback((taskId: string) => {
    window.helix?.cancelTask(taskId)
  }, [])

  const confirmAction = useCallback((requestId: string) => {
    window.helix?.confirmAction(requestId)
    setPendingConfirmation(null)
  }, [])

  const rejectAction = useCallback((requestId: string) => {
    window.helix?.rejectAction(requestId)
    setPendingConfirmation(null)
  }, [])

  const loadProviders = useCallback(async () => {
    try {
      const result = await window.helix?.getProviders()
      if (result) setProviders(result as ProviderStatus[])
    } catch (err) {
      console.error('Failed to load providers:', err)
    }
  }, [])

  const loadModels = useCallback(async () => {
    try {
      const result = await window.helix?.getModels()
      if (result) setModels(result as ModelDefinition[])
    } catch (err) {
      console.error('Failed to load models:', err)
    }
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      const result = await window.helix?.getTasks()
      if (result) setTasks(result as TaskDefinition[])
    } catch (err) {
      console.error('Failed to load tasks:', err)
    }
  }, [])

  const dismissFallback = useCallback(() => {
    setFallbackEvent(null)
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
  }, [])

  return {
    messages, isLoading, tasks, agentStatus, currentModel, currentProvider,
    taskCount, pendingConfirmation, fallbackEvent, providers, models,
    sendMessage, cancelTask, confirmAction, rejectAction,
    loadProviders, loadModels, loadTasks, dismissFallback
  }
}
