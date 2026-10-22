import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentLifecycleEvent, AgentMessage } from '../../types/global'
import { skillMentionPlugin } from './skillMentions'
import './MessageBubble.css'

interface Props {
  message: AgentMessage
  skillNames?: readonly string[]
  agentUpdates?: readonly AgentLifecycleEvent[]
}

export default function MessageBubble({ message, skillNames = [], agentUpdates = [] }: Props) {
  const { role, content, timestamp, tool_name, model, provider } = message

  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
  const childAgents = agentUpdates.filter((event) => event.parent_id === message.task_id)

  if (role === 'system') {
    return (
      <div className="message-bubble message-bubble--system">
        <span className="bubble-system-text">{content}</span>
      </div>
    )
  }

  if (role === 'tool') {
    return (
      <div className="message-bubble message-bubble--tool">
        <div className="bubble-tool">
          <span className="bubble-tool__dot" />
          <span className="bubble-tool__name">{tool_name ?? 'tool'}</span>
          <span className="bubble-tool__content">{content}</span>
          <span className="bubble-tool__time">{formattedTime}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`message-bubble message-bubble--${role}`}>
      <div className={`bubble bubble--${role}`}>
        <div className="bubble__content selectable">
          {message.attachments?.length ? (
            <div className="bubble__attachments">
              {message.attachments.map((attachment) => attachment.mime_type.startsWith('image/') ? (
                <img key={attachment.name} className="bubble__attachment-image" src={`data:${attachment.mime_type};base64,${attachment.data_base64}`} alt={attachment.name} />
              ) : (
                <span key={attachment.name} className="bubble__attachment-file">{attachment.name}</span>
              ))}
            </div>
          ) : null}
          <ReactMarkdown remarkPlugins={[
            remarkGfm,
            skillMentionPlugin(skillNames),
          ]}>{content}</ReactMarkdown>
        </div>
        <div className="bubble__meta">
          {role === 'assistant' && model && (
            <span className="bubble__model">{model}</span>
          )}
          <span className="bubble__time">{formattedTime}</span>
        </div>
        {role === 'assistant' && childAgents.length > 0 && (
          <details className="bubble__agents">
            <summary>Subagents · {childAgents.length}</summary>
            <ul>
              {childAgents.map((agent) => (
                <li key={agent.agent_id}>
                  <span>{agent.role ?? 'agent'} · {agent.status ?? 'queued'}</span>
                  <span className="bubble__agent-id">{agent.agent_id.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
