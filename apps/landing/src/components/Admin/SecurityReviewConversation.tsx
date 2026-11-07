import { useState, type FormEvent } from 'react'

export interface SecurityReviewCase {
  id: string
  profile_id: string
  attempted_rank: string
  status: 'pending' | 'dismissed' | 'permanent'
  created_at: string
  github_user_roles?: {
    github_login: string
    display_name: string | null
    rank: string
  } | null
}

export interface SecurityReviewMessage {
  id: string
  sender_profile_id: string
  body: string
  created_at: string
  github_user_roles?: {
    github_login: string
    display_name: string | null
    rank: string
  } | null
}

interface SecurityReviewConversationProps {
  reviewCase: SecurityReviewCase
  messages: SecurityReviewMessage[]
  currentProfileId: string
  saving: boolean
  onSend: (message: string) => Promise<void>
  onDecision?: (decision: 'dismiss' | 'permanent') => void
}

export function SecurityReviewConversation({
  reviewCase,
  messages,
  currentProfileId,
  saving,
  onSend,
  onDecision,
}: SecurityReviewConversationProps) {
  const [draft, setDraft] = useState('')

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || saving) return
    await onSend(message)
    setDraft('')
  }

  return (
    <section className="admin-form" aria-label="Conversación de revisión de seguridad">
      <div className="admin-section-heading">
        <div>
          <h2>Revisión de acceso</h2>
          <p>
            Caso {reviewCase.id} · intento de rango {reviewCase.attempted_rank} · estado {reviewCase.status}
          </p>
        </div>
        {onDecision && reviewCase.status !== 'dismissed' && (
          <div className="admin-record__actions">
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={saving}
              onClick={() => onDecision('dismiss')}
            >
              {reviewCase.status === 'permanent' ? 'Desbanear' : 'Retirar suspensión'}
            </button>
            {reviewCase.status !== 'permanent' && (
              <button
                type="button"
                className="admin-button admin-button--danger"
                disabled={saving}
                onClick={() => onDecision('permanent')}
              >
                Baneo permanente
              </button>
            )}
          </div>
        )}
      </div>

      <div className="admin-record-list" aria-live="polite">
        {messages.length === 0 && <p className="admin-empty">Aún no hay mensajes en este caso.</p>}
        {messages.map((message) => {
          const sender = message.github_user_roles
          const isCurrentUser = message.sender_profile_id === currentProfileId
          return (
            <article className="admin-record" key={message.id}>
              <div className="admin-record__copy">
                <div className="admin-record__meta">
                  <span>{sender?.display_name || sender?.github_login || (isCurrentUser ? 'Tú' : 'Administrador')}</span>
                  <time>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.created_at))}</time>
                </div>
                <p>{message.body}</p>
              </div>
            </article>
          )
        })}
      </div>

      {reviewCase.status !== 'dismissed' && (
        <form className="admin-form" onSubmit={(event) => { void sendMessage(event) }}>
          <label>
            Mensaje para el master-admin
            <textarea
              required
              maxLength={2000}
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button className="admin-button" disabled={saving || !draft.trim()} type="submit">
            {saving ? 'Enviando…' : 'Enviar mensaje'}
          </button>
        </form>
      )}
    </section>
  )
}
