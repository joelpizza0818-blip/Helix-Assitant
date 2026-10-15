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
              4. Tools & Zero-Trust Mode
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
            <span className="docs-box-tag">RECOMMENDED VERSION</span>
            <p>HELIX Lite (Tauri) uses up to 80% less RAM on systems with limited resources.</p>
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
                  <li><strong>Desktop Shell (Electron or Tauri):</strong> Graphical interface residing in the System Tray, floating panel, and global keyboard controls.</li>
                  <li><strong>Agent Core (Python Service):</strong> Autonomous engine that processes the agent's thinking cycle, orchestrates local tools, interprets OCR vision, and manages working memory.</li>
                  <li><strong>Local IPC:</strong> High-speed, authenticated local inter-process communication between the desktop interface and the agent service.</li>
                </ul>
              </div>

              <h2>Local-First Philosophy</h2>
              <p>
                HELIX does not require a proprietary subscription to closed models nor does it store your queries in the HELIX cloud. You configure your own API keys or use local models with Ollama on your graphics card.
              </p>
            </article>
          )}

          {activeSection === 'install' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 2</span>
              <h1>Installation: HELIX Normal vs HELIX Lite</h1>
              <p className="docs-lead">
                We offer two official distributions to meet different hardware requirements and environment preferences.
              </p>

              <div className="docs-comparison-table">
                <div className="comparison-col">
                  <h3>HELIX Normal (Electron)</h3>
                  <span className="comparison-tag">Full Version</span>
                  <ul>
                    <li>Integrated shell based on Chromium/Node.js</li>
                    <li>Extended support for heavy visual extensions</li>
                    <li>Automatic updater with channel verification</li>
                    <li>Base memory: ~180MB RAM</li>
                    <li>Recommended for workstations and modern PCs</li>
                  </ul>
                </div>
                <div className="comparison-col is-featured">
                  <h3>HELIX Lite (Tauri)</h3>
                  <span className="comparison-tag">Ultra-Light · Fast</span>
                  <ul>
                    <li>Shell built in Rust with native Windows WebView2</li>
                    <li>Instant startup and reduced binary size (~15MB)</li>
                    <li>Reduced base memory: ~40MB RAM</li>
                    <li>Same full support for the Python engine and AI models</li>
                    <li>Recommended for laptops and maximum energy efficiency</li>
                  </ul>
                </div>
              </div>

              <h2>System Requirements</h2>
              <ul>
                <li><strong>Operating System:</strong> Windows 10 (Build 19041+) or Windows 11 (64-bit).</li>
                <li><strong>Processor:</strong> Intel Core i3 / AMD Ryzen 3 or higher (x64).</li>
                <li><strong>RAM:</strong> Minimum 4 GB (8 GB recommended for large models or continuous OCR).</li>
                <li><strong>WebView2:</strong> Installed by default on Windows 11 and recent versions of Windows 10.</li>
              </ul>
            </article>
          )}

          {activeSection === 'models' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 3</span>
              <h1>AI Provider Configuration</h1>
              <p className="docs-lead">
                Easily configure the models you prefer. Your keys never leave your machine to HELIX servers.
              </p>

              <h2>Supported Providers</h2>
              <div className="docs-provider-grid">
                <div className="provider-card">
                  <h4>Google Gemini</h4>
                  <p>Compatible with Gemini 1.5 Pro, Flash, and Gemini 2.0. Ideal for giant context windows and native multimodality.</p>
                  <code>GEMINI_API_KEY=your_key_here</code>
                </div>
                <div className="provider-card">
                  <h4>Anthropic Claude</h4>
                  <p>Compatible with Claude 3.5 Sonnet and Haiku. Excellent precision for programming and structured reasoning.</p>
                  <code>ANTHROPIC_API_KEY=your_key_here</code>
                </div>
                <div className="provider-card">
                  <h4>OpenAI</h4>
                  <p>Compatible with GPT-4o, GPT-4o-mini, and o1. Great versatility and tool execution speed.</p>
                  <code>OPENAI_API_KEY=your_key_here</code>
                </div>
                <div className="provider-card">
                  <h4>Ollama (Local Models)</h4>
                  <p>Run Llama 3, Qwen, DeepSeek, or Mistral 100% offline and free on your local GPU.</p>
                  <code>OLLAMA_BASE_URL=http://localhost:11434</code>
                </div>
              </div>

              <h2>Secure Key Storage</h2>
              <p>
                You can enter your keys directly from the HELIX configuration interface (Toolbox) so they are saved encrypted in the <strong>Windows Credential Manager</strong>, or define a <code>.env</code> file in the agent's root directory.
              </p>
            </article>
          )}

          {activeSection === 'tools' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 4</span>
              <h1>System Tools & Zero-Trust Mode</h1>
              <p className="docs-lead">
                HELIX is not limited to responding with text: it can execute concrete actions on your computer, always under your rules.
              </p>

              <h2>Zero-Trust Philosophy</h2>
              <p>
                No AI should have unrestricted write access to your operating system. That's why HELIX implements a policy verification layer:
              </p>
              <ul>
                <li><strong>Read operations:</strong> Checking the time, listing files in a directory, or reading requested documents are executed seamlessly.</li>
                <li><strong>Modification or destructive operations:</strong> Creating files, editing code, running PowerShell scripts, or installing libraries display a pop-up dialog with the exact command for you to approve with a click.</li>
              </ul>

              <h2>Screenshot and OCR</h2>
              <p>
                To ask for help with what's on your screen, press the screen button or type: <em>"what does the error in the console mean?"</em>. HELIX captures only the relevant area, processes the text with OCR, and analyzes it in the same turn.
              </p>
            </article>
          )}

          {activeSection === 'voice' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 5</span>
              <h1>Voice, Microphone & SoundDevice</h1>
              <p className="docs-lead">
                Talk to HELIX with the naturalness of a phone call or a walkie-talkie on your desktop.
              </p>

              <h2>How to activate listening</h2>
              <ul>
                <li><strong>Global shortcut:</strong> Press <code>Ctrl + Shift + Space</code> (configurable) to invoke HELIX by voice.</li>
                <li><strong>Visible indicator:</strong> While the microphone is open, the animated sound wave will be displayed in amber color in the floating window.</li>
                <li><strong>Audio processing:</strong> The audio captured by SoundDevice is transcribed in real time and the microphone is closed immediately after processing your turn.</li>
              </ul>
            </article>
          )}

          {activeSection === 'mcp' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 6</span>
              <h1>MCP Server Connection (Model Context Protocol)</h1>
              <p className="docs-lead">
                Extend HELIX's capabilities by integrating it with databases, GitHub APIs, headless browsers, and custom tools through the open MCP standard.
              </p>

              <h2>Configuration in <code>helix-config.json</code></h2>
              <pre className="docs-code-block">
{`{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\your_username\\Projects"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}`}
              </pre>
            </article>
          )}

          {activeSection === 'faq' && (
            <article className="docs-article">
              <span className="docs-badge">SECTION 7</span>
              <h1>Diagnostics & Frequently Asked Questions</h1>
              
              <div className="docs-faq-item">
                <h3>Does Windows SmartScreen show a warning when installing HELIX Lite?</h3>
                <p>
                  Because HELIX Lite is an executable generated directly by the Tauri pipeline and does not yet have an expensive commercial EV code signing certificate, Windows Defender may show the blue "Windows protected your PC" screen. You can click <em>"More info"</em> and then <em>"Run anyway"</em>. Additionally, the installer publishes its SHA-256 checksum on GitHub so you can verify its integrity.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>Where are the agent log files stored?</h3>
                <p>
                  Activity and debug logs are stored locally at <code>%USERPROFILE%\.helix\logs</code>. You can inspect or delete them at any time.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>Can I switch between HELIX Normal and HELIX Lite?</h3>
                <p>
                  Yes. Both versions share the same model and tool configuration base, so you can install HELIX Lite if you need lower memory consumption without losing your previous configuration.
                </p>
              </div>
            </article>
          )}
        </main>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer__inner">
          <p>© {new Date().getFullYear()} HELIX Project. Official technical documentation.</p>
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
