import React, { useState } from 'react'
import { useAgent } from '../../hooks/useAgent'
import type { TaskStatus, TaskDefinition } from '../../types/global'
import './TaskManager.css'

export default function TaskManager() {
  const { tasks, cancelTask } = useAgent()
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return true
    return t.status === filter
  })

  const toggleExpand = (id: string) => {
    setExpandedTaskId((prev) => (prev === id ? null : id))
  }

  const getStatusClass = (status: TaskStatus) => {
    switch (status) {
      case 'running': return 'task-badge--running'
      case 'waiting_confirmation': return 'task-badge--warning'
      case 'paused': return 'task-badge--paused'
      case 'completed': return 'task-badge--completed'
      case 'failed': return 'task-badge--failed'
      case 'cancelled': return 'task-badge--cancelled'
      default: return 'task-badge--queued'
    }
  }

  return (
    <div className="task-manager">
      <header className="task-manager__header">
        <div className="task-manager__brand">
          <span className="task-manager__wordmark">HELIX</span>
          <span className="task-manager__title">Background Tasks</span>
        </div>
        <div className="task-manager__filters">
          {(['all', 'running', 'queued', 'completed', 'failed'] as const).map((f) => (
            <button
              key={f}
              className={`task-filter-btn ${filter === f ? 'task-filter-btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="task-manager__content">
        {filteredTasks.length === 0 ? (
          <div className="task-manager__empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            <p className="text-xs text-muted">No background tasks found.</p>
          </div>
        ) : (
          <div className="task-list">
            {filteredTasks.map((task) => (
              <div key={task.id} className="task-item">
                <div className="task-item__main" onClick={() => toggleExpand(task.id)}>
                  <div className="task-item__status">
                    <span className={`task-badge ${getStatusClass(task.status)}`}>
                      {task.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  <div className="task-item__details">
                    <div className="task-item__title">{task.description}</div>
                    <div className="task-item__meta">
                      <span className="text-mono text-xs text-muted">ID: {task.id.slice(0, 8)}</span>
                      {task.current_action && (
                        <>
                          <span>·</span>
                          <span className="text-xs text-orange text-mono">{task.current_action}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="text-xs text-muted">Priority: {task.priority}</span>
                      <span>·</span>
                      <span className="text-xs text-muted">
                        {new Date(task.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <div className="task-item__actions">
                    {(task.status === 'running' || task.status === 'queued') && (
                      <button
                        className="task-cancel-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          cancelTask(task.id)
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    <span className="task-item__chevron">
                      {expandedTaskId === task.id ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {expandedTaskId === task.id && (
                  <div className="task-item__logs">
                    <div className="task-logs-header">Execution Logs</div>
                    {task.logs.length === 0 ? (
                      <div className="text-xs text-muted">No log entries recorded yet.</div>
                    ) : (
                      task.logs.map((log, index) => (
                        <div key={index} className="task-log-entry">
                          <span className="task-log-time">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <span className={`task-log-level task-log-level--${log.level.toLowerCase()}`}>
                            [{log.level}]
                          </span>
                          <span className="task-log-msg selectable">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div className="task-requests">
                      <div className="task-logs-header">Model Requests</div>
                      {task.model_requests?.length ? task.model_requests.map((request) => (
                        <details className="task-request" key={request.request_id}>
                          <summary>
                            <span>{request.provider} / {request.model}</span>
                            <span>Key {request.key_slot}</span>
                            <span className={`task-request__status task-request__status--${request.status}`}>
                              {request.status}
                            </span>
                            <span>{new Date(request.timestamp).toLocaleTimeString()}</span>
                          </summary>
                          <div className="task-request__body">
                            <pre className="task-request__payload">
                              {JSON.stringify(request.request, null, 2)}
                            </pre>
                            {request.error && (
                              <div className="task-request__error">
                                {request.error.code}: {request.error.message}
                              </div>
                            )}
                          </div>
                        </details>
                      )) : (
                        <div className="text-xs text-muted">
                          Request details will appear here when recorded.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
