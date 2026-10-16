import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './DocsPage.css';

type DocSection = 'intro' | 'install' | 'models' | 'tools' | 'voice' | 'mcp' | 'faq';

export const DocsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<DocSection>('intro');

  return (
    <div className="docs-page" id="top">
      <header className="docs-header">
        <Link to="/" className="docs-header__brand" aria-label="Back to the HELIX main page">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="docs-header__links">
          <Link to="/" className="docs-header__link">Home</Link>
          <Link to="/features" className="docs-header__link">What's New</Link>
          <Link to="/privacy" className="docs-header__link">Privacy</Link>
          <Link to="/download" className="docs-header__cta">Download</Link>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar__group">
            <span className="docs-sidebar__title">OFFICIAL DOCUMENTATION</span>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'intro' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('intro')}
            >
              1. Overview & Architecture
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'install' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('install')}
            >
              2. Installation (Normal vs Lite)
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'models' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('models')}
            >
              3. AI Providers & API Keys
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'tools' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('tools')}
            >
              4. Tools & Permission Checks
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'voice' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('voice')}
            >
              5. Voice, Microphone & SoundDevice
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'mcp' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('mcp')}
            >
              6. MCP Server Connection
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'faq' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('faq')}
            >
              7. Diagnostics & Frequently Asked Questions
            </button>
          </div>

          <div className="docs-sidebar__box">
            <span className="docs-box-tag">BENCHMARK STATUS</span>
            <p>Memory use has not been benchmarked across supported configurations.</p>
            <Link to="/download" className="docs-box-link">
              Get HELIX Lite
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </aside>

        <main className="docs-body">
          {activeSection === 'intro' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 1</span>
              <h1>HELIX Overview</h1>
              <p className="docs-lead">
                HELIX is a persistent artificial intelligence agent for Windows, designed to coexist in your daily desktop workflow without isolating you in a web browser tab.
              </p>

              <div className="docs-callout">
                <h4>Architecture Components</h4>
                <ul>
                  <li><strong>Desktop Shell (Electron or Tauri):</strong> Desktop interface with tray, floating panel, and keyboard controls that vary by edition.</li>
                  <li><strong>Agent Core (Python):</strong> Coordinates model requests, supported local tools, OCR, and working memory.</li>
                  <li><strong>Local IPC:</strong> Authenticated local inter-process communication between the desktop interface and the agent.</li>
                </ul>
              </div>

              <h2>Local-First Philosophy</h2>
              <p>
                The Python agent runs locally. Requests may be sent to the AI provider or endpoint configured in the app; local model endpoints are also supported. Review each service's data policy before sending sensitive content.
              </p>
            </article>
          )}

          {activeSection === 'install' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 2</span>
              <h1>Installation: HELIX Normal vs HELIX Lite</h1>
              <p className="docs-lead">
                HELIX currently publishes Windows x64 installers for two desktop shells. Hardware and performance differences have not been benchmarked across configurations.
              </p>

              <div className="docs-comparison-table">
                <div className="comparison-col">
                  <h3>HELIX Normal (Electron)</h3>
                  <span className="comparison-tag">Electron desktop shell</span>
                  <ul>
                    <li>Integrated shell based on Chromium/Node.js</li>
                    <li>Uses the shared local Python agent</li>
                    <li>Uses the separate Electron update channel</li>
                    <li>Memory use varies by workload and is not benchmarked</li>
                  </ul>
                </div>
                <div className="comparison-col is-featured">
                  <h3>HELIX Lite (Tauri)</h3>
                  <span className="comparison-tag">Tauri desktop shell</span>
                  <ul>
                    <li>Shell built in Rust with native Windows WebView2</li>
                    <li>Uses the shared local Python agent</li>
                    <li>Installer size and memory use vary by release and workload; not benchmarked here</li>
                    <li>Feature parity with Normal is not guaranteed</li>
                  </ul>
                </div>
              </div>

              <h2>Published Installer Platform</h2>
              <ul>
                <li><strong>Operating System:</strong> Windows 10 / 11 (64-bit).</li>
                <li><strong>Minimum CPU and RAM:</strong> Not yet validated.</li>
                <li><strong>Optional local models and perception features:</strong> Resource needs depend on the selected models and enabled features.</li>
              </ul>
            </article>
          )}

          {activeSection === 'models' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 3</span>
              <h1>AI Provider Configuration</h1>
              <p className="docs-lead">
                Configure a supported provider or endpoint in AI settings. Requests and credentials may be sent to that configured destination.
              </p>

              <h2>Supported Providers</h2>
              <div className="docs-provider-grid">
                <div className="provider-card">
                  <h4>Google Gemini</h4>
                  <p>Google provider adapter is present. Model IDs, features, availability, and quotas depend on the current provider API and account.</p>
                </div>
                <div className="provider-card">
                  <h4>Anthropic Claude</h4>
                  <p>Anthropic provider adapter is present. Model IDs, features, availability, and quotas depend on the current provider API and account.</p>
                </div>
                <div className="provider-card">
                  <h4>OpenAI</h4>
                  <p>OpenAI provider adapter is present. Model IDs, features, availability, and quotas depend on the current provider API and account.</p>
                </div>
                <div className="provider-card">
                  <h4>Ollama (Local Models)</h4>
                  <p>A compatible local or custom endpoint can be configured. Whether requests stay local depends on the endpoint and other enabled integrations.</p>
                </div>
              </div>

              <h2>Credential Sources and Provider Requests</h2>
              <p>
                Credentials are read from the operating-system keyring or the agent environment. HELIX includes credentials in authenticated requests to the configured provider or endpoint; review its policies and verify custom endpoint security.
              </p>
            </article>
          )}

          {activeSection === 'tools' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 4</span>
              <h1>System Tools & Permission Checks</h1>
              <p className="docs-lead">
                HELIX can call supported desktop tools through local policy and permission checks. These checks do not replace operating-system security controls.
              </p>

              <h2>Action-specific requirements</h2>
              <ul>
                <li><strong>Shell commands:</strong> Require confirmation in the local policy engine.</li>
                <li><strong>Other tools:</strong> Confirmation requirements vary by tool and action; do not assume every potentially destructive action is covered.</li>
                <li><strong>Unknown tools:</strong> The policy engine rejects tools without a matching policy.</li>
              </ul>

              <h2>Screenshot and OCR</h2>
              <p>
                Screen context can be included in supported tasks. Captured images may be sent to the configured remote vision provider; review the content before requesting analysis.
              </p>
            </article>
          )}

          {activeSection === 'voice' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 5</span>
              <h1>Voice, Microphone & SoundDevice</h1>
              <p className="docs-lead">
                Voice input depends on microphone availability, operating-system permissions, and the selected voice settings.
              </p>

              <h2>How to activate listening</h2>
              <ul>
                <li><strong>Wake word:</strong> When voice activation is enabled, microphone input may stay open for local wake-word detection.</li>
                <li><strong>Transcription:</strong> Speech-to-text can use local Whisper or the OpenAI API. Selecting OpenAI sends captured audio to that service.</li>
                <li><strong>Hardware:</strong> Verify microphone permission and device selection on the installed edition; this has not been tested on physical hardware.</li>
              </ul>
            </article>
          )}

          {activeSection === 'mcp' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 6</span>
              <h1>MCP Server Connection (Model Context Protocol)</h1>
              <p className="docs-lead">
                MCP servers can extend the available tools. Review each server's command, environment, and permissions before enabling it.
              </p>

              <h2>Configuration</h2>
              <p>Use the MCP section in the app to configure supported stdio servers. Review commands, arguments, and environment variables before saving; do not paste credentials into shared examples or logs.</p>
            </article>
          )}

          {activeSection === 'faq' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 7</span>
              <h1>Diagnostics & Frequently Asked Questions</h1>
              
              <div className="docs-faq-item">
                <h3>Does Windows SmartScreen show a warning when installing HELIX Lite?</h3>
                <p>
                  HELIX Lite installers are unsigned, so Windows may show an unknown-publisher warning. Verify the SHA-256 checksum on the release page before running an installer.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>Where are the agent log files stored?</h3>
                <p>
                  Log locations depend on the installed edition and configuration. Inspect local logs before sharing them because they may contain sensitive diagnostics.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>Can I switch between HELIX Normal and HELIX Lite?</h3>
                <p>
                  The editions use separate installers and update channels. Configuration migration and memory differences have not been validated; back up settings and credentials before switching editions.
                </p>
              </div>
            </article>
          )}
        </main>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer__inner">
          <p>© {new Date().getFullYear()} HELIX Project. HELIX documentation.</p>
          <div className="docs-footer__links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/features">What's New</Link>
            <Link to="/download">Download</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
