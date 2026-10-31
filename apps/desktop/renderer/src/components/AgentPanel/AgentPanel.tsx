import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentProfileDraft,
  AgentRole,
  AgentChatResponse,
  AgentLifecycleEvent,
  AgentProfile,
  AgentRoutingOptions,
  UserMemory,
} from '../../types/global'
import './AgentPanel.css'

type ChatTurn = { role: 'user' | 'assistant'; content: string }
type ProfileFilter = 'all' | 'invoked' | 'available'
type ProfileDraft = Omit<AgentProfileDraft, 'capabilities'> & { capabilities: string }

const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  name: '',
  role: 'research',
  description: '',
  capabilities: '',
  color: '#ee6018',
  instructions: '',
}

function toProfileDraft(profile: AgentProfile): ProfileDraft {
  return {
    name: profile.name,
    role: profile.role,
    description: profile.description,
    capabilities: profile.capabilities.join(', '),
    color: profile.color,
    instructions: profile.instructions,
  }
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested operation failed.'
}

export default function AgentPanel() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [statuses, setStatuses] = useState<AgentLifecycleEvent[]>([])
  const [resourceWaits, setResourceWaits] = useState<Record<string, string>>({})
  const [routingOptions, setRoutingOptions] = useState<AgentRoutingOptions>({
    providers: [],
    models: [],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ProfileFilter>('all')
  const [showRouting, setShowRouting] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT)
  const [savingProfile, setSavingProfile] = useState(false)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [keySlot, setKeySlot] = useState<number | null>(null)
  const [turnsByProfile, setTurnsByProfile] = useState<Record<string, ChatTurn[]>>({})
  const [messagesByProfile, setMessagesByProfile] = useState<Record<string, string>>({})
  const [sendingProfiles, setSendingProfiles] = useState<Set<string>>(() => new Set())
  const [chatErrors, setChatErrors] = useState<Record<string, string>>({})
  const [memories, setMemories] = useState<UserMemory[]>([])
  const [memoryDraft, setMemoryDraft] = useState('')
  const [memoryCategory, setMemoryCategory] = useState<UserMemory['category']>('general')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingRoute, setSavingRoute] = useState(false)
  const [promotionNotice, setPromotionNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preserveKeySelection = useRef(false)
  const sendingProfilesRef = useRef(new Set<string>())
  const statusRequestRef = useRef<Promise<AgentLifecycleEvent[]> | null>(null)

  const selectedProfile = profiles.find((profile) => profile.profile_id === selectedId) ?? null
  const selectedTurns = selectedId ? turnsByProfile[selectedId] ?? [] : []
  const message = selectedId ? messagesByProfile[selectedId] ?? '' : ''
  const selectedProfileSending = selectedId ? sendingProfiles.has(selectedId) : false
  const selectedProvider = routingOptions.providers.find((item) => item.id === provider)
  const availableModels = routingOptions.models.filter((item) => item.provider === provider)
  const selectedStatus = selectedId
    ? statuses
      .filter((status) => status.profile_id === selectedId)
      .sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''))[0]
    : undefined

  const refresh = useCallback(async (includeRouting: boolean, includeProfiles = false) => {
    if (!statusRequestRef.current) {
      const request = window.helix.getSubagentStatus().finally(() => {
        statusRequestRef.current = null
      })
      statusRequestRef.current = request
    }
    const [nextProfiles, nextStatuses, nextRouting] = await Promise.all([
      includeProfiles
        ? window.helix.getSubagentProfiles()
        : Promise.resolve(null),
      statusRequestRef.current,
      includeRouting
        ? window.helix.getSubagentRoutingOptions()
        : Promise.resolve(null),
    ])
    if (nextProfiles) {
      setProfiles(nextProfiles)
      setSelectedId((current) => (
        current && nextProfiles.some((profile) => profile.profile_id === current)
          ? current
          : nextProfiles[0]?.profile_id ?? null
      ))
    }
    setStatuses(nextStatuses)
    if (nextRouting) setRoutingOptions(nextRouting)
  }, [])

  useEffect(() => {
    let active = true
    void refresh(true, true)
      .catch((cause: unknown) => {
        if (active) setError(messageFromError(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const interval = window.setInterval(() => {
      void refresh(false)
        .catch((cause: unknown) => {
          if (active) setError(messageFromError(cause))
        })
    }, 1600)
    const removeListener = window.helix.onAgentUpdate((event) => {
      if (event.promotion) {
        setPromotionNotice(`${event.name ?? 'A teammate'} promoted: ${event.promotion}`)
        window.setTimeout(() => setPromotionNotice(null), 6000)
      }
      if (event.task_id) {
        setResourceWaits((current) => {
          if (event.status === 'waiting' && event.resource) {
            return { ...current, [event.task_id as string]: event.resource }
          }
          const next = { ...current }
          delete next[event.task_id as string]
          return next
        })
      }
      const profilesChanged = event.event_type === 'SUBAGENT_SPAWNED'
        || event.event_type === 'SUBAGENT_PROMOTED'
      void refresh(false, profilesChanged)
        .catch((cause: unknown) => {
          if (active) setError(messageFromError(cause))
        })
    })
    return () => {
      active = false
      window.clearInterval(interval)
      removeListener()
    }
  }, [refresh])

  useEffect(() => {
    if (!selectedProfile) return
    if (preserveKeySelection.current) {
      preserveKeySelection.current = false
      return
    }
    setProvider(selectedProfile.model_route?.provider ?? '')
    setModel(selectedProfile.model_route?.model ?? '')
    setKeySlot(selectedProfile.model_route?.key_slot ?? null)
  }, [selectedProfile?.profile_id, selectedProfile?.model_route?.provider, selectedProfile?.model_route?.model, selectedProfile?.model_route?.key_slot])

  useEffect(() => {
    if (!selectedProfile) {
      setMemories([])
      return
    }
    let active = true
    void window.helix.getSubagentMemories(selectedProfile.profile_id)
      .then((items) => {
        if (active) setMemories(items)
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFromError(cause))
      })
    setMemoryDraft('')
    setEditingMemoryId(null)
    return () => {
      active = false
    }
  }, [selectedProfile?.profile_id])

  const profileStatuses = useMemo(() => {
    const map = new Map<string, AgentLifecycleEvent[]>()
    for (const status of statuses) {
      if (!status.profile_id) continue
      map.set(status.profile_id, [...(map.get(status.profile_id) ?? []), status])
    }
    return map
  }, [statuses])

  const filteredProfiles = profiles.filter((profile) => {
    const invoked = (profileStatuses.get(profile.profile_id)?.length ?? 0) > 0
    if (filter === 'invoked') return invoked
    if (filter === 'available') return !invoked
    return true
  })
  const invokedProfiles = profiles.filter(
    (profile) => (profileStatuses.get(profile.profile_id)?.length ?? 0) > 0,
  )
  const availableProfiles = profiles.filter(
    (profile) => (profileStatuses.get(profile.profile_id)?.length ?? 0) === 0,
  )

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault()
    const text = message.trim()
    if (!selectedProfile || !text) return
    const profileId = selectedProfile.profile_id
    if (sendingProfilesRef.current.has(profileId)) return
    const nextSendingProfiles = new Set(sendingProfilesRef.current)
    nextSendingProfiles.add(profileId)
    sendingProfilesRef.current = nextSendingProfiles
    setSendingProfiles(nextSendingProfiles)
    setMessagesByProfile((current) => {
      const next = { ...current }
      delete next[profileId]
      return next
    })
    setChatErrors((current) => {
      const next = { ...current }
      delete next[profileId]
      return next
    })
    setTurnsByProfile((current) => ({
      ...current,
      [profileId]: [...(current[profileId] ?? []), { role: 'user', content: text }],
    }))
    try {
      const reply: AgentChatResponse = await window.helix.chatWithSubagent(profileId, text)
      setTurnsByProfile((current) => ({
        ...current,
        [profileId]: [
          ...(current[profileId] ?? []),
          { role: 'assistant', content: reply.response },
        ],
      }))
    } catch (cause) {
      setChatErrors((current) => ({
        ...current,
        [profileId]: messageFromError(cause),
      }))
    } finally {
      const remainingSendingProfiles = new Set(sendingProfilesRef.current)
      remainingSendingProfiles.delete(profileId)
      sendingProfilesRef.current = remainingSendingProfiles
      setSendingProfiles(remainingSendingProfiles)
    }
  }

  const saveRoute = async () => {
    if (!selectedProfile || savingRoute) return
    setSavingRoute(true)
    setError(null)
    try {
      const saved = await window.helix.setSubagentRoute(
        selectedProfile.profile_id,
        provider || null,
        provider ? model || null : null,
        provider ? (selectedProvider?.no_key_required ? 0 : keySlot) : null,
      )
      setProfiles((current) => current.map((profile) => (
        profile.profile_id === saved.profile_id ? saved : profile
      )))
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setSavingRoute(false)
    }
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (savingProfile) return
    const profile: AgentProfileDraft = {
      name: profileDraft.name.trim(),
      role: profileDraft.role,
      description: profileDraft.description.trim(),
      capabilities: profileDraft.capabilities.split(',').map((item) => item.trim()).filter(Boolean),
      color: profileDraft.color,
      instructions: profileDraft.instructions.trim(),
    }
    setSavingProfile(true)
    setError(null)
    try {
      const saved = editingProfileId
        ? await window.helix.updateSubagentProfile(editingProfileId, profile)
        : await window.helix.createSubagentProfile(profile)
      setProfiles((current) => editingProfileId
        ? current.map((item) => item.profile_id === saved.profile_id ? saved : item)
        : [...current, saved])
      setSelectedId(saved.profile_id)
      setProfileEditorOpen(false)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setSavingProfile(false)
    }
  }

  const editProfile = (profile: AgentProfile) => {
    setEditingProfileId(profile.profile_id)
    setProfileDraft(toProfileDraft(profile))
    setProfileEditorOpen(true)
  }

  const createProfile = () => {
    setEditingProfileId(null)
    setProfileDraft(EMPTY_PROFILE_DRAFT)
    setProfileEditorOpen(true)
  }

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfile || !memoryDraft.trim()) return
    setError(null)
    try {
      const saved = editingMemoryId
        ? await window.helix.updateSubagentMemory(
          selectedProfile.profile_id,
          editingMemoryId,
          memoryDraft.trim(),
          memoryCategory,
        )
        : await window.helix.saveSubagentMemory(
          selectedProfile.profile_id,
          memoryDraft.trim(),
          memoryCategory,
        )
      setMemories((current) => editingMemoryId
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved])
      setMemoryDraft('')
      setEditingMemoryId(null)
    } catch (cause) {
      setError(messageFromError(cause))
    }
  }

  const deleteMemory = async (memoryId: string) => {
    if (!selectedProfile) return
    setError(null)
    try {
      await window.helix.deleteSubagentMemory(selectedProfile.profile_id, memoryId)
      setMemories((current) => current.filter((item) => item.id !== memoryId))
      if (editingMemoryId === memoryId) {
        setEditingMemoryId(null)
        setMemoryDraft('')
      }
    } catch (cause) {
      setError(messageFromError(cause))
    }
  }

  return (
    <main className="agent-panel">
      <header className="agent-panel__header">
        <div>
          <div className="agent-panel__eyebrow">HELIX WORKSPACE</div>
          <h1>Subagents</h1>
          <p>Persistent teammates, customizable profiles, separate turns.</p>
        </div>
        <div className="agent-panel__header-actions">
          <button type="button" className="agent-panel__primary" onClick={createProfile}>New agent</button>
          <button
            type="button"
            className={`agent-panel__key-button ${showRouting ? 'is-active' : ''}`}
            onClick={() => setShowRouting((visible) => !visible)}
            title="Configure model and key assignments"
            aria-label="Configure model and key assignments"
            aria-pressed={showRouting}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="15" r="4" />
              <path d="m11 12 9-9m-4 4 3 3m-6 0 3 3" />
            </svg>
          </button>
        </div>
      </header>

      {error && <div className="agent-panel__error" role="alert">{error}</div>}
      {promotionNotice && <div className="agent-panel__promotion" role="status">{promotionNotice}</div>}

      {showRouting && selectedProfile && (
        <section className="agent-routing">
          <div className="agent-routing__heading">
            <div>
              <h2>Optional model routing</h2>
              <p>Choose a provider and model, then connect a key to a teammate. Keys can be reused by multiple agents.</p>
            </div>
            <button type="button" className="agent-routing__clear" onClick={() => {
              preserveKeySelection.current = false
              setProvider('')
              setModel('')
              setKeySlot(null)
            }}>
              Clear selection
            </button>
          </div>
          <div className="agent-routing__map">
            <div className="agent-routing__key-column">
              <div className="agent-routing__route-inputs">
                <label>
                  Provider
                  <select value={provider} onChange={(event) => {
                    preserveKeySelection.current = false
                    setProvider(event.target.value)
                    setModel('')
                    setKeySlot(null)
                  }}>
                    <option value="">Automatic</option>
                    {routingOptions.providers.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Model
                  <select
                    value={model}
                    disabled={!provider}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    <option value="">Choose model</option>
                    {availableModels.map((item) => (
                      <option key={`${item.provider}:${item.id}`} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="agent-routing__keys">
                <h3>API keys</h3>
                {!provider ? (
                  <p>Choose a provider to see its configured keys.</p>
                ) : selectedProvider?.no_key_required ? (
                  <p style={{ color: '#a0ca92' }}>✓ Este proveedor no requiere API key (0-cost cloud o inferencia local Ollama).</p>
                ) : selectedProvider?.key_slots.length ? (
                  selectedProvider.key_slots.map((slot) => {
                    const assignedProfiles = profiles.filter((profile) => (
                      profile.model_route?.provider === provider
                      && profile.model_route?.key_slot === slot
                    ))
                    return (
                      <button
                        type="button"
                        key={slot}
                        className={keySlot === slot ? 'is-selected' : ''}
                        aria-pressed={keySlot === slot}
                        onClick={() => {
                          preserveKeySelection.current = true
                          setKeySlot(slot)
                        }}
                      >
                        <span className="agent-routing__key-mark" />
                        <span>
                          <strong>Key {slot + 1}</strong>
                          <small>{assignedProfiles.length
                            ? `Paired with ${assignedProfiles.map((profile) => profile.name).join(', ')}`
                            : 'Unassigned'}</small>
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <p>No configured keys for this provider.</p>
                )}
              </div>
            </div>
            <svg
              className={`agent-routing__connector ${provider && (keySlot !== null || selectedProvider?.no_key_required) ? 'is-paired' : ''}`}
              viewBox="0 0 120 60"
              aria-hidden="true"
            >
              <path d="M4 30 C40 30, 70 30, 116 30" />
              <circle cx="4" cy="30" r="4" />
              <circle cx="116" cy="30" r="4" />
            </svg>
            <div className="agent-routing__agents">
              {[
                ['Invoked', invokedProfiles],
                ['Not invoked', availableProfiles],
              ].map(([label, items]) => (
                <section key={label as string} className="agent-routing__agent-column">
                  <h3>{label as string}</h3>
                  {(items as AgentProfile[]).map((profile) => (
                    <button
                      type="button"
                      key={profile.profile_id}
                      className={profile.profile_id === selectedProfile.profile_id ? 'is-selected' : ''}
                      style={{ '--agent-color': profile.color } as React.CSSProperties}
                      onClick={() => setSelectedId(profile.profile_id)}
                    >
                      <span className="agent-routing__target-mark">{profile.name.slice(0, 1)}</span>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.role}</small>
                        <small>{profile.model_route?.provider === provider
                          ? `Key ${profile.model_route.key_slot + 1}`
                          : 'No key assigned'}</small>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
          <div className="agent-routing__footer">
            <span>{selectedProfile.model_route
              ? `Pinned to ${selectedProfile.model_route.provider} · ${selectedProfile.model_route.model} · key ${selectedProfile.model_route.key_slot + 1}`
              : 'No route pinned'}
            </span>
            <button
              type="button"
              className="agent-panel__primary"
              disabled={savingRoute || (Boolean(provider) && (!model || keySlot === null))}
              onClick={() => void saveRoute()}
            >
              {savingRoute ? 'Saving…' : 'Apply route'}
            </button>
          </div>
        </section>
      )}

      <div className="agent-panel__body">
        <aside className="agent-panel__roster">
          <div className="agent-panel__filters">
            {(['all', 'invoked', 'available'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={filter === value ? 'is-active' : ''}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="agent-panel__empty">Loading teammates…</p>
          ) : filteredProfiles.length === 0 ? (
            <p className="agent-panel__empty">No teammates in this view.</p>
          ) : (
            <div className="agent-panel__profiles">
              {filteredProfiles.map((profile) => {
                const profileTasks = profileStatuses.get(profile.profile_id) ?? []
                const waitingTask = profileTasks.find((item) => item.agent_id in resourceWaits)
                const current = waitingTask
                  ?? profileTasks.find((item) => item.status === 'running')
                  ?? profileTasks.find((item) => item.status === 'queued')
                  ?? profileTasks[profileTasks.length - 1]
                const waitingResource = current
                  ? resourceWaits[current.agent_id]
                    ?? (current.current_action?.startsWith('Waiting for ')
                      ? current.current_action.slice('Waiting for '.length)
                      : undefined)
                  : undefined
                const chatSending = sendingProfiles.has(profile.profile_id)
                const active = chatSending || Boolean(waitingResource)
                  || current?.status === 'running'
                  || current?.status === 'queued'
                const progress = current?.status === 'completed'
                  ? 100
                  : Math.max(0, Math.min(100, current?.progress ?? 0))
                return (
                  <button
                    type="button"
                    key={profile.profile_id}
                    className={`agent-profile ${selectedId === profile.profile_id ? 'is-selected' : ''}`}
                    style={{ '--agent-color': profile.color } as React.CSSProperties}
                    onClick={() => setSelectedId(profile.profile_id)}
                  >
                    <span className="agent-profile__avatar">{profile.name.slice(0, 1)}</span>
                    <span className="agent-profile__details">
                      <span className="agent-profile__name">{profile.name}</span>
                      <span className="agent-profile__role" title={profile.description}>{profile.role}</span>
                      <span className="agent-profile__progress"><span style={{ width: `${progress}%` }} /></span>
                    </span>
                    <span className={`agent-profile__status ${active ? 'is-active' : ''}`}>
                      {chatSending
                        ? 'responding'
                        : waitingResource
                        ? `waiting · ${waitingResource}`
                        : active ? current?.status : current ? current.status : 'available'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <section className="agent-panel__detail">
          {profileEditorOpen ? (
            <form className="agent-profile-editor" onSubmit={(event) => void saveProfile(event)}>
              <div>
                <h2>{editingProfileId ? 'Customize agent' : 'Create agent'}</h2>
                <p>Profiles are local. Instructions are plain text and cannot add tools or credentials.</p>
              </div>
              <label>
                Name
                <input required minLength={2} maxLength={40} value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} />
              </label>
              <label>
                Specialty
                <select value={profileDraft.role} onChange={(event) => setProfileDraft({ ...profileDraft, role: event.target.value as AgentRole })}>
                  {(['planning', 'coding', 'automation', 'research', 'analysis', 'general'] as const).map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea required maxLength={500} rows={2} value={profileDraft.description} onChange={(event) => setProfileDraft({ ...profileDraft, description: event.target.value })} />
              </label>
              <label>
                Capabilities (comma-separated)
                <input maxLength={820} value={profileDraft.capabilities} onChange={(event) => setProfileDraft({ ...profileDraft, capabilities: event.target.value })} />
              </label>
              <label>
                Color
                <input type="color" value={profileDraft.color} onChange={(event) => setProfileDraft({ ...profileDraft, color: event.target.value })} />
              </label>
              <label>
                Additional instructions
                <textarea maxLength={6000} rows={5} value={profileDraft.instructions} onChange={(event) => setProfileDraft({ ...profileDraft, instructions: event.target.value })} />
              </label>
              <div className="agent-profile-editor__actions">
                <button type="submit" className="agent-panel__primary" disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
                <button type="button" onClick={() => setProfileEditorOpen(false)} disabled={savingProfile}>Cancel</button>
              </div>
            </form>
          ) : selectedProfile ? (
            <>
              <div className="agent-detail__identity" style={{ '--agent-color': selectedProfile.color } as React.CSSProperties}>
                <span className="agent-profile__avatar">{selectedProfile.name.slice(0, 1)}</span>
                <div>
                  <h2>{selectedProfile.name}</h2>
                  <p>{selectedProfile.description}</p>
                  <div className="agent-detail__capabilities">
                    {selectedProfile.capabilities.map((capability) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="agent-detail__status">
                <span>Status</span>
                <strong>{selectedProfileSending ? 'responding' : selectedStatus?.status ?? 'available'}</strong>
                <span>{selectedProfile.model_route
                  ? `${selectedProfile.model_route.provider} · ${selectedProfile.model_route.model} · key ${selectedProfile.model_route.key_slot + 1}`
                  : 'Automatic model routing'}
                </span>
                {(selectedStatus?.status === 'running' || selectedStatus?.status === 'queued')
                  && selectedStatus.agent_id && (
                    <button
                      type="button"
                      className="agent-detail__cancel"
                      onClick={() => window.helix.cancelTask(selectedStatus.agent_id)}
                    >
                      Cancel
                    </button>
                  )}
              </div>
              <div className="agent-profile-editor__actions">
                <button type="button" onClick={() => editProfile(selectedProfile)}>Customize profile</button>
              </div>
              <details className="agent-memory">
                <summary>Private memory <span>{memories.length} saved</span></summary>
                <p>Only {selectedProfile.name} uses these notes. They stay local and can be edited or removed here.</p>
                {memories.map((item) => (
                  <div className="agent-memory__item" key={item.id}>
                    <div><span>{item.category}</span><p>{item.text}</p></div>
                    <button type="button" onClick={() => {
                      setEditingMemoryId(item.id)
                      setMemoryDraft(item.text)
                      setMemoryCategory(item.category)
                    }}>Edit</button>
                    <button type="button" onClick={() => void deleteMemory(item.id)}>Delete</button>
                  </div>
                ))}
                <form className="agent-memory__form" onSubmit={(event) => void saveMemory(event)}>
                  <textarea
                    value={memoryDraft}
                    onChange={(event) => setMemoryDraft(event.target.value)}
                    placeholder="A short useful fact for this teammate…"
                    maxLength={500}
                    rows={2}
                  />
                  <select
                    value={memoryCategory}
                    onChange={(event) => setMemoryCategory(event.target.value as UserMemory['category'])}
                  >
                    {(['preference', 'fact', 'project', 'instruction', 'general'] as const).map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <button type="submit" className="agent-panel__primary" disabled={!memoryDraft.trim()}>
                    {editingMemoryId ? 'Update memory' : 'Save memory'}
                  </button>
                  {editingMemoryId && (
                    <button type="button" onClick={() => {
                      setEditingMemoryId(null)
                      setMemoryDraft('')
                    }}>Cancel</button>
                  )}
                </form>
              </details>
              <div className="agent-chat">
                <div className="agent-chat__heading">
                  <div><h3>Direct chat</h3><span>Each message is a separate model turn.</span></div>
                </div>
                <div className="agent-chat__messages" aria-live="polite">
                  {selectedTurns.length === 0 && (
                    <p className="agent-chat__empty">Start a private turn with {selectedProfile.name}. Their profile memory is separate from other teammates.</p>
                  )}
                  {selectedTurns.map((turn, index) => (
                    <div className={`agent-chat__message is-${turn.role}`} key={`${index}-${turn.role}`}>
                      <span>{turn.role === 'user' ? 'You' : selectedProfile.name}</span>
                      <p>{turn.content}</p>
                    </div>
                  ))}
                  {selectedProfileSending && <div className="agent-chat__working">{selectedProfile.name} is responding…</div>}
                  {chatErrors[selectedProfile.profile_id] && (
                    <div className="agent-panel__error" role="alert">
                      {chatErrors[selectedProfile.profile_id]}
                    </div>
                  )}
                </div>
                <form className="agent-chat__form" onSubmit={(event) => void sendMessage(event)}>
                  <textarea
                    value={message}
                    onChange={(event) => {
                      const profileId = selectedProfile.profile_id
                      setMessagesByProfile((current) => ({
                        ...current,
                        [profileId]: event.target.value,
                      }))
                    }}
                    placeholder={`Message ${selectedProfile.name}…`}
                    maxLength={4000}
                    rows={2}
                    disabled={selectedProfileSending}
                  />
                  <button type="submit" className="agent-panel__primary" disabled={selectedProfileSending || !message.trim()}>
                    {selectedProfileSending ? 'Sending…' : 'Send'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="agent-panel__empty">Select a teammate to inspect their work or start a direct chat.</div>
          )}
        </section>
      </div>
    </main>
  )
}
