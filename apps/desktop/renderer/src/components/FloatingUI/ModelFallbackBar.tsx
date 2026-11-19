import React from 'react'
import type { FallbackEvent } from '../../types/global'
import './ModelFallbackBar.css'

interface Props {
  event: FallbackEvent
  onDismiss: () => void
}

// Componente presentacional: el descarte automático a los 5 s vive en useAgent, que es quien
// posee `fallbackEvent`. Duplicarlo aquí creaba dos fuentes de verdad para el mismo descarte.
export default function ModelFallbackBar({ event, onDismiss }: Props) {
  return (
    <div className="fallback-bar" role="status">
      <span className="fallback-bar__icon">~</span>
      <span className="fallback-bar__text">
        {event.from_model} → {event.to_model}
      </span>
      <button className="fallback-bar__dismiss" onClick={onDismiss} aria-label="Dismiss">x</button>
    </div>
  )
}
