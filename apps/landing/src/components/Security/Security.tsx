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
            <span className="security-icon">🔒</span>
            <h3 className="security-title">Local OS-Backed Keystore</h3>
            <p className="security-body">
              API keys are encrypted using Windows Data Protection API (DPAPI) via the native OS keyring. Keys are never transmitted to any third-party servers, databases, or frontend logs.
            </p>
          </div>

          <div className="security-card">
            <span className="security-icon">🛡</span>
            <h3 className="security-title">Strict Confirmation Handshakes</h3>
            <p className="security-body">
              Before running any potentially destructive action (deleting files, executing shell scripts, modifying system paths), HELIX displays an explicit confirmation dialog detailing what will change and why.
            </p>
          </div>

          <div className="security-card">
            <span className="security-icon">👁</span>
            <h3 className="security-title">Local Computer Vision</h3>
            <p className="security-body">
              Hand gestures and wake word recognition occur entirely locally on your CPU/GPU using MediaPipe and local VAD. Raw video and ambient audio streams are never sent to external LLMs.
            </p>
          </div>

          <div className="security-card">
            <span className="security-icon">🚫</span>
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
