import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentMessage } from '../../types/global'
import './MessageBubble.css'

interface Props {
  message: AgentMessage
}

export default function MessageBubble({ message }: Props) {
  const { role, content, timestamp, tool_name, model, provider } = message

  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })

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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
        <div className="bubble__meta">
          {role === 'assistant' && model && (
            <span className="bubble__model">{model}</span>
          )}
          <span className="bubble__time">{formattedTime}</span>
        </div>
      </div>
    </div>
  )
}
