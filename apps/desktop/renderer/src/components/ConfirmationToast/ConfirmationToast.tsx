import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { ConfirmationRequest } from '../../types/global'
import './ConfirmationToast.css'

const EXIT_DURATION_MS = 240

export default function ConfirmationToast() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)
  const [isDismissing, setIsDismissing] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const requestRef = useRef<ConfirmationRequest | null>(null)
  const pointerStart = useRef<number | null>(null)
  const dismissalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    const cleanups = [
      window.helix.onConfirmationRequest((nextRequest) => {
        requestRef.current = nextRequest
        setRequest(nextRequest)
        setIsDismissing(false)
        setDragOffset(0)
      }),
      window.helix.onConfirmationResolved(({ request_id: requestId }) => {
        if (requestRef.current?.id === requestId) setIsDismissing(true)
      }),
    ]
    return () => {
      cleanups.forEach((cleanup) => cleanup())
      document.body.style.backgroundColor = ''
    }
  }, [])

  useEffect(() => {
    if (!request) return
    if (dismissalTimer.current) clearTimeout(dismissalTimer.current)
    if (exitTimer.current) clearTimeout(exitTimer.current)

    dismissalTimer.current = setTimeout(() => setIsDismissing(true), 5000)
    return () => {
      if (dismissalTimer.current) clearTimeout(dismissalTimer.current)
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [request])

  useEffect(() => {
    if (!request || !isDismissing) return
    exitTimer.current = setTimeout(() => {
      window.helix.dismissConfirmationToast(request.id)
    }, EXIT_DURATION_MS)
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [isDismissing, request])

  const beginDismissal = () => setIsDismissing(true)

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
    pointerStart.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (pointerStart.current === null) return
    setDragOffset(Math.max(0, event.clientX - pointerStart.current))
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (pointerStart.current === null) return
    const distance = event.clientX - pointerStart.current
    pointerStart.current = null
    if (distance >= 80) beginDismissal()
    else setDragOffset(0)
  }

  if (!request) return null

  return (
    <article
      className={`confirmation-toast${isDismissing ? ' confirmation-toast--leaving' : ''}`}
      style={{ transform: `translateX(${isDismissing ? 440 : dragOffset}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerStart.current = null
        setDragOffset(0)
      }}
      aria-label="HELIX confirmation request"
    >
      <header className="confirmation-toast__header">
        <div>
          <p className="confirmation-toast__eyebrow">HELIX · Confirmation required</p>
          <span className="confirmation-toast__level">{request.level}</span>
        </div>
        <button
          className="confirmation-toast__dismiss"
          onClick={beginDismissal}
          aria-label="Dismiss confirmation notification"
          title="Dismiss"
        >
          ×
        </button>
      </header>

      <div className="confirmation-toast__content">
        <section>
          <span>Action</span>
          <p>{request.action}</p>
        </section>
        <section>
          <span>What will change</span>
          <p>{request.what_will_change}</p>
        </section>
        <section>
          <span>Why</span>
          <p>{request.why}</p>
        </section>
      </div>

      <footer className="confirmation-toast__actions">
        <button
          className="confirmation-toast__confirm"
          onClick={() => {
            window.helix.confirmAction(request.id)
            beginDismissal()
          }}
        >
          Confirm
        </button>
        <button
          className="confirmation-toast__reject"
          onClick={() => {
            window.helix.rejectAction(request.id)
            beginDismissal()
          }}
        >
          Reject
        </button>
      </footer>
      <p className="confirmation-toast__hint">Swipe right or wait 5 seconds to dismiss</p>
    </article>
  )
}
