import React, { useEffect, useState } from 'react'
import type { HelixSettings, MemoryStatus, UserMemory } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function MemorySection({ settings, onSave }: Props) {
  const [clearedNotice, setClearedNotice] = useState(false)
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)
  const [userMemories, setUserMemories] = useState<UserMemory[]>([])
  const [memoryText, setMemoryText] = useState('')
  const [memoryCategory, setMemoryCategory] = useState<UserMemory['category']>('preference')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [savingMemory, setSavingMemory] = useState(false)

  const handleClearMemory = async () => {
    setMaintenanceError(null)
    try {
      await window.helix.clearMemory()
      setClearedNotice(true)
      setTimeout(() => setClearedNotice(false), 3000)
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not clear conversation memory.')
    }
  }

  const refreshUserMemories = async () => {
    try {
      setUserMemories(await window.helix.getUserMemories())
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not load saved memories.')
    }
  }

  const saveUserMemory = async () => {
    setSavingMemory(true)
    setMaintenanceError(null)
    try {
      if (editingMemoryId) {
        await window.helix.updateUserMemory(editingMemoryId, memoryText, memoryCategory)
      } else {
        await window.helix.saveUserMemory(memoryText, memoryCategory)
      }
      setMemoryText('')
      setEditingMemoryId(null)
      await refreshUserMemories()
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not save this memory.')
    } finally {
      setSavingMemory(false)
    }
  }

  const deleteUserMemory = async (memoryId: string) => {
    if (!window.confirm('Delete this saved memory?')) return
    setMaintenanceError(null)
    try {
      await window.helix.deleteUserMemory(memoryId)
      await refreshUserMemories()
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not delete this memory.')
    }
  }

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const status = await window.helix.getMemoryStatus()
        if (active) setMemoryStatus(status)
        const memories = await window.helix.getUserMemories()
        if (active) setUserMemories(memories)
      } catch (error) {
        if (active) {
          setMaintenanceError(error instanceof Error ? error.message : 'Could not load memory settings.')
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Memory</h2>
      <p className="toolbox-section__desc">
        Review what HELIX remembers and control automatic context compression.
      </p>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Saved user memories</span>
          <span className="status-badge">{userMemories.length} saved</span>
        </div>
        <p className="text-xs text-muted">
          HELIX saves only durable, useful details. Memories stay on this device; edit or remove them anytime.
        </p>
        <div className="form-row">
          <label className="form-label" htmlFor="user-memory-text">Memory</label>
          <input
            id="user-memory-text"
            className="form-input"
            maxLength={500}
            value={memoryText}
            placeholder="A preference, ongoing project, or instruction"
            onChange={(event) => setMemoryText(event.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="user-memory-category">Category</label>
          <select
            id="user-memory-category"
            className="form-input"
            value={memoryCategory}
            onChange={(event) => setMemoryCategory(event.target.value as UserMemory['category'])}
          >
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="project">Project</option>
            <option value="instruction">Instruction</option>
            <option value="general">General</option>
          </select>
        </div>
        <div className="toolbox-skill-actions">
          <button
            type="button"
            className="validate-btn"
            disabled={savingMemory || !memoryText.trim()}
            onClick={() => void saveUserMemory()}
          >
            {savingMemory ? 'Saving…' : editingMemoryId ? 'Save changes' : 'Add memory'}
          </button>
          {editingMemoryId && (
            <button type="button" className="validate-btn" onClick={() => {
              setEditingMemoryId(null)
              setMemoryText('')
            }}>
              Cancel
            </button>
          )}
        </div>
        {userMemories.map((memory) => (
          <article className="toolbox-card" key={memory.id}>
            <div className="toolbox-card__header">
              <span className="toolbox-card__title">{memory.category}</span>
              <div className="toolbox-skill-actions">
                <button type="button" className="validate-btn" onClick={() => {
                  setEditingMemoryId(memory.id)
                  setMemoryText(memory.text)
                  setMemoryCategory(memory.category)
                }}>
                  Edit
                </button>
                <button type="button" className="validate-btn toolbox-danger-button" onClick={() => void deleteUserMemory(memory.id)}>
                  Delete
                </button>
              </div>
            </div>
            <p className="text-sm text-bone">{memory.text}</p>
          </article>
        ))}
        {userMemories.length === 0 && <p className="text-xs text-muted">No saved memories.</p>}
      </div>

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
          A turn is a user message and reply. HELIX keeps this recent window and summarizes older messages when the limit is exceeded.
        </p>

        <div className="form-row">
          <label className="form-label">Automatic compression</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.memory_auto_compaction ?? true} onChange={(event) => void onSave({ memory_auto_compaction: event.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>

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
            Semantic storage requires an explicit HELIX_MEMORY_DATABASE_URL and the selected provider's API key. Conversation text is sent to OpenAI or Google for embeddings and stored in that separate database. The backend database connection is never reused.
          </p>

        <div className="form-row">
          <label className="form-label">Vector Similarity Threshold (Cosine)</label>
          <input className="form-input" type="number" min={0.5} max={0.95} step={0.05} value={settings.memory_similarity_threshold ?? 0.75} onChange={(event) => void onSave({ memory_similarity_threshold: Number(event.target.value) })} />
        </div>
      </div>

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
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Does not delete saved user memories.</p>
          </div>
          <button
            type="button"
            className="validate-btn"
            style={{ background: 'rgba(212, 84, 74, 0.15)', borderColor: 'var(--red)', color: 'var(--chalk)' }}
            onClick={() => void handleClearMemory()}
          >
            Clear conversation
          </button>
        </div>
      </div>
    </div>
  )
}
