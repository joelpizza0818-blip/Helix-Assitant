import { useEffect, useState } from 'react'
import type { SkillSummary } from '../../../types/global'
import '../Toolbox.css'

const emptySkill = {
  name: '',
  description: '',
  triggers: '',
  tools: '',
  instructions: '',
}

export default function SkillsSection() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [draft, setDraft] = useState(emptySkill)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSkills = async () => {
    setError(null)
    try {
      setSkills(await window.helix.getSkills())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load skills.')
    }
  }

  useEffect(() => {
    void loadSkills()
  }, [])

  const editSkill = (skill: SkillSummary) => {
    setEditingName(skill.name)
    setDraft({
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers.join(', '),
      tools: skill.tools.join(', '),
      instructions: skill.instructions,
    })
    setError(null)
  }

  const saveSkill = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.helix.saveSkill({
        ...draft,
        triggers: draft.triggers.split(',').map((value) => value.trim()).filter(Boolean),
        tools: draft.tools.split(',').map((value) => value.trim()).filter(Boolean),
      })
      setSkills((current) => [
        saved,
        ...current.filter((skill) => skill.name !== saved.name),
      ].sort((left, right) => left.name.localeCompare(right.name)))
      setDraft(emptySkill)
      setEditingName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save skill.')
    } finally {
      setBusy(false)
    }
  }

  const deleteSkill = async (name: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.helix.deleteSkill(name)
      setSkills((current) => current.filter((skill) => skill.name !== name))
      if (editingName === name) {
        setDraft(emptySkill)
        setEditingName(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete skill.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Skills</h2>
      <p className="toolbox-section__desc">
        Create reusable instruction sets for HELIX. Custom skills are saved locally and can be invoked with @skill-name.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">{editingName ? `Edit @${editingName}` : 'Create a skill'}</span>
          {editingName && (
            <button type="button" className="validate-btn" onClick={() => {
              setDraft(emptySkill)
              setEditingName(null)
            }}>
              Cancel
            </button>
          )}
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="skill-name">Name</label>
          <input id="skill-name" className="form-input" value={draft.name} disabled={Boolean(editingName)} placeholder="e.g. meeting-notes" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="skill-description">Description</label>
          <input id="skill-description" className="form-input" value={draft.description} placeholder="What this skill helps HELIX do" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="skill-triggers">Triggers</label>
          <input id="skill-triggers" className="form-input" value={draft.triggers} placeholder="comma-separated phrases" onChange={(event) => setDraft({ ...draft, triggers: event.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="skill-tools">Tool names</label>
          <input id="skill-tools" className="form-input" value={draft.tools} placeholder="optional, comma-separated" onChange={(event) => setDraft({ ...draft, tools: event.target.value })} />
        </div>
        <label className="form-label toolbox-skill-instructions-label" htmlFor="skill-instructions">Instructions</label>
        <textarea id="skill-instructions" className="form-input toolbox-skill-instructions" value={draft.instructions} placeholder="Write the instructions HELIX should follow when this skill is active." onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
        <button type="button" className="validate-btn toolbox-action-button" disabled={busy || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()} onClick={() => void saveSkill()}>
          {busy ? 'Saving…' : editingName ? 'Save changes' : 'Create skill'}
        </button>
      </div>
      <h3 className="toolbox-card__title toolbox-skill-list-title">Available skills</h3>
      {skills.length === 0 ? (
        <p className="text-xs text-muted">No skills found.</p>
      ) : skills.map((skill) => (
        <article className="toolbox-card" key={skill.name}>
          <div className="toolbox-card__header">
            <div>
              <div className="toolbox-card__title">@{skill.name}</div>
              <p className="text-xs text-muted">{skill.description}</p>
            </div>
            {skill.custom && (
              <div className="toolbox-skill-actions">
                <button type="button" className="validate-btn" disabled={busy} onClick={() => editSkill(skill)}>Edit</button>
                <button type="button" className="validate-btn toolbox-danger-button" disabled={busy} onClick={() => void deleteSkill(skill.name)}>Delete</button>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">{skill.custom ? 'Custom' : 'Built-in'} · {skill.triggers.length} triggers</p>
        </article>
      ))}
    </section>
  )
}
