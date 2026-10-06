import React from 'react';
import './Security.css';

export const Security: React.FC = () => {
  return (
    <section className="security" id="security">
      <div className="security-container">
        <div className="section-header">
          <span className="section-label">ZERO-TRUST DESKTOP ARCHITECTURE</span>
          <h2 className="section-title">Your Keys. Your Machine. Your Control.</h2>
          <p className="section-desc">
            HELIX is built with defense-in-depth principles. The AI is a guest inside an isolated tool execution runtime with mandatory policy enforcement.
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
            <h3 className="security-title">Local OS-Backed Keystore</h3>
            <p className="security-body">
              API keys are encrypted using Windows Data Protection API (DPAPI) via the native OS keyring. Keys are never transmitted to any third-party servers, databases, or frontend logs.
            </p>
          </div>

          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <polyline points="9 12 11 14 15 10"></polyline>
              </svg>
            </div>
            <h3 className="security-title">Strict Confirmation Handshakes</h3>
            <p className="security-body">
              Before running any potentially destructive action (deleting files, executing shell scripts, modifying system paths), HELIX displays an explicit confirmation dialog detailing what will change and why.
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
              Hand gestures and wake word recognition occur entirely locally on your CPU/GPU using MediaPipe and local VAD. Raw video and ambient audio streams are never sent to external LLMs.
            </p>
          </div>

          <div className="security-card">
            <div className="security-icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="security-svg-icon">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
            </div>
            <h3 className="security-title">Protected System Boundaries</h3>
            <p className="security-body">
              System32, Windows binaries, core registry trees, and critical OS processes (such as lsass.exe and winlogon.exe) are hard-blocked by policy. The agent cannot terminate or modify them.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
