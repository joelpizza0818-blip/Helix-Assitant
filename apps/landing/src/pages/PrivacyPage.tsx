import React from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './PrivacyPage.css';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="privacy-page" id="top">
      <header className="privacy-header">
        <Link to="/" className="privacy-header__brand" aria-label="Return to HELIX main page">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="privacy-header__links">
          <Link to="/" className="privacy-header__link">Home</Link>
          <Link to="/features" className="privacy-header__link">What's New</Link>
          <Link to="/docs" className="privacy-header__link">Documentation</Link>
          <Link to="/download" className="privacy-header__cta">Download</Link>
        </div>
      </header>

      <main className="privacy-content">
        <div className="privacy-container">
          <div className="privacy-hero">
            <span className="privacy-eyebrow">PRIVACY & SECURITY POLICY</span>
            <h1>Your desktop. Your privacy. Your boundaries.</h1>
            <p className="privacy-lead">
              HELIX is designed under the fundamental principle of <strong>Local-First and Zero-Trust</strong>. This policy describes with full transparency how the agent interacts with your screen, microphone, files, and artificial intelligence credentials.
            </p>
            <div className="privacy-badge-row">
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                100% No Data Sales
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Screen Capture Only On Demand
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Local Credentials on Windows
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Zero-Trust Access Confirmed by You
              </span>
            </div>
          </div>

          <article className="privacy-article">
            <section className="privacy-section">
              <h2>1. Local-First Architecture and Design Philosophy</h2>
              <p>
                Unlike assistants based exclusively in the cloud, HELIX operates as a resident application on your Windows operating system (available in a full version with Electron and an ultra-lightweight version with Tauri). The agent's core runs locally on your computer.
              </p>
              <p>
                This means that your work data, process tree, active windows, and local documents are not transferred to HELIX central servers for storage, profiling, or model training.
              </p>
            </section>

            <section className="privacy-section">
              <h2>2. Screen Capture and Visual Recognition (OCR)</h2>
              <p>
                HELIX has screen reading capabilities to help you resolve questions about what you're seeing. Our capture policy states:
              </p>
              <ul>
                <li><strong>Activation exclusively on demand:</strong> HELIX never records your screen continuously or in the background. Capture is only executed when you make an explicit request in the chat (for example, <em>"what error does this window show?"</em>) or when activating a skill that requires visual context.</li>
                <li><strong>Processing in volatile memory:</strong> Screenshots are analyzed in temporary RAM and discarded after completing the interaction turn. No capture history is created on disk or on remote servers.</li>
                <li><strong>Sensitive area control:</strong> You can configure exclusions for windows with sensitive content such as password managers or banking applications.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>3. Audio and Microphone (SoundDevice)</h2>
              <p>
                HELIX incorporates a native voice engine to enable interaction through spoken commands:
              </p>
              <ul>
                <li><strong>No permanent passive listening:</strong> The microphone only opens during active voice sessions initiated by you (via keyboard shortcut or voice button).</li>
                <li><strong>Visible status indicator:</strong> Whenever HELIX is listening, you will see a clear animated visual indicator in the toolbar and the floating interface.</li>
                <li><strong>Instant deactivation:</strong> You can mute the microphone or revoke audio permission at any time from Windows settings or the system tray.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>4. Model Credentials and Secure Storage</h2>
              <p>
                HELIX allows you to connect your own artificial intelligence providers (Google Gemini, Anthropic Claude, OpenAI, Groq) or local engines (Ollama):
              </p>
              <ul>
                <li><strong>Secure storage in the Windows Credential Manager:</strong> Your API keys are never sent to HELIX servers. They are stored encrypted in the <code>Windows Credential Manager</code> or in your local <code>.env</code> file.</li>
                <li><strong>Direct connection between client and provider:</strong> Calls to language models travel directly via TLS/HTTPS encrypted connections from your machine to the provider endpoints you have configured.</li>
                <li><strong>Offline local models:</strong> If you configure HELIX with Ollama or local models, your conversations and tasks never leave your local network.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>5. System Tool Execution and Zero-Trust Model</h2>
              <p>
                To automate complex tasks, HELIX has tools to manipulate the file system, execute commands in PowerShell, and control applications:
              </p>
              <ul>
                <li><strong>Policy Checked:</strong> Before executing any action that modifies files, deletes data, changes registry settings, or downloads packages, HELIX requests your explicit confirmation through an on-screen dialog.</li>
                <li><strong>Local audit log:</strong> All actions executed by the tools are logged in a local log file on your machine so you can precisely audit what commands were run and when.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>6. Telemetry and Personal Data</h2>
              <p>
                HELIX maintains a strict stance on data collection:
              </p>
              <ul>
                <li><strong>Zero data sales:</strong> We do not sell, rent, or trade your personal information, your queries, or your work context to third parties under any circumstances.</li>
                <li><strong>Minimal and anonymized telemetry:</strong> We only collect optional metrics on application stability and critical compiler crashes, without personal identifiers, usernames, or message content.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>7. Deletion and User Rights</h2>
              <p>
                In compliance with data protection regulations such as GDPR, CCPA, and best practices for desktop software security:
              </p>
              <ul>
                <li>You have the right to purge any previous conversations, settings, or saved credentials directly from the HELIX settings menu.</li>
                <li>Complete uninstallation through the Windows Control Panel removes the agent's executables, logs, and services cleanly.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>8. Contact and Support</h2>
              <p>
                If you have questions about HELIX security or wish to report a concern about the agent's privacy, you can reach out through the official HELIX project GitHub repository.
              </p>
              <div className="privacy-cta-box">
                <div>
                  <h3>Ready to try HELIX with full peace of mind?</h3>
                  <p>Download the Windows version with pre-approved security policies.</p>
                </div>
                <Link to="/download" className="privacy-btn-action">Download HELIX</Link>
              </div>
            </section>
          </article>
        </div>
      </main>

      <footer className="privacy-footer">
        <div className="privacy-footer__inner">
          <div className="privacy-footer__brand">
            <HelixLogo size="sm" showText />
            <p>Persistent desktop agent for Windows.</p>
          </div>
          <div className="privacy-footer__nav">
            <div>
              <span>EXPLORE</span>
              <Link to="/">Home</Link>
              <Link to="/features">What's New</Link>
              <Link to="/docs">Documentation</Link>
            </div>
            <div>
              <span>LEGAL & ACCOUNT</span>
              <Link to="/privacy">Privacy</Link>
              <Link to="/login">Sign In</Link>
              <Link to="/register">Create Account</Link>
            </div>
          </div>
        </div>
        <div className="privacy-footer__bottom">
          <span>© {new Date().getFullYear()} HELIX Project. Licensed under Apache 2.0.</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
};
