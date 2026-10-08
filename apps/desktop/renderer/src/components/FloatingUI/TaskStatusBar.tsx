import React from 'react'
import type { TaskDefinition } from '../../types/global'
import { getExecutionSummary, safeInputSummary, safeResult, safeSummaryText, safeToolCall } from './taskExecutionSummary'
import './TaskStatusBar.css'

interface Props {
  runningCount: number
  activeDescription: string | null
  activeTask?: TaskDefinition | null
  expanded?: boolean
  onClick: () => void
}

export default function TaskStatusBar({
  runningCount,
  activeDescription,
  activeTask,
  expanded = false,
  onClick,
}: Props) {
  const summary = activeTask ? getExecutionSummary(activeTask) : null
  const input = safeInputSummary(summary?.model_input)
  const result = safeResult(summary?.result ?? null)

  return (
    <div className="task-status">
      <button
        className="task-status-bar"
        onClick={onClick}
        aria-label="View running task summary"
        aria-expanded={expanded}
        aria-controls="running-task-summary"
      >
        <span className="task-status-bar__dot" />
        <span className="task-status-bar__count">
          {runningCount} task{runningCount !== 1 ? 's' : ''} running
        </span>
        {activeDescription && (
          <>
            <span className="task-status-bar__sep">·</span>
            <span className="task-status-bar__desc">{activeDescription}</span>
          </>
        )}
        <span className={`task-status-bar__arrow ${expanded ? 'task-status-bar__arrow--expanded' : ''}`}>›</span>
      </button>

      {expanded && activeTask && summary && (
        <div className="task-status-summary" id="running-task-summary" role="region" aria-label="Safe running task summary">
          <div className="task-status-summary__progress-row">
            <span className="task-status-summary__label">Progress</span>
            <span className="task-status-summary__progress-label">{safeSummaryText(summary.progress_label, 80)}</span>
            <span className="task-status-summary__percent">{Math.max(0, Math.min(100, activeTask.progress ?? 0))}%</span>
          </div>
          <div className="task-status-summary__progress-track">
            <span style={{ width: `${Math.max(0, Math.min(100, activeTask.progress ?? 0))}%` }} />
          </div>

          <section className="task-status-summary__section">
            <h3>Model input &amp; context</h3>
            <p>
              {input.message_count} message{input.message_count === 1 ? '' : 's'} received · {input.character_count} characters
              {input.image_count > 0 ? ` · ${input.image_count} image${input.image_count === 1 ? '' : 's'} omitted` : ''}
            </p>
            <p className="task-status-summary__muted">
              Roles: {input.roles.length ? input.roles.join(', ') : 'none'}
              {input.context_labels.length ? ` · Context: ${input.context_labels.map((label) => safeSummaryText(label, 80)).join(', ')}` : ''}
            </p>
          </section>

          <section className="task-status-summary__section">
            <h3>Execution steps</h3>
            {summary.steps.length ? summary.steps.map((step) => (
              <div className="task-status-summary__item" key={step.id}>
                <span className="task-status-summary__item-title">{safeSummaryText(step.label, 100)}</span>
                <span className="task-status-summary__muted">{safeSummaryText(step.detail, 140)}</span>
              </div>
            )) : <p className="task-status-summary__muted">No execution steps recorded yet.</p>}
          </section>

          <section className="task-status-summary__section">
            <h3>Tool calls</h3>
            {summary.tool_calls.length ? summary.tool_calls.map((call, index) => {
              const safeCall = safeToolCall(call)
              return (
                <div className="task-status-summary__item" key={`${safeCall.tool}-${index}`}>
                  <span className={`task-status-summary__status task-status-summary__status--${safeCall.status}`}>
                    {safeCall.status}
                  </span>
                  <span className="task-status-summary__item-title">{safeCall.tool}</span>
                  <span className="task-status-summary__muted">{safeCall.result_summary}</span>
                </div>
              )
            }) : <p className="task-status-summary__muted">No tool calls recorded yet.</p>}
          </section>

          <section className="task-status-summary__section">
            <h3>Result</h3>
            {result ? (
              <p><span className="task-status-summary__item-title">{result.status}: </span>{result.summary}</p>
            ) : <p className="task-status-summary__muted">Result will appear when execution finishes.</p>}
          </section>
        </div>
      )}
    </div>
  )
}
