import React from 'react'
import './TaskStatusBar.css'

interface Props {
  runningCount: number
  activeDescription: string | null
  onClick: () => void
}

export default function TaskStatusBar({ runningCount, activeDescription, onClick }: Props) {
  return (
    <button className="task-status-bar" onClick={onClick} aria-label="View running tasks">
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
      <span className="task-status-bar__arrow">›</span>
    </button>
  )
}
