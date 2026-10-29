import React, { useCallback, useState, useEffect, useRef } from 'react'
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
import AdminSection from './sections/AdminSection'
import ProfilesSection from './sections/ProfilesSection'
import CapabilitiesSection from './sections/CapabilitiesSection'
import MobileSection from './sections/MobileSection'
import PluginsSection from './sections/PluginsSection'
import CommunitySection from './sections/CommunitySection'
import {
  adminRequest,
  desktopSupabase,
  desktopSupabaseConfigured,
  exchangeOAuthCallback,
  loadOwnProfile,
  signOutProfile,
  startGitHubOAuth,
  type HelixProfile,
} from '../../lib/desktopSupabase'
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
  | 'plugins'
  | 'community'
  | 'mcp'
  | 'clipboard'
  | 'browser-companion'
  | 'updates'
  | 'profiles'
  | 'admin'
  | 'capabilities'
  | 'mobile'

interface NavItem {
  id: Section
  label: string
  category: string
  keywords?: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'ai',       category: 'Intelligence', label: 'AI & Models',   keywords: 'openai anthropic gemini api keys models ollama deepseek', icon: <NavIcon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /> },
  { id: 'skills',   category: 'Intelligence', label: 'Skills',        keywords: 'prompts triggers automated workflows tools', icon: <NavIcon d="M12 3v18m-9-9h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4" /> },
  { id: 'plugins',  category: 'Intelligence', label: 'Plugins',       keywords: 'gmail chatgpt word excel powerpoint browser integrations', icon: <NavIcon d="M8 3v4m8-4v4M3 8h18M5 8v11h14V8M9 13h6" /> },
  { id: 'mcp',      category: 'Intelligence', label: 'MCP Servers',   keywords: 'model context protocol tools servers stdio', icon: <NavIcon d="M12 3v18m-9-9h18M5 5l14 14m0-14L5 19" /> },
  { id: 'memory',   category: 'Intelligence', label: 'Memory & RAG',  keywords: 'context pgvector memory long term history', icon: <NavIcon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /> },
  { id: 'voice',    category: 'Perception', label: 'Voice & Calls', keywords: 'microphone speech whisper wake word edge tts audio', icon: <NavIcon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /> },
  { id: 'vision',   category: 'Perception', label: 'Vision & Hands',keywords: 'camera mediapipe gesture screen detection', icon: <NavIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /> },
  { id: 'computer', category: 'Perception', label: 'Computer OS',   keywords: 'keyboard mouse screen capture click display', icon: <NavIcon d="M2 3h20v14H2z M8 21h8 M12 17v4" /> },
  { id: 'system',   category: 'Perception', label: 'System Shell',  keywords: 'terminal powershell cmd wsl bash execution', icon: <NavIcon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" /> },
  { id: 'web',      category: 'Perception', label: 'Web & Browser', keywords: 'chromium headless search duckduckgo bing google', icon: <NavIcon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z M2 12h20 M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /> },
  { id: 'security', category: 'Security & System', label: 'Zero-Trust',    keywords: 'permissions sandbox isolation protected paths policies', icon: <NavIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
  { id: 'startup',  category: 'Security & System', label: 'Startup & Tray',keywords: 'windows startup minimize tray background', icon: <NavIcon d="M5 3l14 9-14 9V3z" /> },
  { id: 'clipboard',category: 'Security & System', label: 'Clipboard', keywords: 'history monitor copy paste', icon: <NavIcon d="M8 4h8l1 2h3v15H4V6h3l1-2zm0 4h8m-8 4h8m-8 4h5" /> },
  { id: 'browser-companion', category: 'Security & System', label: 'Browser Companion', keywords: 'chrome edge extension bridge', icon: <NavIcon d="M3 4h18v15H3zM3 9h18m-9 10v3m-4 0h8" /> },
  { id: 'capabilities', category: 'Security & System', label: 'Capabilities', keywords: 'packs extensions plugins download', icon: <NavIcon d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4zm0 5v6m-3 0h6" /> },
  { id: 'profiles', category: 'Operations', label: 'Perfil', keywords: 'github login user rank account', icon: <NavIcon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /> },
  { id: 'updates', category: 'Operations', label: 'Updates', keywords: 'installer version check update nsis tauri', icon: <NavIcon d="M20 7v5h-5M4 17v-5h5m-3.5-3A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" /> },
  { id: 'admin', category: 'Operations', label: 'Admin Logs', keywords: 'logs streaming diagnostics errors buffer ring', icon: <NavIcon d="M12 2l8 4v5c0 5-3.5 9-8 11-4.5-2-8-6-8-11V6l8-4zm0 6v5m0 3h.01" /> },
  { id: 'mobile', category: 'Operations', label: 'Vincular móvil', keywords: 'mobile phone android ios ssh websocket pairing remote control', icon: <NavIcon d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h4" /> },
  { id: 'community', category: 'Community', label: 'Community', keywords: 'marketplace creator public plugins skills publish review', icon: <NavIcon d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7-3v6m-3-3h6" /> },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const CATEGORY_METADATA: Record<string, { label: string; icon: React.ReactNode }> = {
  Intelligence: {
    label: 'Intelligence',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a6 6 0 0 1 6 6c0 2.22-1.21 4.16-3 5.2V17a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-3.8C7.21 12.16 6 10.22 6 8a6 6 0 0 1 6-6z" />
        <path d="M9 21h6" />
      </svg>
    ),
  },
  Perception: {
    label: 'Perception',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  'Security & System': {
    label: 'Security & System',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  Operations: {
    label: 'Operations',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83-2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  Community: {
    label: 'Community',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
};


export default function Toolbox() {
  const [activeSection, setActiveSection] = useState<Section>('ai')
  const [searchQuery, setSearchQuery] = useState('')

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('helix_toolbox_collapsed_cats');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = { ...prev, [cat]: !prev[cat] };
      try {
        localStorage.setItem('helix_toolbox_collapsed_cats', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [profile, setProfile] = useState<HelixProfile | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [oauthPending, setOauthPending] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const oauthTimeoutRef = useRef<number | null>(null)
  const [pendingReportsCount, setPendingReportsCount] = useState(0)
  const { settings, isLoading, isSaving, isApplied, error, loadSettings, saveSettings } = useSettings()
  const saveOtherSettings = useCallback(async (partial: Partial<typeof settings>) => {
    await saveSettings(partial)
  }, [saveSettings])
  const { providers, models, loadProviders, loadModels } = useAgent()
  const isAdmin = profile?.rank === 'admin' || profile?.rank === 'master-admin'
  const isMaster = profile?.rank === 'master-admin'

  useEffect(() => {
    loadSettings()
    loadProviders()
    loadModels()
  }, [])

  useEffect(() => {
    let active = true
    const refreshProfile = async () => {
      try {
        const next = await loadOwnProfile()
        if (active) {
          setProfile(next)
          setProfileError(null)
        }
      } catch (cause) {
        if (active) setProfileError(cause instanceof Error ? cause.message : 'No se pudo cargar el perfil.')
      }
    }
    const unsubscribeAuth = desktopSupabase?.auth.onAuthStateChange((_event, session) => {
      if (session) window.setTimeout(() => void refreshProfile(), 0)
      else if (active) setProfile(null)
    }).data.subscription.unsubscribe
    const unsubscribeOAuth = window.helix.onOAuthCallback(async (url) => {
      if (oauthTimeoutRef.current !== null) {
        window.clearTimeout(oauthTimeoutRef.current)
        oauthTimeoutRef.current = null
      }
      setProfileBusy(true)
      setProfileError(null)
      try {
        await exchangeOAuthCallback(url)
        await refreshProfile()
      } catch (cause) {
        setProfileError(cause instanceof Error ? cause.message : 'No se pudo completar el inicio de sesión.')
      } finally {
        setProfileBusy(false)
        setOauthPending(false)
      }
    })
    void refreshProfile()
    return () => {
      active = false
      if (oauthTimeoutRef.current !== null) window.clearTimeout(oauthTimeoutRef.current)
      unsubscribeAuth?.()
      unsubscribeOAuth()
    }
  }, [])

  const connectGitHubProfile = async () => {
    setProfileBusy(true)
    setProfileError(null)
    try {
      if (!desktopSupabaseConfigured) throw new Error('Falta configurar OAuth de Supabase para esta versión.')
      await startGitHubOAuth()
      setOauthPending(true)
      oauthTimeoutRef.current = window.setTimeout(() => {
        oauthTimeoutRef.current = null
        setOauthPending(false)
        setProfileError('No se recibió la respuesta de GitHub. Comprueba que HELIX esté instalado correctamente y vuelve a intentarlo.')
      }, 120_000)
    } catch (cause) {
      setOauthPending(false)
      setProfileError(cause instanceof Error ? cause.message : 'No se pudo iniciar el acceso de GitHub.')
    } finally {
      setProfileBusy(false)
    }
  }

  const cancelGitHubOAuthWait = () => {
    if (oauthTimeoutRef.current !== null) {
      window.clearTimeout(oauthTimeoutRef.current)
      oauthTimeoutRef.current = null
    }
    setOauthPending(false)
  }

  const saveProfileName = async (displayName: string) => {
    const result = await adminRequest<{ success: true; profile: HelixProfile }>('profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    })
    setProfile(result.profile)
  }

  const disconnectProfile = async () => {
    setProfileBusy(true)
    setProfileError(null)
    try {
      await signOutProfile()
      setProfile(null)
      setPendingReportsCount(0)
      setActiveSection('profiles')
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'No se pudo cerrar sesión.')
    } finally {
      setProfileBusy(false)
    }
  }

  return (
    <div className="toolbox">
      {/* ── Header with Brand Logo ──────────────── */}
      <header className="toolbox__header">
        <div className="toolbox__brand-area">
          <HelixLogo size="sm" showText={true} />
          <span className="toolbox__title">Toolbox & Control Center</span>
        </div>
        <div className="toolbox__header-actions">
          {profile && <span className="toolbox__profile-indicator">@{profile.githubLogin} · {profile.rank}</span>}
          {isSaving && <span className="toolbox__saving">Saving changes...</span>}
          {!isSaving && isApplied && <span className="toolbox__saving" style={{ color: "var(--green)", border: "1px solid var(--green)", padding: "2px 6px", borderRadius: "4px" }}>Saved</span>}
        </div>
      </header>

      <div className="toolbox__layout">
        {/* ── Sidebar ────────────────────────────── */}
        <nav className="toolbox__sidebar">
                    <div className="toolbox__search-box">
            <div className="toolbox__search-wrapper">
              <svg className="toolbox__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="toolbox__search-input"
                placeholder="Buscar ajustes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="toolbox__search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar búsqueda"
                >
                  ×
                </button>
              )}
            </div>
          </div>
                    {(() => {
            const isProviderConnected = providers.some((p) => p.keys.some((k) => k.health === 'healthy'));
            const isSearching = Boolean(searchQuery.trim());
            const q = searchQuery.toLowerCase().trim();

            const filtered = NAV_ITEMS.filter((item) => {
              const allowed = (item.id !== 'admin' || isAdmin)
                && (item.id !== 'capabilities' || import.meta.env.DEV || '__TAURI_INTERNALS__' in window);
              if (!allowed) return false;
              if (!isSearching) return true;
              return item.label.toLowerCase().includes(q) || (item.keywords && item.keywords.toLowerCase().includes(q));
            });

            const categories = Array.from(new Set(filtered.map((item) => item.category)));

            return categories.map((cat) => {
              const catItems = filtered.filter((item) => item.category === cat);
              const isCollapsed = !isSearching && Boolean(collapsedCategories[cat]);
              const meta = CATEGORY_METADATA[cat] ?? {
                label: cat,
                icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ),
              };

              return (
                <div key={cat} className="toolbox__nav-module">
                  <button
                    type="button"
                    className="toolbox__nav-category-header"
                    onClick={() => toggleCategory(cat)}
                    aria-expanded={!isCollapsed}
                    title={`${isCollapsed ? 'Desplegar' : 'Plegar'} módulo ${meta.label}`}
                  >
                    <span className="toolbox__nav-category-icon">{meta.icon}</span>
                    <span className="toolbox__nav-category-title">{meta.label}</span>
                    <span className="toolbox__nav-category-count">{catItems.length}</span>
                    <svg
                      className={`toolbox__nav-category-chevron ${isCollapsed ? 'toolbox__nav-category-chevron--collapsed' : ''}`}
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {!isCollapsed && (
                    <div className="toolbox__nav-items-group">
                      {catItems.map((item) => (
                        <button
                          key={item.id}
                          className={`toolbox__nav-item ${activeSection === item.id ? 'toolbox__nav-item--active' : ''}`}
                          onClick={() => setActiveSection(item.id)}
                        >
                          <span className="toolbox__nav-icon">{item.icon}</span>
                          <span className="toolbox__nav-label">{item.label}</span>
                          {item.id === 'ai' && (
                            <span
                              className={`toolbox__nav-status-dot ${isProviderConnected ? 'toolbox__nav-status-dot--connected' : 'toolbox__nav-status-dot--unconfigured'}`}
                              title={isProviderConnected ? 'Proveedor conectado' : 'Sin proveedor activo'}
                            />
                          )}
                          {item.id === 'admin' && isMaster && pendingReportsCount > 0 && (
                            <span className="toolbox__nav-badge" aria-label={`${pendingReportsCount} reportes pendientes`}>
                              {pendingReportsCount > 99 ? '99+' : pendingReportsCount}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </nav>

        {/* ── Content Area with Real Components ── */}
        <main className="toolbox__content">
          {isLoading ? (
            <div className="toolbox__loading" role="status" aria-live="polite">
              <div className="helix-loader" aria-hidden="true" />
              <span>Loading configuration...</span>
            </div>
          ) : (
            <>
              {activeSection === 'ai' && (
                <AISection
                  providers={providers}
                  models={models}
                  settings={settings}
                  onSave={saveOtherSettings}
                  onRefresh={() => { loadProviders(); loadModels(); void loadSettings() }}
                />
              )}
              {activeSection === 'voice' && (
                <VoiceSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'vision' && (
                <VisionSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'computer' && (
                <ComputerSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'system' && (
                <SystemSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'web' && (
                <WebSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'memory' && (
                <MemorySection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'security' && (
                <SecuritySection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'startup' && (
                <StartupSection settings={settings} onSave={saveOtherSettings} />
              )}
              {activeSection === 'skills' && <SkillsSection />}
              {activeSection === 'plugins' && <PluginsSection />}
              {activeSection === 'community' && <CommunitySection profile={profile} />}
              {activeSection === 'mcp' && (
                <MCPSection settings={settings} onSave={saveSettings} saveError={error} />
              )}
              {activeSection === 'clipboard' && <ClipboardSection />}
              {activeSection === 'browser-companion' && <BrowserExtensionSection />}
              {activeSection === 'updates' && <UpdateSection />}
              {activeSection === 'capabilities' && <CapabilitiesSection />}
              {activeSection === 'mobile' && <MobileSection />}
              {activeSection === 'profiles' && (
                <ProfilesSection
                  configured={desktopSupabaseConfigured}
                  profile={profile}
                  busy={profileBusy}
                  oauthPending={oauthPending}
                  error={profileError}
                  onSignIn={() => void connectGitHubProfile()}
                  onCancelSignIn={cancelGitHubOAuthWait}
                  onSignOut={() => void disconnectProfile()}
                  onSaveName={saveProfileName}
                />
              )}
              {activeSection === 'admin' && isAdmin && profile && (
                <AdminSection profile={profile} onPendingReportsCount={setPendingReportsCount} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
