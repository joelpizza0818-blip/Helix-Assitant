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
              HELIX runs a local agent and can contact configured AI providers and other services. This page summarizes the data paths visible in the current code; handling and retention also depend on your configuration and each service's policies.
            </p>
            <div className="privacy-badge-row">
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Configured AI Providers
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Optional Screen Context
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                OS Keyring or Environment
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Tool Policies Vary by Action
              </span>
            </div>
          </div>

          <article className="privacy-article">
            <section className="privacy-section">
              <h2>1. Local-First Architecture and Design Philosophy</h2>
              <p>
                HELIX provides Windows desktop shells built with Electron and Tauri, backed by a local Python agent.
              </p>
              <p>
                Agent processing is local, but prompts, images, audio, account, licensing, or update requests may be sent to services selected by the app or configured by you. Data handling depends on those services.
              </p>
            </section>

            <section className="privacy-section">
              <h2>2. Screen Capture and Visual Recognition (OCR)</h2>
              <p>
                Screen context is optional and can be used for requests or enabled task workflows:
              </p>
              <ul>
                <li><strong>When capture can occur:</strong> A request or configured task can include screen context; optional sampling may run during an active task when enabled.</li>
                <li><strong>Provider data flow:</strong> Captured content is attached to the task context and may be sent to a configured remote vision provider. Review that provider's retention and privacy policies.</li>
                <li><strong>Check before sharing:</strong> Do not include passwords, financial information, or other sensitive content unless you intend to send it to the selected provider.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>3. Audio and Microphone (SoundDevice)</h2>
              <p>
                Voice input is optional and depends on device availability, operating-system permissions, and the selected settings:
              </p>
              <ul>
                <li><strong>Wake-word mode:</strong> When voice activation is enabled, the agent may keep microphone input open for local wake-word detection.</li>
                <li><strong>Transcription:</strong> Speech-to-text can use local Whisper or the OpenAI API; choosing a remote provider sends captured audio to that provider.</li>
                <li><strong>Permissions:</strong> App settings and operating-system microphone permissions control access. Availability and status indicators should be verified on the installed edition and device.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>4. Credential Sources and Provider Requests</h2>
              <p>
                HELIX supports configured AI providers and compatible local or custom endpoints:
              </p>
              <ul>
                <li><strong>Credential sources:</strong> Credentials are read from the operating-system keyring or the agent environment.</li>
                <li><strong>Authenticated requests:</strong> HELIX sends credentials and request content to the configured provider or endpoint when a request needs them. Confirm the endpoint and its transport security before use.</li>
                <li><strong>Local endpoints:</strong> A local model endpoint can process requests locally, but other enabled integrations may still contact remote services.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>5. Tool Permissions and Confirmation</h2>
              <p>
                HELIX exposes supported desktop tools through local permission and confirmation checks:
              </p>
              <ul>
                <li><strong>Action-specific controls:</strong> Shell-command execution requires confirmation in the local policy engine; requirements vary by tool and action. These checks do not replace operating-system permissions.</li>
                <li><strong>Logs:</strong> Application logs are not a guaranteed complete audit trail. Review logs for sensitive information before sharing them.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>6. External Services and Data Retention</h2>
              <p>
                A complete telemetry and retention inventory has not been verified in this review. HELIX can contact configured AI providers and services used for account, licensing, and updates:
              </p>
              <ul>
                <li>Review the privacy and retention policies of each provider and service before sending personal or sensitive data.</li>
                <li>This page does not make a verified claim about data sales, telemetry, or retention across all connected services.</li>
                <li>The release-notification form sends submitted email addresses to the update service. Its current implementation keeps subscribers in process memory; durable storage and notification delivery have not been verified.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>7. Deletion and User Rights</h2>
              <p>
                Data deletion depends on where it is stored:
              </p>
              <ul>
                <li>Conversation history, OS keyring entries, environment files, and provider-side records have separate retention and deletion behavior; HELIX does not control provider-side records.</li>
                <li>Uninstalling HELIX does not necessarily remove credentials or data stored outside the application directory. Review each storage location and connected provider separately.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>8. Contact and Support</h2>
              <p>
                If you have questions about HELIX security or wish to report a concern about the agent's privacy, you can reach out through the official HELIX project GitHub repository.
              </p>
              <div className="privacy-cta-box">
                <div>
                  <h3>Review the current HELIX download options.</h3>
                  <p>Check the data flows, permissions, and provider policies before installing.</p>
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
          <span>© {new Date().getFullYear()} HELIX Project.</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
};
