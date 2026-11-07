import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProjectFileEntry, ProjectFilesResult } from '../../../types/global'
import './ProjectFilesPanel.css'

interface Props {
  projectId: string | null
  selectedFilePath: string | null
  onOpenFile: (relativePath: string) => void
}

function getEntries(result: ProjectFilesResult): ProjectFileEntry[] {
  if (!Array.isArray(result.entries)) {
    throw new Error('The project file list could not be loaded.')
  }
  return result.entries
}

export default function ProjectFilesPanel({ projectId, selectedFilePath, onOpenFile }: Props) {
  const [entries, setEntries] = useState<ProjectFileEntry[]>([])
  const [selectedDirectory, setSelectedDirectory] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [entryName, setEntryName] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setSelectedDirectory('')
    setExpandedFolders(new Set())
    setEntries([])
    setTruncated(false)
    setError(null)
    if (!projectId) {
      setEntries([])
      setSelectedDirectory('')
      return
    }
    void window.helix.getProjectFiles(projectId)
      .then((result) => {
        if (!active) return
        setEntries(getEntries(result))
        setTruncated(Boolean(result.truncated))
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load project files.')
      })
    return () => { active = false }
  }, [projectId])

  const runOperation = async (operation: () => Promise<ProjectFilesResult>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      if (!result.canceled) {
        setEntries(getEntries(result))
        setTruncated(Boolean(result.truncated))
        return true
      }
      return false
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update project files.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const createEntry = (type: 'file' | 'folder') => {
    const name = entryName.trim()
    if (!projectId || !name) return
    const path = selectedDirectory ? `${selectedDirectory}/${name}` : name
    void runOperation(() => window.helix.createProjectEntry(projectId, path, type))
      .then((succeeded) => { if (succeeded) setEntryName('') })
  }

  const importFiles = () => {
    if (!projectId) return
    void runOperation(() => window.helix.importProjectFiles(projectId, selectedDirectory))
  }

  const toggleFolder = (entry: ProjectFileEntry) => {
    setSelectedDirectory(entry.path)
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }

  const renderEntries = (items: ProjectFileEntry[], depth = 0): ReactNode => items.map((entry) => {
    const expanded = expandedFolders.has(entry.path)
    return (
      <div key={entry.path}>
        <button
          type="button"
          className={`project-files-panel__entry ${
            (entry.type === 'folder' && selectedDirectory === entry.path)
            || (entry.type === 'file' && selectedFilePath === entry.path)
              ? 'is-selected'
              : ''
          }`}
          style={{ paddingLeft: 10 + depth * 14 }}
          title={entry.path}
          onClick={() => {
            if (entry.type === 'folder') toggleFolder(entry)
            else onOpenFile(entry.path)
          }}
          aria-expanded={entry.type === 'folder' ? expanded : undefined}
        >
          <span className="project-files-panel__entry-mark">
            {entry.type === 'folder' ? (expanded ? '▾' : '▸') : ''}
          </span>
          <span className={entry.type === 'folder' ? 'project-files-panel__folder' : ''}>
            {entry.name}
          </span>
        </button>
        {entry.type === 'folder' && expanded && entry.children?.length
          ? renderEntries(entry.children, depth + 1)
          : null}
      </div>
    )
  })

  return (
    <div className="project-files-panel">
      <div className="project-files-panel__toolbar">
        <strong>Project files</strong>
        <button
          type="button"
          className="project-files-panel__import"
          onClick={importFiles}
          disabled={!projectId || busy}
          title="Import files into the selected folder"
          aria-label="Import files"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
          </svg>
          <span>Import</span>
        </button>
      </div>

      <button
        type="button"
        className={`project-files-panel__root ${selectedDirectory === '' ? 'is-selected' : ''}`}
        onClick={() => setSelectedDirectory('')}
        disabled={!projectId}
      >
        {projectId ? 'Project root' : 'Select a project to browse files'}
      </button>
      <div className="project-files-panel__tree" aria-label="Project file tree">
        {renderEntries(entries)}
        {projectId && entries.length === 0 && !error && (
          <p className="text-xs text-muted">This project folder is empty.</p>
        )}
      </div>
      {truncated && (
        <p className="text-xs text-muted">File list limited to the first 2,000 entries.</p>
      )}
      {error && <p className="toolbox-error" role="alert">{error}</p>}

      <div className="project-files-panel__create">
        <span className="text-xs text-muted">
          New item in {selectedDirectory || 'project root'}
        </span>
        <input
          className="form-input"
          value={entryName}
          onChange={(event) => setEntryName(event.target.value)}
          placeholder="Name (include extension for files)"
          disabled={!projectId || busy}
          aria-label="New file or folder name"
        />
        <div>
          <button
            type="button"
            className="validate-btn"
            disabled={!projectId || busy || !entryName.trim()}
            onClick={() => createEntry('file')}
          >
            New file
          </button>
          <button
            type="button"
            className="validate-btn"
            disabled={!projectId || busy || !entryName.trim()}
            onClick={() => createEntry('folder')}
          >
            New folder
          </button>
        </div>
      </div>
    </div>
  )
}
