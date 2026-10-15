import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import { InstallerDownloadButton } from '../components/Download/InstallerDownloadButton';
import { PrivacyModal } from '../components/PrivacyModal/PrivacyModal';
import { getLatestInstallerVersion, getLatestLiteRelease, type LiteReleaseDownload } from '../lib/downloads';
import { useAuth } from '../hooks/useAuth';
import './DownloadPage.css';

export const DownloadPage: React.FC = () => {
  const { user } = useAuth();
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [liteRelease, setLiteRelease] = useState<LiteReleaseDownload | null>(null);
  const [liteReleaseError, setLiteReleaseError] = useState(false);
  const [litePrivacyOpen, setLitePrivacyOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getLatestInstallerVersion(controller.signal)
      .then(setInstallerVersion)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load installer version', err);
        setVersionError(true);
      });

    getLatestLiteRelease(controller.signal)
      .then(setLiteRelease)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load Lite release', err);
        setLiteReleaseError(true);
      });

    return () => controller.abort();
  }, []);

  const handleLiteDownloadClick = (e: React.MouseEvent) => {
    const isAccepted = typeof window !== 'undefined' && localStorage.getItem('helix_privacy_accepted') === 'true';
    if (!isAccepted) {
      e.preventDefault();
      setLitePrivacyOpen(true);
    }
  };

  return (
    <div className="download-page" id="top">
      {/* Modern Header */}
      <header className="download-header">
        <Link to="/" className="download-header__brand" aria-label="Back to HELIX home">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="download-header__links">
          <Link to="/" className="download-header__link">Home</Link>
          <Link to="/features" className="download-header__link">What's New</Link>
          <Link to="/docs" className="download-header__link">Documentation</Link>
          <Link to="/privacy" className="download-header__link">Privacy</Link>
          {user ? (
            <span className="download-header__user">{user.email?.split('@')[0]}</span>
          ) : (
            <Link to="/login" className="download-header__link">Log In</Link>
          )}
          <Link to="/download" className="download-header__cta">Download</Link>
        </div>
      </header>

      <main className="download-main">
        <div className="download-container">
          {/* Hero */}
          <div className="download-hero">
            <span className="download-eyebrow">OFFICIAL DISTRIBUTION · WINDOWS 10 / 11 (64-BIT)</span>
            <h1 className="download-title">Download HELIX for your Desktop</h1>
            <p className="download-lead">
              Choose between the full desktop version with Electron or the ultra-lightweight version with Tauri. Both share the same local agent core, AI model router, and Zero-Trust architecture.
            </p>
          </div>

          {/* Dual Edition Cards */}
          <div className="download-editions-grid">
            {/* Edition 1: HELIX Normal */}
            <article className="download-card download-card--normal">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--normal">RECOMMENDED</span>
                  <span className="download-version-pill">
                    v{installerVersion || '0.2.0'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Normal</h2>
                <p className="download-card__desc">
                  Full desktop shell built on Electron with deep Windows OS integration and comprehensive tool support.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARCHITECTURE</span>
                  <span className="download-spec-val">Electron + Node.js + Python Core</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">RAM FOOTPRINT</span>
                  <span className="download-spec-val">~180 MB at idle</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALLER</span>
                  <span className="download-spec-val">~120 MB (Verified)</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>System Tray with status control and global shortcuts</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>On-demand screen vision and AI-assisted OCR</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Continuous audio and voice interaction with SoundDevice</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Built-in update channel and cloud sync</span>
                </li>
              </ul>

              <div className="download-card__actions">
                <InstallerDownloadButton className="download-action-btn download-action-btn--primary">
                  Download HELIX Normal for Windows
                </InstallerDownloadButton>
                <span className="download-note">
                  Requires login to verify license and link credentials.
                </span>
              </div>
            </article>

            {/* Edition 2: HELIX Lite */}
            <article className="download-card download-card--lite">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--lite">ULTRA-LIGHTWEIGHT · RUST</span>
                  <span className="download-version-pill">
                    v{liteRelease ? liteRelease.version : '0.2.0'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Lite</h2>
                <p className="download-card__desc">
                  Ultra-lightweight shell built with Tauri and compiled in Rust. Maximum performance with minimal resource consumption.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARCHITECTURE</span>
                  <span className="download-spec-val">Tauri v2 + Rust + WebView2 + Python Core</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">RAM FOOTPRINT</span>
                  <span className="download-spec-val">~40 MB at idle</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALLER</span>
                  <span className="download-spec-val">~15 MB (Fast download)</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Standalone ~15MB installer with no embedded Chromium overhead</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Instant startup and 75% lower memory consumption</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Same intelligent core with model router (Gemini, Claude, GPT, Ollama)</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Immediate download with no prior account registration</span>
                </li>
              </ul>

              <div className="download-card__actions">
                {liteRelease ? (
                  <>
                    <a
                      className="download-action-btn download-action-btn--lite"
                      href={liteRelease.installerUrl}
                      onClick={handleLiteDownloadClick}
                      rel="noreferrer"
                    >
                      Download HELIX Lite v{liteRelease.version}
                    </a>
                    <a
                      className="download-checksum-link"
                      href={liteRelease.releaseUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View release and SHA-256 checksum on GitHub
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                    </a>
                    <PrivacyModal
                      isOpen={litePrivacyOpen}
                      targetEdition="Lite"
                      onClose={() => setLitePrivacyOpen(false)}
                      onConfirm={() => {
                        window.location.assign(liteRelease.installerUrl);
                      }}
                    />
                  </>
                ) : (
                  <span className="download-note">
                    {liteReleaseError ? 'Lite download temporarily unavailable.' : 'Fetching latest HELIX Lite version…'}
                  </span>
                )}
              </div>
            </article>
          </div>

          {/* Quickstart from Source Terminal */}
          <section className="download-source-section">
            <div className="download-source-header">
              <span className="download-section-eyebrow">OPEN SOURCE</span>
              <h3>Build directly from source code</h3>
              <p>If you prefer to compile and run HELIX directly in your development environment:</p>
            </div>

            <div className="download-terminal-card">
              <div className="download-terminal-bar">
                <span className="download-terminal-dots">
                  <i /><i /><i />
                </span>
                <span className="download-terminal-title">PowerShell (Administrator)</span>
              </div>
              <pre className="download-code-block">
                <code>{`# 1. Clone the repository
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
cd Helix-Assitant

# 2. Run the automated setup script for Windows
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

# 3. Configure environment variables and API keys
copy .env.example .env

# 4. Start the Desktop Shell and Python Agent
npm run dev:desktop`}</code>
              </pre>
            </div>
          </section>

          {/* System & Architecture Notes */}
          <section className="download-notes-section">
            <span className="download-section-eyebrow">ARCHITECTURE & SECURITY</span>
            <h3 className="download-notes-title">Local Operation Guidelines</h3>

            <div className="download-notes-grid">
              <div className="download-info-card">
                <h4>Local Key Storage</h4>
                <p>
                  Your API keys (Google Gemini, OpenAI, Claude, or local Ollama) are never sent to HELIX servers. They are stored in <code>Windows Credential Manager</code> or in your local <code>.env</code> file.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Visual Capture & Perception</h4>
                <p>
                  HELIX analyzes the screen exclusively on demand when you request it in the chat. Frames are processed in volatile memory and discarded immediately.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Start with the Operating System</h4>
                <p>
                  You can enable or disable automatic startup from the settings panel, using a standard entry in <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code>.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Modern Footer */}
      <footer className="download-footer">
        <div className="download-footer__inner">
          <p>© {new Date().getFullYear()} HELIX Project. Designed to run locally with zero trust.</p>
          <div className="download-footer__links">
            <Link to="/">Home</Link>
            <Link to="/features">What's New</Link>
            <Link to="/docs">Documentation</Link>
            <Link to="/privacy">Privacy</Link>
            <a href="#top">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
