import React, { useEffect, useRef, useState } from 'react'
import type { DesktopControlStatusEvent, DesktopFrameEvent } from '../../types/global'
import './DesktopPreview.css'

function isDesktopFrameEvent(value: unknown): value is DesktopFrameEvent {
  if (value === null || typeof value !== 'object') return false
  const event = value as Partial<DesktopFrameEvent>
  return typeof event.task_id === 'string'
    && event.mime_type === 'image/jpeg'
    && typeof event.image_base64 === 'string'
    && event.image_base64.length > 0
    && event.image_base64.length <= 750_000
    && typeof event.captured_at === 'string'
    && (
      event.source === undefined
      || event.source === 'windows_host'
      || event.source === 'docker_guest'
    )
    && (event.window_title === undefined || typeof event.window_title === 'string')
    && (
      event.cursor === undefined
      || (
        typeof event.cursor.x === 'number'
        && Number.isFinite(event.cursor.x)
        && event.cursor.x >= 0
        && event.cursor.x <= 1
        && typeof event.cursor.y === 'number'
        && Number.isFinite(event.cursor.y)
        && event.cursor.y >= 0
        && event.cursor.y <= 1
        && typeof event.cursor.visible === 'boolean'
      )
    )
}

function isStatusEvent(value: unknown): value is DesktopControlStatusEvent {
  if (value === null || typeof value !== 'object') return false
  const event = value as Partial<DesktopControlStatusEvent>
  return typeof event.active === 'boolean'
    && (event.task_id === undefined || typeof event.task_id === 'string')
    && (event.action === undefined || typeof event.action === 'string')
    && (
      event.desktop_backend === undefined
      || event.desktop_backend === 'windows_host'
      || event.desktop_backend === 'docker_guest'
    )
}

export default function DesktopPreview() {
  const [frame, setFrame] = useState<DesktopFrameEvent | null>(null)
  const [status, setStatus] = useState<DesktopControlStatusEvent>({ active: false })
  const previousTaskId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const unsubscribeFrame = window.helix.onDesktopFrame((event) => {
      if (isDesktopFrameEvent(event)) setFrame(event)
    })
    const unsubscribeStatus = window.helix.onDesktopControlStatus((event) => {
      if (!isStatusEvent(event)) return
      if (event.task_id && event.task_id !== previousTaskId.current) {
        setFrame(null)
        previousTaskId.current = event.task_id
      }
      setStatus((current) => {
        const next = {
          ...current,
          ...event,
          desktop_backend: event.desktop_backend ?? current.desktop_backend,
        }
        if (!event.active && !event.task_id) {
          delete next.task_id
          delete next.action
        }
        return next
      })
    })
    return () => {
      unsubscribeFrame()
      unsubscribeStatus()
    }
  }, [])

  const backend = frame?.source ?? status.desktop_backend ?? 'docker_guest'
  const isHostDesktop = backend === 'windows_host'
  const desktopName = isHostDesktop ? 'HELIX Windows desktop' : 'HELIX Docker desktop'

  return (
    <main className="desktop-preview" aria-label={`${desktopName} preview`}>
      <header className="desktop-preview__header">
        <div className="desktop-preview__state">
          <span className={`desktop-preview__dot${status.active ? ' desktop-preview__dot--active' : ''}`} />
          <div>
            <strong>{desktopName}</strong>
            <span>
              {frame?.source === 'windows_host' && frame.window_title
                ? frame.window_title
                : status.active
                  ? `Working${status.action ? ` · ${status.action}` : ''}`
                  : status.task_id ? 'Task running' : 'Session ready'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="desktop-preview__stop"
          disabled={!status.task_id}
          onClick={() => window.helix.stopDesktopControl()}
        >
          Stop
        </button>
      </header>
      <section className="desktop-preview__viewport" aria-live="polite">
        {frame ? (
          <div className="desktop-preview__frame-wrap">
            <img
              className="desktop-preview__frame"
              src={`data:${frame.mime_type};base64,${frame.image_base64}`}
              alt={`Live view of the ${isHostDesktop ? 'selected Windows app' : 'HELIX Docker desktop'}`}
            />
            {frame.cursor?.visible && (
              <span
                className="desktop-preview__cursor"
                aria-hidden="true"
                style={{ left: `${frame.cursor.x * 100}%`, top: `${frame.cursor.y * 100}%` }}
              />
            )}
          </div>
        ) : (
          <div className="desktop-preview__empty">
            <strong>
              {status.active
                ? `Waiting for the ${isHostDesktop ? 'Windows app' : 'Docker desktop'} preview…`
                : `The ${isHostDesktop ? 'Windows app' : 'Docker desktop'} preview will appear here.`}
            </strong>
            <span>
              {isHostDesktop
                ? 'Only the selected Windows app window is captured. The full host monitor is not captured.'
                : 'Only frames from the isolated Docker desktop are shown.'}
            </span>
          </div>
        )}
      </section>
    </main>
  )
}
