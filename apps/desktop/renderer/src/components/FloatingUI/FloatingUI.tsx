import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useAgent } from '../../hooks/useAgent'
import { HelixLogo } from '../HelixLogo/HelixLogo'
import MessageBubble from './MessageBubble'
import ConfirmationPrompt from './ConfirmationPrompt'
import TaskStatusBar from './TaskStatusBar'
import ModelFallbackBar from './ModelFallbackBar'
import './FloatingUI.css'

export default function FloatingUI() {
  const {
    messages, isLoading, tasks, agentStatus, currentModel, currentProvider,
    taskCount, pendingConfirmation, fallbackEvent,
    sendMessage, cancelTask, confirmAction, rejectAction, dismissFallback
  } = useAgent()

  const [inputText, setInputText] = useState('')
  const [isMicActive, setIsMicActive] = useState(false)
  const [showTaskManager, setShowTaskManager] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Listen for show-tasks event from main process
  useEffect(() => {
    const cleanup = window.helix?.onShowTasks(() => setShowTaskManager(true))
    return cleanup
  }, [])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text || isLoading) return
    sendMessage(text)
    setInputText('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
  const activeTask = tasks.find((t) => t.status === 'running')

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
          onClick={() => setShowTaskManager((v) => !v)}
        />
      )}

      {/* ── Input Area ────────────────────────── */}
      <div className="floating-ui__input-area">
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
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || agentStatus === 'listening'}
          autoFocus
        />

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
