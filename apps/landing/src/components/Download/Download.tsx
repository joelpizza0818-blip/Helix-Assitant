import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Download.css';
import { InstallerDownloadButton } from './InstallerDownloadButton';
import { getLatestInstallerVersion, getLatestLiteRelease, type LiteReleaseDownload } from '../../lib/downloads';

export const Download: React.FC<{ requireAuthenticatedDownload?: boolean }> = ({
  requireAuthenticatedDownload = false,
}) => {
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [liteRelease, setLiteRelease] = useState<LiteReleaseDownload | null>(null);
  const [liteReleaseError, setLiteReleaseError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getLatestInstallerVersion(controller.signal)
      .then(setInstallerVersion)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Could not load the current Windows installer version.', error);
        setVersionError(true);
      });
    getLatestLiteRelease(controller.signal)
      .then(setLiteRelease)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Could not load the current HELIX Lite release.', error);
        setLiteReleaseError(true);
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="download-section" id="download">
      <div className="download-container">
        <div className="download-box">
          <div className="download-header">
            <span className="section-label">GET HELIX FOR WINDOWS</span>
            <h2 className="download-title">Resident Autonomous Intelligence</h2>
            <p className="download-desc">
              Choose an edition and installation profile. Only verified installers are available to download.
            </p>
          </div>

          <div className="release-options" aria-label="Windows installer availability">
            <article className="release-option release-option-available">
              <div>
                <h3>HELIX Normal</h3>
                <p>Electron · Complete installation</p>
              </div>
              <span className="release-option-status">Current installer</span>
            </article>
            <article className="release-option" aria-disabled="true">
              <div>
                <h3>HELIX Normal</h3>
                <p>Electron · Progressive installation</p>
              </div>
              <span className="release-option-status">Not published</span>
            </article>
            <article className="release-option release-option-available">
              <div>
                <h3>HELIX Lite</h3>
                <p>Tauri · Complete installation</p>
              </div>
              <span className="release-option-status">
                {liteRelease ? `v${liteRelease.version}` : liteReleaseError ? 'Unavailable' : 'Checking release'}
              </span>
            </article>
            <article className="release-option" aria-disabled="true">
              <div>
                <h3>HELIX Lite</h3>
                <p>Tauri · Progressive installation</p>
              </div>
              <span className="release-option-status">Not published</span>
            </article>
          </div>

          <p className="release-options-note release-options-warning" role="note">
            HELIX Lite is a separate, unsigned Windows installer. Windows may warn that the publisher is unknown. Verify the SHA-256 checksum on the Lite release page before running it. Do not use this installer to update HELIX Normal; Electron keeps its own update channel.
          </p>

          <div className="download-actions">
            {requireAuthenticatedDownload ? (
              <InstallerDownloadButton className="btn-primary" >
                Download HELIX Normal for Windows
              </InstallerDownloadButton>
            ) : (
              <Link className="btn-primary" to="/download">
                Sign in to download HELIX Normal
              </Link>
            )}
            {liteRelease ? (
              <>
                <a
                  className="btn-primary"
                  href={liteRelease.installerUrl}
                  rel="noreferrer"
                >
                  Download HELIX Lite v{liteRelease.version} (unsigned)
                </a>
                <a
                  className="release-checksum-link"
                  href={liteRelease.releaseUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View Lite release and SHA-256 checksum
                </a>
              </>
            ) : (
              <span className="release-checksum-link" role="status">
                {liteReleaseError ? 'HELIX Lite download is temporarily unavailable.' : 'Loading HELIX Lite release…'}
              </span>
            )}
            <span
              className="build-tag"
              role="status"
              aria-live="polite"
              aria-label={versionError
                ? 'The current installer version could not be loaded. Refresh the page to try again.'
                : undefined}
            >
              VERSION: {installerVersion ? `v${installerVersion}` : versionError ? 'unavailable' : 'checking…'} (x64)
            </span>
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
