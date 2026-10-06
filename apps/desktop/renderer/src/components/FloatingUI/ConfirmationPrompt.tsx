import React from 'react'
import type { ConfirmationRequest, PermissionLevel } from '../../types/global'
import './ConfirmationPrompt.css'

interface Props {
  request: ConfirmationRequest
  onConfirm: () => void
  onReject: () => void
}

const LEVEL_LABELS: Record<PermissionLevel, { label: string; className: string }> = {
  READ_ONLY:  { label: 'Read Only',  className: 'level--low' },
  LOW_RISK:   { label: 'Low Risk',   className: 'level--low' },
  MODIFY:     { label: 'Modify',     className: 'level--medium' },
  EXECUTE:    { label: 'Execute',    className: 'level--medium' },
  SYSTEM:     { label: 'System',     className: 'level--high' },
  CRITICAL:   { label: 'Critical',  className: 'level--critical' }
}

export default function ConfirmationPrompt({ request, onConfirm, onReject }: Props) {
  const level = LEVEL_LABELS[request.level] ?? { label: request.level, className: 'level--medium' }

  return (
    <div className="confirmation-prompt">
      <div className="confirmation-prompt__header">
        <span className="confirmation-prompt__title">Confirmation Required</span>
        <span className={`confirmation-prompt__level ${level.className}`}>{level.label}</span>
      </div>

      <div className="confirmation-prompt__body">
        <div className="confirmation-section">
          <span className="confirmation-section__label">Action</span>
          <p className="confirmation-section__value">{request.action}</p>
        </div>

        <div className="confirmation-section">
          <span className="confirmation-section__label">What will change</span>
          <p className="confirmation-section__value">{request.what_will_change}</p>
        </div>

        <div className="confirmation-section">
          <span className="confirmation-section__label">Why</span>
          <p className="confirmation-section__value">{request.why}</p>
        </div>
      </div>

      <div className="confirmation-prompt__actions">
        <button className="confirm-btn" onClick={onConfirm} aria-label="Confirm action">
          Confirm
        </button>
        <button className="reject-btn" onClick={onReject} aria-label="Reject action">
          Reject
        </button>
      </div>

      <p className="confirmation-prompt__hint">
        Hand gestures: Thumbs Up to Confirm · Thumbs Down to Reject
      </p>
    </div>
  )
}
