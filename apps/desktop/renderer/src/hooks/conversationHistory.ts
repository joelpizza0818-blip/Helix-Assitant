import type { AgentMessage } from '../types/global'

const HISTORY_STORAGE_KEY = 'helix:conversation-history'

export interface StoredConversation {
  id: string
  title: string
  updatedAt: string
  messages: AgentMessage[]
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return (
    ['user', 'assistant', 'system', 'tool'].includes(String(message.role)) &&
    typeof message.content === 'string' &&
    typeof message.timestamp === 'string'
  )
}

export function readConversationHistory(): StoredConversation[] {
  const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
  if (!raw) return []

  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('Stored conversation history must be an array')
  }

  return parsed.flatMap((item): StoredConversation[] => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !('title' in item) ||
      typeof item.title !== 'string' ||
      !('updatedAt' in item) ||
      typeof item.updatedAt !== 'string' ||
      !('messages' in item) ||
      !Array.isArray(item.messages)
    ) {
      return []
    }
    return [{
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      messages: item.messages.filter(isAgentMessage),
    }]
  })
}

export function saveConversation(
  history: StoredConversation[],
  id: string,
  messages: AgentMessage[],
): StoredConversation[] {
  const savedMessages = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant',
  )
  if (savedMessages.length === 0) return history

  const firstUserMessage = savedMessages.find((message) => message.role === 'user')
  const title = firstUserMessage?.content.trim().replace(/\s+/g, ' ').slice(0, 72)
    || 'New conversation'
  const conversation: StoredConversation = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: savedMessages,
  }
  const nextHistory = [
    conversation,
    ...history.filter((item) => item.id !== id),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory))
  return nextHistory
}
