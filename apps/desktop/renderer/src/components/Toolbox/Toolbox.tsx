import React, { useState, useEffect } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { useAgent } from '../../hooks/useAgent'
import AISection from './sections/AISection'
import VoiceSection from './sections/VoiceSection'
import VisionSection from './sections/VisionSection'
import SecuritySection from './sections/SecuritySection'
import './Toolbox.css'

type Section =
  | 'ai'
  | 'voice'
  | 'vision'
  | 'computer'
  | 'system'
  | 'web'
  | 'memory'
  | 'security'
  | 'startup'

interface NavItem {
  id: Section
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'ai',       label: 'AI',       icon: <NavIcon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /> },
  { id: 'voice',    label: 'Voice',    icon: <NavIcon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /> },
  { id: 'vision',   label: 'Vision',   icon: <NavIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /> },
  { id: 'computer', label: 'Computer', icon: <NavIcon d="M2 3h20v14H2z M8 21h8 M12 17v4" /> },
  { id: 'system',   label: 'System',   icon: <NavIcon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" /> },
  { id: 'web',      label: 'Web',      icon: <NavIcon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z M2 12h20 M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /> },
  { id: 'memory',   label: 'Memory',   icon: <NavIcon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /> },
  { id: 'security', label: 'Security', icon: <NavIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
  { id: 'startup',  label: 'Startup',  icon: <NavIcon d="M5 3l14 9-14 9V3z" /> },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function Toolbox() {
  const [activeSection, setActiveSection] = useState<Section>('ai')
  const { settings, isLoading, isSaving, loadSettings, saveSettings } = useSettings()
  const { providers, models, loadProviders, loadModels } = useAgent()

  useEffect(() => {
    loadSettings()
    loadProviders()
    loadModels()
  }, [])

  return (
    <div className="toolbox">
      {/* ── Header ─────────────────────────────── */}
      <header className="toolbox__header">
        <span className="toolbox__wordmark">HELIX</span>
        <span className="toolbox__title">Toolbox</span>
        {isSaving && <span className="toolbox__saving">Saving...</span>}
      </header>

      <div className="toolbox__layout">
        {/* ── Sidebar ────────────────────────────── */}
        <nav className="toolbox__sidebar">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`toolbox__nav-item ${activeSection === item.id ? 'toolbox__nav-item--active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="toolbox__nav-icon">{item.icon}</span>
              <span className="toolbox__nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* ── Content ───────────────────────────── */}
        <main className="toolbox__content">
          {isLoading ? (
            <div className="toolbox__loading">Loading settings...</div>
          ) : (
            <>
              {activeSection === 'ai' && (
                <AISection
                  providers={providers}
                  models={models}
                  settings={settings}
                  onSave={saveSettings}
                  onRefresh={() => { loadProviders(); loadModels() }}
                />
              )}
              {activeSection === 'voice' && (
                <VoiceSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'vision' && (
                <VisionSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'computer' && (
                <PlaceholderSection title="Computer Control" description="Configure screen capture, mouse, keyboard, and UI automation permissions." />
              )}
              {activeSection === 'system' && (
                <PlaceholderSection title="System" description="Configure filesystem access, terminal, CMD, and PowerShell permissions." />
              )}
              {activeSection === 'web' && (
                <PlaceholderSection title="Web & Browser" description="Configure browser automation, research depth, and extraction settings." />
              )}
              {activeSection === 'memory' && (
                <PlaceholderSection title="Memory" description="Configure conversation memory, long-term memory, semantic retrieval, and retention policies." />
              )}
              {activeSection === 'security' && (
                <SecuritySection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'startup' && (
                <PlaceholderSection title="Startup" description="Configure whether HELIX launches with Windows and tray behavior." />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">{title}</h2>
      <p className="toolbox-section__desc">{description}</p>
      <div className="toolbox-placeholder">
        <p className="text-muted text-xs text-mono">Section under active development.</p>
      </div>
    </div>
  )
}
