import React from 'react';
import './Security.css';

export const Security: React.FC = () => {
  return (
    <section className="security" id="security">
      <div className="security-container">
        <div className="section-header">
          <span className="section-label">LOCAL-FIRST DESKTOP CONTROLS</span>
          <h2 className="section-title">Your Machine. Your Provider Choice.</h2>
          <p className="section-desc">
            HELIX applies local policy checks to supported tools. AI requests may leave your device when sent to a provider configured in the app.
          </p>
        </div>

        <div className="security-grid">
          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h3 className="security-title">Provider Credential Handling</h3>
            <p className="security-body">
              Credentials are read from the OS keyring or the agent environment. HELIX includes them in authenticated requests to the provider you select; review that provider's data policies.
            </p>
          </div>

          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <polyline points="9 12 11 14 15 10"></polyline>
              </svg>
            </div>
            <h3 className="security-title">Tool Confirmation Policy</h3>
            <p className="security-body">
              The local policy engine requires confirmation for shell-command execution and rejects unrecognized tools. Other actions may have different confirmation requirements.
            </p>
          </div>

          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </div>
            <h3 className="security-title">Local Computer Vision</h3>
            <p className="security-body">
              Hand-gesture and wake-word detection run locally. Speech-to-text uses local Whisper when selected; choosing OpenAI sends audio to OpenAI for transcription.
            </p>
          </div>

          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
            </div>
            <h3 className="security-title">Operating-System Protections</h3>
            <p className="security-body">
              HELIX policies apply only to supported tool actions; they do not replace Windows permissions or other operating-system security controls.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
