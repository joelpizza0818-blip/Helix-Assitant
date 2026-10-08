import React from 'react';
import { Link } from 'react-router-dom';
import './Download.css';
import { InstallerDownloadButton } from './InstallerDownloadButton';

export const Download: React.FC<{ requireAuthenticatedDownload?: boolean }> = ({
  requireAuthenticatedDownload = false,
}) => {
  return (
    <section className="download-section" id="download">
      <div className="download-container">
        <div className="download-box">
          <div className="download-header">
            <span className="section-label">GET HELIX FOR WINDOWS</span>
            <h2 className="download-title">Resident Autonomous Intelligence</h2>
            <p className="download-desc">
              Download the Windows installer. HELIX launches its tray shell and local agent automatically after setup — no terminal command is required.
            </p>
          </div>

          <div className="download-actions">
            {requireAuthenticatedDownload ? (
              <InstallerDownloadButton className="btn-primary" >
                Download HELIX for Windows
              </InstallerDownloadButton>
            ) : (
              <Link className="btn-primary" to="/download">
                Sign in to download HELIX
              </Link>
            )}
            <span className="build-tag">VERSION: v0.1.0-PREVIEW (x64)</span>
          </div>

          <div className="source-instructions" id="source-code-instructions">
            <div className="instructions-title">Quickstart from Source</div>
            <pre className="code-block selectable">
              <code>{`# 1. Clone repository
git clone https://github.com/your-org/helix.git
cd helix

# 2. Run automated Windows setup script
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

# 3. Configure your API keys (Google, Anthropic, or OpenAI)
copy .env.example .env

# 4. Launch Desktop Shell & Python Agent
npm run dev:desktop`}</code>
            </pre>
          </div>

          <div className="sys-reqs">
            <div className="req-item">
              <span className="req-title">OPERATING SYSTEM</span>
              <span className="req-val">Windows 10 / 11 (64-bit)</span>
            </div>
            <div className="req-item">
              <span className="req-title">RUNTIME</span>
              <span className="req-val">Bundled HELIX runtime</span>
            </div>
            <div className="req-item">
              <span className="req-title">HARDWARE</span>
              <span className="req-val">8GB RAM (16GB recommended)</span>
            </div>
            <div className="req-item">
              <span className="req-title">OPTIONAL PERCEPTION</span>
              <span className="req-val">Webcam & Microphone</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
