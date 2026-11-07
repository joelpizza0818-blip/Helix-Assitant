import { lazy, Suspense, useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { indentUnit, LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import './ProjectFilesPanel.css'

const ProjectMarkdownPreview = lazy(() => import('./ProjectMarkdownPreview'))

interface EditorPreferences {
  fontSize: number
  tabSize: number
  wordWrap: boolean
  lineNumbers: boolean
}

interface Props {
  projectId: string
  relativePath: string
  onClose: () => void
  embedded?: boolean
  editorPreferences?: EditorPreferences
  onDirtyChange?: (dirty: boolean) => void
}

const EDITOR_THEME = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--color-void)', color: 'var(--color-paper)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--color-void)', color: 'var(--color-ash)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  '&.cm-focused': { outline: 'none' },
})

const LANGUAGE_DESCRIPTIONS = [
  LanguageDescription.of({
    name: 'JavaScript / TypeScript',
    extensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'],
    load: async () => {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true, typescript: true })
    },
  }),
  LanguageDescription.of({
    name: 'Python',
    extensions: ['py', 'pyw'],
    load: async () => (await import('@codemirror/lang-python')).python(),
  }),
  LanguageDescription.of({
    name: 'JSON',
    extensions: ['json', 'map'],
    load: async () => (await import('@codemirror/lang-json')).json(),
  }),
  LanguageDescription.of({
    name: 'HTML',
    extensions: ['html', 'htm'],
    load: async () => (await import('@codemirror/lang-html')).html(),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: async () => (await import('@codemirror/lang-css')).css(),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdx'],
    load: async () => (await import('@codemirror/lang-markdown')).markdown(),
  }),
  LanguageDescription.of({
    name: 'Rust',
    extensions: ['rs'],
    load: async () => (await import('@codemirror/lang-rust')).rust(),
  }),
  LanguageDescription.of({
    name: 'SQL',
    extensions: ['sql'],
    load: async () => (await import('@codemirror/lang-sql')).sql(),
  }),
  LanguageDescription.of({
    name: 'YAML',
    extensions: ['yaml', 'yml'],
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  }),
  LanguageDescription.of({
    name: 'XML',
    extensions: ['xml', 'svg'],
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  }),
]

export default function ProjectFileEditor({
  projectId,
  relativePath,
  onClose,
  embedded = false,
  editorPreferences,
  onDirtyChange,
}: Props) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<LanguageSupport | null>(null)
  const [languageName, setLanguageName] = useState('Plain Text')
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(relativePath)
  const [preview, setPreview] = useState(isMarkdown)

  useEffect(() => {
    let active = true
    setContent('')
    setSavedContent(null)
    setLoading(true)
    setError(null)
    setPreview(isMarkdown)
    void window.helix.readProjectFile(projectId, relativePath)
      .then((result) => {
        if (!active) return
        setContent(result.content)
        setSavedContent(result.content)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Could not open this project file.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [projectId, relativePath, isMarkdown])

  useEffect(() => {
    let active = true
    const description = LanguageDescription.matchFilename(LANGUAGE_DESCRIPTIONS, relativePath)
    setLanguage(null)
    setLanguageName(description?.name ?? 'Plain Text')
    if (description) {
      void description.load()
        .then((support) => {
          if (active) setLanguage(support)
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error
            ? `Could not load syntax support: ${reason.message}`
            : 'Could not load syntax support.')
        })
    }
    return () => { active = false }
  }, [relativePath])

  const isDirty = savedContent !== null && content !== savedContent
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const close = () => {
    if (isDirty && !window.confirm('Discard unsaved changes to this file?')) return
    onClose()
  }

  const save = async () => {
    if (savedContent === null || !isDirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.helix.writeProjectFile(projectId, relativePath, content)
      setSavedContent(content)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this project file.')
    } finally {
      setSaving(false)
    }
  }

  const editor = (
    <section
        className={`project-file-editor ${embedded ? 'project-file-editor--embedded' : ''}`}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="project-file-editor-title"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            close()
          }
        }}
      >
        <header className="project-file-editor__header">
          <div>
            <h2 id="project-file-editor-title">{relativePath.split(/[\\/]/).pop()}</h2>
            <p>{relativePath}</p>
          </div>
          <div className="project-file-editor__header-actions">
            {isMarkdown && (
              <div className="project-file-editor__view-toggle" role="group" aria-label="Markdown view">
                <button type="button" className={!preview ? 'is-active' : ''} onClick={() => setPreview(false)}>Edit</button>
                <button type="button" className={preview ? 'is-active' : ''} onClick={() => setPreview(true)}>Preview</button>
              </div>
            )}
            <button type="button" className="project-file-editor__close" onClick={close} aria-label="Close editor">
              ×
            </button>
          </div>
        </header>
        {loading ? (
          <p className="text-xs text-muted" role="status">Opening file…</p>
        ) : (
          preview && isMarkdown ? (
            <Suspense fallback={<p className="text-xs text-muted" role="status">Rendering Markdown…</p>}>
              <ProjectMarkdownPreview content={content} />
            </Suspense>
          ) : (
            <div className="project-file-editor__code" style={{ fontSize: editorPreferences?.fontSize ?? 13 }}>
              <CodeMirror
                value={content}
                height="100%"
                theme="dark"
                basicSetup={{
                  lineNumbers: editorPreferences?.lineNumbers ?? true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                }}
                extensions={[
                  ...(language ? [language] : []),
                  indentUnit.of(' '.repeat(editorPreferences?.tabSize ?? 2)),
                  ...(editorPreferences?.wordWrap === false ? [] : [EditorView.lineWrapping]),
                  EDITOR_THEME,
                ]}
                onChange={setContent}
                editable={savedContent !== null && !saving}
                aria-label={`Edit ${relativePath}`}
              />
            </div>
          )
        )}
        {error && <p className="toolbox-error" role="alert">{error}</p>}
        <footer className="project-file-editor__footer">
          <span className="text-xs text-muted" role="status">
            {saving ? 'Saving…' : isDirty ? 'Unsaved changes' : savedContent === null ? '' : 'Saved'}
            {!loading && ` · ${languageName}`}
            {!loading && ` · ${content.split(/\r\n|\r|\n/).length} lines`}
          </span>
          <div>
            <button type="button" className="validate-btn" onClick={close}>Close</button>
            <button
              type="button"
              className="validate-btn"
              disabled={loading || saving || !isDirty}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
    </section>
  )

  if (embedded) return editor
  return (
    <div className="project-file-editor__backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      {editor}
    </div>
  )
}
