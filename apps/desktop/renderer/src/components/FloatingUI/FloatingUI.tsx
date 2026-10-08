import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useAgent } from '../../hooks/useAgent'
import { HelixLogo } from '../HelixLogo/HelixLogo'
import MessageBubble from './MessageBubble'
import ConfirmationPrompt from './ConfirmationPrompt'
import TaskStatusBar from './TaskStatusBar'
import ModelFallbackBar from './ModelFallbackBar'
import { toggleSummaryExpanded } from './taskExecutionSummary'
import {
  filterMentionOptions,
  findActiveMention,
  replaceActiveMention,
  type ActiveMention,
  type MentionOption,
} from './mentionAutocomplete'
import type { ChatAttachment, MCPServerStatus, SkillSummary } from '../../types/global'
import './FloatingUI.css'

export default function FloatingUI() {
  const {
    messages, conversationHistory, isLoading, tasks, agentStatus, currentModel, currentProvider,
    taskCount, pendingConfirmation, fallbackEvent,
    sendMessage, selectConversation, startNewConversation,
    cancelTask, confirmAction, rejectAction, dismissFallback
  } = useAgent({ persistConversation: true })

  const [inputText, setInputText] = useState('')
  const [isMicActive, setIsMicActive] = useState(false)
  const [showTaskSummary, setShowTaskSummary] = useState(false)
  const [showConversationHistory, setShowConversationHistory] = useState(false)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([])
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Listen for show-tasks event from main process
  useEffect(() => {
    const cleanup = window.helix?.onShowTasks(() => setShowTaskSummary(true))
    return cleanup
  }, [])

  useEffect(() => {
    let active = true
    void window.helix.getSkills().then((availableSkills) => {
      if (!active) return
      setSkills(availableSkills)
    }).catch((error: unknown) => {
      console.error('[FloatingUI] Failed to load skill suggestions:', error)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activeMention?.trigger !== '/') return
    let active = true
    const timeout = window.setTimeout(() => {
      void window.helix.getMcpServers().then((servers) => {
        if (active) setMcpServers(servers)
      }).catch((error: unknown) => {
        console.error('[FloatingUI] Failed to load MCP server suggestions:', error)
      })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [activeMention?.trigger, activeMention?.query])

  const mentionOptions: MentionOption[] = [
    ...skills.map((skill) => ({
      trigger: '@' as const,
      name: skill.name,
      description: skill.description,
    })),
    ...mcpServers
      .filter((server) => server.enabled && server.status === 'connected')
      .map((server) => ({
        trigger: '/' as const,
        name: server.name,
        description: `MCP server · ${server.tool_count} tools`,
      })),
  ]
  const filteredMentionOptions = filterMentionOptions(mentionOptions, activeMention)

  const handleSend = () => {
    const text = inputText.trim()
    if ((!text && attachments.length === 0) || isLoading) return
    sendMessage(text, attachments)
    setInputText('')
    setAttachments([])
    setActiveMention(null)
  }

  const readAttachments = async (files: FileList | null) => {
    if (!files) return
    const next = await Promise.all(Array.from(files).slice(0, 10).map(async (file) => ({
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      data_base64: (await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })),
    })))
    setAttachments((current) => [...current, ...next].slice(0, 10))
  }

  const updateInput = (value: string, caretPosition: number) => {
    const nextMention = findActiveMention(value, caretPosition)
    setInputText(value)
    setActiveMention(nextMention)
    setSelectedMentionIndex(0)
  }

  const selectMention = (option: MentionOption) => {
    if (!activeMention) return
    const replacement = replaceActiveMention(inputText, activeMention, option)
    setInputText(replacement.value)
    setActiveMention(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(
        replacement.caretPosition,
        replacement.caretPosition,
      )
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (filteredMentionOptions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex((current) => (
          (current + (e.key === 'ArrowDown' ? 1 : -1) + filteredMentionOptions.length)
          % filteredMentionOptions.length
        ))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && activeMention)) {
        e.preventDefault()
        selectMention(filteredMentionOptions[selectedMentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setActiveMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStopTask = () => {
    const runningTask = tasks.find((t) => t.status === 'running')
    if (runningTask) cancelTask(runningTask.id)
  }

  const openToolbox = () => window.helix?.openToolbox()

  const statusDotClass = {
    idle: 'status-dot--idle',
    busy: 'status-dot--busy',
    listening: 'status-dot--listening',
    executing: 'status-dot--busy',
    waiting_confirmation: 'status-dot--warning',
    error: 'status-dot--error'
  }[agentStatus] ?? 'status-dot--idle'

  const runningTasks = tasks.filter((t) => t.status === 'running' || t.status === 'queued')
  const activeTask = tasks.find((t) => t.status === 'running') ?? tasks.find((t) => t.status === 'queued')

  return (
    <div className="floating-ui">
      {/* ── Header ─────────────────────────────── */}
      <div className="floating-ui__header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="floating-ui__brand">
          <HelixLogo size="sm" showText={true} />
          <span className={`status-dot ${statusDotClass}`} title={agentStatus} />
        </div>
        <div className="floating-ui__model-info">
          {currentProvider && currentModel && (
            <span className="floating-ui__model-label">
              {currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1)} · {currentModel}
            </span>
          )}
        </div>
        <div className="floating-ui__header-actions" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            className={`icon-btn ${showConversationHistory ? 'icon-btn--active' : ''}`}
            onClick={() => setShowConversationHistory((visible) => !visible)}
            title="Open chat history"
            aria-label="Open chat history"
            aria-expanded={showConversationHistory}
          >
            <HistoryIcon />
          </button>
          <button
            className="icon-btn"
            onClick={openToolbox}
            title="Open Toolbox & Control Center"
            aria-label="Open Toolbox"
          >
            <GearIcon />
          </button>
          <button
            className="icon-btn floating-ui__quit-btn"
            onClick={() => window.helix?.quit()}
            title="Salir completamente de HELIX"
            aria-label="Salir de HELIX"
          >
            <QuitIcon />
            <span>Salir</span>
          </button>
        </div>
      </div>

      {/* ── Model Fallback Bar ─────────────────── */}
      {fallbackEvent && (
        <ModelFallbackBar event={fallbackEvent} onDismiss={dismissFallback} />
      )}

      {/* ── Conversation Area ──────────────────── */}
      {showConversationHistory ? (
        <section className="conversation-history" aria-label="Chat history">
          <div className="conversation-history__header">
            <div>
              <h2 className="conversation-history__title">Chat history</h2>
              <p className="conversation-history__description">Saved locally on this device.</p>
            </div>
            <button
              className="conversation-history__new"
              disabled={isLoading}
              onClick={() => {
                startNewConversation()
                setShowConversationHistory(false)
              }}
            >
              + New chat
            </button>
          </div>
          {conversationHistory.length === 0 ? (
            <p className="conversation-history__empty">Your conversations will appear here.</p>
          ) : (
            <div className="conversation-history__list">
              {conversationHistory.map((conversation) => (
                <button
                  className="conversation-history__item"
                  key={conversation.id}
                  disabled={isLoading}
                  onClick={() => {
                    selectConversation(conversation.id)
                    setShowConversationHistory(false)
                  }}
                >
                  <span className="conversation-history__item-title">{conversation.title}</span>
                  <span className="conversation-history__item-preview">
                    {conversation.messages[conversation.messages.length - 1]?.content}
                  </span>
                  <time className="conversation-history__item-date" dateTime={conversation.updatedAt}>
                    {new Date(conversation.updatedAt).toLocaleString()}
                  </time>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="floating-ui__messages">
          {messages.length === 0 && (
            <div className="floating-ui__empty">
              <HelixLogo size="lg" showText={false} className="floating-ui__empty-logo" />
              <p className="floating-ui__empty-text">HELIX is ready. Ask anything or give an OS command.</p>
            </div>
          )}
          {messages.map((msg, idx) => (
            <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
          ))}
          {isLoading && (
            <div className="message-bubble message-bubble--assistant">
              <div className="typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Confirmation Prompt ────────────────── */}
      {pendingConfirmation && (
        <ConfirmationPrompt
          request={pendingConfirmation}
          onConfirm={() => confirmAction(pendingConfirmation.id)}
          onReject={() => rejectAction(pendingConfirmation.id)}
        />
      )}

      {/* ── Task Status Strip ─────────────────── */}
      {runningTasks.length > 0 && (
        <TaskStatusBar
          runningCount={runningTasks.length}
          activeDescription={activeTask?.current_action ?? activeTask?.description ?? null}
          activeTask={activeTask}
          expanded={showTaskSummary}
          onClick={() => setShowTaskSummary(toggleSummaryExpanded)}
        />
      )}

      {/* ── Input Area ────────────────────────── */}
      <div className="floating-ui__input-area">
        <input ref={fileInputRef} className="floating-ui__file-input" type="file" multiple accept="image/*,.txt,.md,.json,.csv,.pdf,.doc,.docx,.js,.ts,.py,.html,.css" onChange={(event) => { void readAttachments(event.target.files); event.currentTarget.value = '' }} />
        {attachments.length > 0 && <div className="floating-ui__attachments" aria-label="Attached files">
          {attachments.map((attachment) => <button key={`${attachment.name}-${attachment.size}`} type="button" className="floating-ui__attachment" onClick={() => setAttachments((current) => current.filter((item) => item !== attachment))} title="Remove attachment">📎 {attachment.name} ×</button>)}
        </div>}
        <div className="floating-ui__input-wrapper">
          <input
            ref={inputRef}
            className="floating-ui__input"
            type="text"
            placeholder={
              agentStatus === 'listening' ? 'Listening...' :
              agentStatus === 'executing' ? 'Task in progress...' :
              'Ask HELIX...'
            }
            value={inputText}
            onChange={(e) => updateInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onClick={(e) => {
              const mention = findActiveMention(e.currentTarget.value, e.currentTarget.selectionStart ?? undefined)
              setActiveMention(mention)
              setSelectedMentionIndex(0)
            }}
            disabled={isLoading || agentStatus === 'listening'}
            aria-autocomplete="list"
            aria-expanded={filteredMentionOptions.length > 0}
            aria-controls="floating-ui-mention-suggestions"
            autoFocus
          />
          {filteredMentionOptions.length > 0 && (
            <div
              id="floating-ui-mention-suggestions"
              className="floating-ui__mention-suggestions"
              role="listbox"
              aria-label={activeMention?.trigger === '@' ? 'Skills' : 'MCP servers'}
            >
              {filteredMentionOptions.map((option, index) => (
                <button
                  key={`${option.trigger}${option.name}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedMentionIndex}
                  className={`floating-ui__mention-option ${index === selectedMentionIndex ? 'floating-ui__mention-option--selected' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(option)}
                >
                  <span className="floating-ui__mention-name">{option.trigger}{option.name}</span>
                  <span className="floating-ui__mention-description">{option.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="icon-btn" type="button" onClick={() => fileInputRef.current?.click()} title="Attach files or images" aria-label="Attach files or images"><PaperclipIcon /></button>

        {/* Microphone button */}
        <button
          className={`icon-btn ${isMicActive ? 'icon-btn--active' : ''}`}
          onClick={() => setIsMicActive((v) => !v)}
          title={isMicActive ? 'Mute microphone' : 'Activate microphone'}
          aria-label="Microphone"
        >
          <MicIcon active={isMicActive} />
        </button>

        {/* Camera status indicator */}
        <span className="camera-indicator" title="Camera status" />

        {/* Send button */}
        <button
          className={`send-btn ${inputText.trim() ? 'send-btn--active' : ''}`}
          onClick={handleSend}
          disabled={!inputText.trim() || isLoading}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>

      {/* ── Stop button (when task running) ───── */}
      {runningTasks.length > 0 && (
        <div className="floating-ui__footer">
          <button className="stop-btn" onClick={handleStopTask}>
            ■ Stop
          </button>
        </div>
      )}
    </div>
  )
}

// ── Icon Components ────────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2h4l.5 3a7.5 7.5 0 0 1 1.8 1l2.8-1 2 3.5-2.2 2a7.5 7.5 0 0 1 0 2l2.2 2-2 3.5-2.8-1a7.5 7.5 0 0 1-1.8 1L14 22h-4l-.5-3a7.5 7.5 0 0 1-1.8-1l-2.8 1-2-3.5 2.2-2a7.5 7.5 0 0 1 0-2l-2.2-2 2-3.5 2.8 1a7.5 7.5 0 0 1 1.8-1L10 2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function QuitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--orange)' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  )
}
