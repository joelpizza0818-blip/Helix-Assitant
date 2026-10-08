import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function MemorySection({ settings, onSave }: Props) {
  const [clearedNotice, setClearedNotice] = useState(false)

  const handleClearMemory = () => {
    void onSave({ application_memory: {} })
    setClearedNotice(true)
    setTimeout(() => setClearedNotice(false), 3000)
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Tiered Memory & Semantic Knowledge</h2>
      <p className="toolbox-section__desc">
        Configure conversation history limits, long-term memory retention, vector embeddings, and PostgreSQL pgvector integration for context retrieval.
      </p>

      {/* ── Short-Term Conversational Memory ───────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Short-Term Context Buffer</span>
        </div>

        <div className="form-row">
          <label className="form-label">Recent Conversation Turn Limit</label>
          <select className="form-input" value={settings.memory_context_limit ?? 20} onChange={(event) => void onSave({ memory_context_limit: Number(event.target.value) })}>
            <option value="4">4 Turns (Lean)</option>
            <option value="6">6 Turns (Compact)</option>
            <option value="10">10 Turns (Eco Context)</option>
            <option value="20">20 Turns (Standard)</option>
            <option value="50">50 Turns (Deep Context)</option>
            <option value="100">100 Turns (Long Context)</option>
          </select>
        </div>
        <p className="text-xs text-muted">
          A turn is one user message and the assistant reply. This limit is applied to text and voice conversations.
        </p>

        <div className="form-row">
          <label className="form-label">Automatic Context Compaction / Summarization</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.memory_auto_compaction ?? true} onChange={(event) => void onSave({ memory_auto_compaction: event.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
        <p className="text-xs text-muted">
          When enabled, older turns are condensed into a short extractive session summary. When disabled, older turns are dropped and only the selected recent window is sent. Neither option makes an extra model call.
        </p>
      </div>

      {/* ── Long-Term Semantic Memory (pgvector) ────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Long-Term Semantic Vector Storage</span>
          <span className="status-badge status-badge--healthy">pgvector Ready</span>
        </div>

        <div className="form-row">
          <label className="form-label">Embedding Model</label>
          <select className="form-input" value={settings.embedding_model || 'text-embedding-3-small'} onChange={(event) => void onSave({ embedding_model: event.target.value })}>
            <option value="text-embedding-3-small">OpenAI text-embedding-3-small (1536 dim)</option>
            <option value="text-embedding-004">Google text-embedding-004 (768 dim)</option>
            <option value="local_bge">Local BGE-Small-EN (Offline HuggingFace model)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Vector Similarity Threshold (Cosine)</label>
          <input className="form-input" type="number" min={0.5} max={0.95} step={0.05} value={settings.memory_similarity_threshold ?? 0.75} onChange={(event) => void onSave({ memory_similarity_threshold: Number(event.target.value) })} />
        </div>
      </div>

      {/* ── Maintenance & Cache Flush ──────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Memory Maintenance</span>
          {clearedNotice && (
            <span className="status-badge status-badge--healthy">
              Memory Cache Cleared
            </span>
          )}
        </div>

        <div className="form-row">
          <div>
            <span className="text-sm weight-medium text-bone">Clear Active Session Memory</span>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>Flushes current conversational buffer without deleting long-term stored documents.</p>
          </div>
          <button
            type="button"
            className="validate-btn"
            style={{ background: 'rgba(212, 84, 74, 0.15)', borderColor: 'var(--red)', color: 'var(--chalk)' }}
            onClick={handleClearMemory}
          >
            Clear Buffer
          </button>
        </div>
      </div>
    </div>
  )
}
