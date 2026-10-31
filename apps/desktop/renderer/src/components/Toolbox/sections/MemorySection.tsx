import React, { useEffect, useState, useRef } from 'react'
import type { HelixSettings, MemoryStatus } from '../../../types/global'
import '../Toolbox.css'

interface UserMemoryProfile {
  summary: string
  user_notes: string
  updated_at: string
}

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function MemorySection({ settings, onSave }: Props) {
  const [clearedNotice, setClearedNotice] = useState(false)
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null)
  const [profile, setProfile] = useState<UserMemoryProfile>({ summary: '', user_notes: '', updated_at: '' })
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)

  // Summary editing
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)

  // User notes editing
  const [userNotesDraft, setUserNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const saveNotesTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshProfile = async () => {
    try {
      const p = await (window.helix as any).getUserMemoryProfile() as UserMemoryProfile
      setProfile(p)
      // Keep draft in sync only if user isn't actively editing
      setUserNotesDraft(prev => prev === profile.user_notes ? p.user_notes : prev)
    } catch {
      // fallback: silent
    }
  }

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const status = await window.helix.getMemoryStatus()
        if (active) setMemoryStatus(status as MemoryStatus)
        const p = await (window.helix as any).getUserMemoryProfile() as UserMemoryProfile
        if (active) {
          setProfile(p)
          setUserNotesDraft(p.user_notes)
        }
      } catch (error) {
        if (active) {
          setMaintenanceError(error instanceof Error ? error.message : 'Could not load memory.')
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 8000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  // --- Summary handlers ---
  const startEditSummary = () => {
    setSummaryDraft(profile.summary)
    setEditingSummary(true)
  }

  const saveSummary = async () => {
    setSavingSummary(true)
    setMaintenanceError(null)
    try {
      await (window.helix as any).updateUserMemorySummary(summaryDraft)
      setEditingSummary(false)
      await refreshProfile()
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not save summary.')
    } finally {
      setSavingSummary(false)
    }
  }

  // --- User notes handlers (auto-save with debounce) ---
  const handleNotesChange = (value: string) => {
    setUserNotesDraft(value)
    if (saveNotesTimeout.current) clearTimeout(saveNotesTimeout.current)
    saveNotesTimeout.current = setTimeout(() => void autoSaveNotes(value), 1200)
  }

  const autoSaveNotes = async (notes: string) => {
    setSavingNotes(true)
    try {
      await (window.helix as any).updateUserNotes(notes)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch {
      // silent
    } finally {
      setSavingNotes(false)
    }
  }

  // --- Clear all memory ---
  const handleClearAll = async () => {
    if (!window.confirm('¿Borrar todo lo que Helix recuerda sobre ti? Esta acción no se puede deshacer.')) return
    setMaintenanceError(null)
    try {
      await (window.helix as any).clearUserMemory()
      setProfile({ summary: '', user_notes: '', updated_at: '' })
      setUserNotesDraft('')
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not clear memory.')
    }
  }

  const handleClearConversation = async () => {
    setMaintenanceError(null)
    try {
      await window.helix.clearMemory()
      setClearedNotice(true)
      setTimeout(() => setClearedNotice(false), 3000)
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not clear conversation memory.')
    }
  }

  const formattedDate = profile.updated_at
    ? new Date(profile.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Memory</h2>
      <p className="toolbox-section__desc">
        Review what Helix remembers about you and add your own notes.
      </p>

      {/* ── Helix's knowledge summary ─────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">What Helix knows about you</span>
          {formattedDate && (
            <span className="status-badge">Updated {formattedDate}</span>
          )}
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 10 }}>
          Helix builds this summary automatically from your conversations. Edit it anytime.
        </p>

        {editingSummary ? (
          <>
            <textarea
              className="form-input"
              rows={8}
              maxLength={4000}
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              autoFocus
            />
            <div className="toolbox-skill-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="validate-btn"
                disabled={savingSummary}
                onClick={() => void saveSummary()}
              >
                {savingSummary ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                className="validate-btn"
                onClick={() => setEditingSummary(false)}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {profile.summary ? (
              <p className="text-sm text-bone" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 10 }}>
                {profile.summary}
              </p>
            ) : (
              <p className="text-xs text-muted" style={{ marginBottom: 10 }}>
                No memory yet. Helix will build this summary as you chat.
              </p>
            )}
            <button
              type="button"
              className="validate-btn"
              onClick={startEditSummary}
            >
              Edit
            </button>
          </>
        )}
      </div>

      {/* ── User notes (manual input) ─────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Your notes</span>
          {savingNotes && <span className="status-badge">Saving…</span>}
          {notesSaved && !savingNotes && <span className="status-badge status-badge--healthy">Saved ✓</span>}
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 10 }}>
          Add anything you always want Helix to know — preferences, instructions, context. These are never auto-overwritten.
        </p>
        <textarea
          className="form-input"
          rows={5}
          maxLength={2000}
          value={userNotesDraft}
          placeholder="e.g. I prefer concise answers. My main project is called Atlas. Always respond in Spanish."
          onChange={(e) => handleNotesChange(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
        />
        <p className="text-xs text-muted" style={{ marginTop: 4 }}>
          {userNotesDraft.length}/2000 characters · Auto-saves as you type
        </p>
      </div>

      {/* ── Conversation context ──────────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Conversation context</span>
        </div>

        <div className="form-row">
          <label className="form-label">Recent turns</label>
          <select className="form-input" value={settings.memory_context_limit ?? 20} onChange={(event) => void onSave({ memory_context_limit: Number(event.target.value) })}>
            <option value="4">4 Turns (Lean)</option>
            <option value="6">6 Turns (Compact)</option>
            <option value="10">10 Turns (Eco Context)</option>
            <option value="20">20 Turns (Standard)</option>
            <option value="50">50 Turns (Deep Context)</option>
            <option value="100">100 Turns (Long Context)</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Messages kept after compression</label>
          <select
            className="form-input"
            value={settings.memory_compact_threshold ?? 10}
            onChange={(event) => void onSave({ memory_compact_threshold: Number(event.target.value) })}
          >
            <option value="8">8 messages</option>
            <option value="10">10 messages</option>
            <option value="20">20 messages</option>
            <option value="40">40 messages</option>
          </select>
        </div>
        <p className="text-xs text-muted">
          A turn is a user message and reply. Helix keeps this recent window and summarizes older messages when the limit is exceeded.
        </p>

        <div className="form-row">
          <label className="form-label">Automatic compression</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.memory_auto_compaction ?? true} onChange={(event) => void onSave({ memory_auto_compaction: event.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>

      {/* ── Semantic search ───────────────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Semantic search</span>
          <span className={`status-badge ${memoryStatus?.pgvector_ready ? 'status-badge--healthy' : 'status-badge--unconfigured'}`}>
            {memoryStatus?.pgvector_ready ? 'pgvector Ready' : 'Local memory only'}
          </span>
        </div>
        {memoryStatus && <p className="text-xs text-muted">{memoryStatus.message}</p>}

        <div className="form-row">
          <label className="form-label">Embedding Model</label>
          <select className="form-input" value={settings.embedding_model || 'text-embedding-3-small'} onChange={(event) => void onSave({ embedding_model: event.target.value })}>
            <option value="text-embedding-3-small">OpenAI text-embedding-3-small (1536 dim)</option>
            <option value="text-embedding-004">Google text-embedding-004 (768 dim)</option>
          </select>
        </div>
        <p className="text-xs text-muted">
          Semantic storage requires an explicit HELIX_MEMORY_DATABASE_URL and the selected provider's API key. Conversation text is sent to OpenAI or Google for embeddings and stored in that separate database.
        </p>

        <div className="form-row">
          <label className="form-label">Vector Similarity Threshold (Cosine)</label>
          <input className="form-input" type="number" min={0.5} max={0.95} step={0.05} value={settings.memory_similarity_threshold ?? 0.75} onChange={(event) => void onSave({ memory_similarity_threshold: Number(event.target.value) })} />
        </div>
      </div>

      {/* ── Maintenance ───────────────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Memory Maintenance</span>
          {clearedNotice && (
            <span className="status-badge status-badge--healthy">
              Session cleared
            </span>
          )}
        </div>
        {maintenanceError && <p className="toolbox-error" role="alert">{maintenanceError}</p>}

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Clear conversation buffer</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Does not delete the user memory profile.</p>
          </div>
          <button
            type="button"
            className="validate-btn"
            style={{ background: 'rgba(212, 84, 74, 0.15)', borderColor: 'var(--red)', color: 'var(--chalk)' }}
            onClick={() => void handleClearConversation()}
          >
            Clear conversation
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 8 }}>
          <div>
            <span className="text-sm weight-medium text-bone">Clear all memory</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Deletes both the Helix summary and your notes. Cannot be undone.</p>
          </div>
          <button
            type="button"
            className="validate-btn"
            style={{ background: 'rgba(212, 84, 74, 0.15)', borderColor: 'var(--red)', color: 'var(--chalk)' }}
            onClick={() => void handleClearAll()}
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  )
}
