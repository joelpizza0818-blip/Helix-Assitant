import React, { useState, useEffect } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { useAgent } from '../../hooks/useAgent'
import { HelixLogo } from '../HelixLogo/HelixLogo'
import AISection from './sections/AISection'
import VoiceSection from './sections/VoiceSection'
import VisionSection from './sections/VisionSection'
import ComputerSection from './sections/ComputerSection'
import SystemSection from './sections/SystemSection'
import WebSection from './sections/WebSection'
import MemorySection from './sections/MemorySection'
import SecuritySection from './sections/SecuritySection'
import StartupSection from './sections/StartupSection'
import SkillsSection from './sections/SkillsSection'
import MCPSection from './sections/MCPSection'
import ClipboardSection from './sections/ClipboardSection'
import BrowserExtensionSection from './sections/BrowserExtensionSection'
import UpdateSection from './sections/UpdateSection'
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
  | 'skills'
  | 'mcp'
  | 'clipboard'
  | 'browser-companion'
  | 'updates'

interface NavItem {
  id: Section
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'ai',       label: 'AI & Models',   icon: <NavIcon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /> },
  { id: 'voice',    label: 'Voice & Calls', icon: <NavIcon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /> },
  { id: 'vision',   label: 'Vision & Hands',icon: <NavIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /> },
  { id: 'computer', label: 'Computer OS',   icon: <NavIcon d="M2 3h20v14H2z M8 21h8 M12 17v4" /> },
  { id: 'system',   label: 'System Shell',  icon: <NavIcon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" /> },
  { id: 'web',      label: 'Web & Browser', icon: <NavIcon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z M2 12h20 M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /> },
  { id: 'memory',   label: 'Memory & RAG',  icon: <NavIcon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /> },
  { id: 'security', label: 'Zero-Trust',    icon: <NavIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
  { id: 'startup',  label: 'Startup & Tray',icon: <NavIcon d="M5 3l14 9-14 9V3z" /> },
  { id: 'skills',   label: 'Skills',        icon: <NavIcon d="M12 3v18m-9-9h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4" /> },
  { id: 'mcp',      label: 'MCP Servers',   icon: <NavIcon d="M12 3v18m-9-9h18M5 5l14 14m0-14L5 19" /> },
  { id: 'clipboard', label: 'Clipboard', icon: <NavIcon d="M8 4h8l1 2h3v15H4V6h3l1-2zm0 4h8m-8 4h8m-8 4h5" /> },
  { id: 'browser-companion', label: 'Browser Companion', icon: <NavIcon d="M3 4h18v15H3zM3 9h18m-9 10v3m-4 0h8" /> },
  { id: 'updates', label: 'Updates', icon: <NavIcon d="M20 7v5h-5M4 17v-5h5m-3.5-3A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" /> },
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
  const { settings, isLoading, isSaving, isApplied, error, loadSettings, saveSettings } = useSettings()
  const { providers, models, loadProviders, loadModels } = useAgent()

  useEffect(() => {
    loadSettings()
    loadProviders()
    loadModels()
  }, [])

  return (
    <div className="toolbox">
      {/* ── Header with Brand Logo ──────────────── */}
      <header className="toolbox__header">
        <div className="toolbox__brand-area">
          <HelixLogo size="sm" showText={true} />
          <span className="toolbox__title">Toolbox & Control Center</span>
        </div>
        {isSaving && <span className="toolbox__saving">Saving changes...</span>}{!isSaving && isApplied && <span className="toolbox__saving" style={{ color: "var(--green)", border: "1px solid var(--green)", padding: "2px 6px", borderRadius: "4px" }}>Saved</span>}
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

        {/* ── Content Area with Real Components ── */}
        <main className="toolbox__content">
          {isLoading ? (
            <div className="toolbox__loading">Loading configuration...</div>
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
                <ComputerSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'system' && (
                <SystemSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'web' && (
                <WebSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'memory' && (
                <MemorySection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'security' && (
                <SecuritySection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'startup' && (
                <StartupSection settings={settings} onSave={saveSettings} />
              )}
              {activeSection === 'skills' && <SkillsSection />}
              {activeSection === 'mcp' && (
                <MCPSection settings={settings} onSave={saveSettings} saveError={error} />
              )}
              {activeSection === 'clipboard' && <ClipboardSection />}
              {activeSection === 'browser-companion' && <BrowserExtensionSection />}
              {activeSection === 'updates' && <UpdateSection />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
