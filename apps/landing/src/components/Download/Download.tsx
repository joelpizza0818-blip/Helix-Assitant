import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Download.css';
import { InstallerDownloadButton } from './InstallerDownloadButton';
import { getLatestInstallerVersion, getLatestMobileRelease, type MobileReleaseDownload } from '../../lib/downloads';

export const Download: React.FC<{ requireAuthenticatedDownload?: boolean }> = ({
  requireAuthenticatedDownload = false,
}) => {
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [mobileRelease, setMobileRelease] = useState<MobileReleaseDownload | null>(null);
  const [mobileReleaseError, setMobileReleaseError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getLatestInstallerVersion(controller.signal)
      .then(setInstallerVersion)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Could not load the current Windows installer version.', error);
        setVersionError(true);
      });
    getLatestMobileRelease(controller.signal)
      .then(setMobileRelease)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.info('HELIX Mobile download is not published yet.', error);
        setMobileReleaseError(true);
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="download-section" id="download">
      <div className="download-container">
        <div className="download-box">
          <div className="download-header">
            <span className="section-label">GET HELIX FOR WINDOWS</span>
            <h2 className="download-title">HELIX Desktop for Windows</h2>
            <p className="download-desc">
              The current Windows x64 desktop installer is available below.
            </p>
          </div>

          <div className="release-options" aria-label="Windows installer availability">
            <article className="release-option release-option-available">
              <div>
                <h3>HELIX Normal</h3>
                <p>Electron · Windows x64 installer</p>
              </div>
              <span className="release-option-status">Current installer</span>
            </article>
          </div>

          <div className="mobile-download-card" aria-label="HELIX mobile availability">
            <div>
              <span className="section-label">HELIX MOBILE</span>
              <h3>Control your Desktop from your phone</h3>
              <p>Flutter multiplatform client with SSH tunneling and authenticated WebSocket control. The mobile app never replaces the Desktop agent.</p>
            </div>
            {mobileRelease ? (
              <div className="download-actions">
                <a className="btn-primary" href={mobileRelease.installerUrl}>
                  Download HELIX Mobile v{mobileRelease.version} {mobileRelease.architecture === 'arm64' ? '(ARM64)' : 'for Android'}
                </a>
                {mobileRelease.universalInstallerUrl && (
                  <a className="release-checksum-link" href={mobileRelease.universalInstallerUrl}>
                    Download universal APK (all Android architectures)
                  </a>
                )}
                {mobileRelease.universalChecksumUrl && (
                  <a className="release-checksum-link" href={mobileRelease.universalChecksumUrl}>
                    Universal APK SHA-256 checksum
                  </a>
                )}
                <a className="release-checksum-link" href={mobileRelease.releaseUrl} target="_blank" rel="noreferrer">View Android release and SHA-256 checksum</a>
              </div>
            ) : (
              <span className="release-option-status">{mobileReleaseError ? 'Android package pending publication' : 'Checking Android release'}</span>
            )}
          </div>

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
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
cd Helix-Assitant

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
              <span className="req-val">Minimum requirements are not yet validated</span>
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
