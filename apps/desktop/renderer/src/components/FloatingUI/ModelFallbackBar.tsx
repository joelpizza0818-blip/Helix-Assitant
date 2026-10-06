import React, { useEffect } from 'react'
import type { FallbackEvent } from '../../types/global'
import './ModelFallbackBar.css'

interface Props {
  event: FallbackEvent
  onDismiss: () => void
}

export default function ModelFallbackBar({ event, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [event, onDismiss])

  return (
    <div className="fallback-bar" role="status">
      <span className="fallback-bar__icon">⇅</span>
      <span className="fallback-bar__text">
        {event.from_model} → {event.to_model}
      </span>
      <button className="fallback-bar__dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}
