import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveSiteNavigation } from '../components/ResponsiveSiteNavigation';
import { InstallerDownloadButton } from '../components/Download/InstallerDownloadButton';
import { PrivacyModal } from '../components/PrivacyModal/PrivacyModal';
import { getLatestInstallerVersion, getLatestLiteRelease, mapMobileReleaseDownload, type LiteReleaseDownload, type MobileReleaseDownload } from '../lib/downloads';
import { fetchPublicInstallers, fetchPublicReleaseHistory, type LandingInstaller } from '../lib/landingContent';
import './DownloadPage.css';

export const DownloadPage: React.FC = () => {
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [liteRelease, setLiteRelease] = useState<LiteReleaseDownload | null>(null);
  const [liteReleaseError, setLiteReleaseError] = useState(false);
  const [mobileRelease, setMobileRelease] = useState<MobileReleaseDownload | null>(null);
  const [mobileReleaseError, setMobileReleaseError] = useState(false);
  const [iosRelease, setIosRelease] = useState<MobileReleaseDownload | null>(null);
  const [iosReleaseError, setIosReleaseError] = useState(false);
  const [mobileReleaseHistory, setMobileReleaseHistory] = useState<LandingInstaller[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [catalogInstallers, setCatalogInstallers] = useState<LandingInstaller[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [litePrivacyOpen, setLitePrivacyOpen] = useState(false);
  const [selectedOS, setSelectedOS] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [cliCopied, setCliCopied] = useState(false);

  const handleCopyCli = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText('npx helix-assistant-cli');
      setCliCopied(true);
      setTimeout(() => setCliCopied(false), 2000);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    getLatestInstallerVersion(controller.signal)
      .then(setInstallerVersion)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load installer version', err);
        setVersionError(true);
      });

    getLatestLiteRelease(controller.signal)
      .then(setLiteRelease)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load Lite release', err);
        setLiteReleaseError(true);
      });

    fetchPublicInstallers(controller.signal)
      .then((installers) => {
        setCatalogInstallers(installers)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load the public installer catalog.', err);
        setCatalogError(err instanceof Error ? err.message : 'Published installer catalog is unavailable.')
        setMobileReleaseError(true)
        setIosReleaseError(true)
      });

    fetchPublicReleaseHistory(controller.signal)
      .then((releases) => {
        setMobileReleaseHistory(releases)
        const android = releases.find((item) => item.platform === 'android' && item.edition === 'mobile')
        const ios = releases.find((item) => item.platform === 'ios' && item.edition === 'mobile')
        setMobileRelease(android?.installerUrl && android.checksumUrl ? mapMobileReleaseDownload(android) : null)
        setIosRelease(ios?.installerUrl && ios.checksumUrl ? mapMobileReleaseDownload(ios) : null)
        setMobileReleaseError(!android?.installerUrl || !android.checksumUrl)
        setIosReleaseError(!ios?.installerUrl || !ios.checksumUrl)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load the public release history.', err);
        setHistoryError(err instanceof Error ? err.message : 'Published release history is unavailable.')
        setMobileReleaseError(true)
        setIosReleaseError(true)
      });

    return () => controller.abort();
  }, []);

  const handleLiteDownloadClick = (e: React.MouseEvent) => {
    const isAccepted = typeof window !== 'undefined' && localStorage.getItem('helix_privacy_accepted') === 'true';
    if (!isAccepted) {
      e.preventDefault();
      setLitePrivacyOpen(true);
    }
  };

  return (
    <div className="download-page" id="top">
      <ResponsiveSiteNavigation />

      <main className="download-main">
        <div className="download-container">
          {/* Hero */}
          <div className="download-hero">
            <span className="download-eyebrow">OFFICIAL DISTRIBUTION · WINDOWS X64</span>
            <h1 className="download-title">Download HELIX for your Desktop</h1>
            <p className="download-lead">
            HELIX currently publishes Windows x64 desktop installers for Normal and Lite. Both use the local Python agent; AI requests go to the providers configured in the app.
            </p>
          </div>

          {/* OS Selector Tabs (Windows / macOS / Linux) */}
          <div className="download-os-bar">
            <span className="download-os-label">Select your Operating System:</span>
            <div className="download-os-tabs" role="tablist">
              <button
                type="button"
                className={`download-os-tab ${selectedOS === 'windows' ? 'download-os-tab--active' : ''}`}
                onClick={() => setSelectedOS('windows')}
                role="tab"
                aria-selected={selectedOS === 'windows'}
              >
                {/* Windows Icon */}
                <svg viewBox="0 0 88 88" width="16" height="16" fill="currentColor">
                  <path d="M0 12.402l35.687-4.86.016 34.423-35.67.203zm35.67 33.529l.028 34.453L.028 75.48.016 46.134zM40.977 45.93l46.994.275-.016 41.795-46.99-6.608zm47.023-4.133L40.977 42.06V6.155L88 0z" />
                </svg>
                <span>Windows</span>
                <span className="download-os-tag">Ready</span>
              </button>

              <button
                type="button"
                className={`download-os-tab ${selectedOS === 'macos' ? 'download-os-tab--active' : ''}`}
                onClick={() => setSelectedOS('macos')}
                role="tab"
                aria-selected={selectedOS === 'macos'}
              >
                {/* Apple Icon */}
                <svg viewBox="0 0 170 170" width="16" height="16" fill="currentColor">
                  <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.71-11.65-14.01-6.74-10.43-11.85-22.39-15.34-35.88-3.48-13.48-5.22-25.96-5.22-37.43 0-14.13 3.69-25.86 11.07-35.18 7.39-9.32 16.52-14.11 27.41-14.36 4.35 0 9.4 1.11 15.16 3.35 5.76 2.23 9.49 3.4 11.21 3.49 2.07-.1 5.92-1.3 11.53-3.6 5.61-2.3 10.45-3.32 14.52-3.07 14.13.75 25.04 6.13 32.74 16.14-12.63 7.64-18.73 17.9-18.3 30.79.33 10.15 4.3 18.59 11.9 25.32 7.61 6.74 16.52 10.55 26.74 11.43-2.18 6.53-4.79 13.06-7.83 19.59zM119.22 31.84c0-7.39 2.66-14.34 7.98-20.85 5.33-6.52 11.96-10.55 19.9-12.1-1.09 7.82-3.97 14.88-8.66 21.19-4.69 6.3-10.87 10.36-18.54 12.17-.11-.13-.35-.22-.68-.41z" />
                </svg>
                <span>macOS</span>
                <span className="download-os-tag">Source only</span>
              </button>

              <button
                type="button"
                className={`download-os-tab ${selectedOS === 'linux' ? 'download-os-tab--active' : ''}`}
                onClick={() => setSelectedOS('linux')}
                role="tab"
                aria-selected={selectedOS === 'linux'}
              >
                {/* Linux Tux Icon */}
                <svg viewBox="0 0 341.333 341.333" width="16" height="16" fill="currentColor">
                  <path d="M285.5 174.6c-4.4-4.8-13.2-12.6-26.6-8.9-8.4-19.3-21.7-34.9-39.7-46.7 1.6-11.2 2.2-22.3 1.8-33.1-.9-25.2-12.6-47.5-31.3-59.8-11.8-7.7-25-11.9-37.5-12.1-1.4 0-2.8 0-4.2.1-12.5.3-25.7 4.5-37.5 12.2-18.7 12.3-30.4 34.6-31.3 59.8-.4 10.8.2 21.9 1.8 33.1-18 11.8-31.3 27.4-39.7 46.7-13.4-3.7-22.2 4.1-26.6 8.9-6.3 6.9-8.3 16.7-5.5 26.2 3.8 12.9 14.5 26.8 28.5 37.1 2.2 22.8 11.3 43.8 26.1 60.9 2 2.3 4.2 4.6 6.5 6.7 5.7 5.1 11.8 9.5 18.2 13.1-10.2 4.1-19.4 9.4-27.1 15.6-5 4-8.8 8.6-11.3 13.6-2.5 5.1-2.9 10.6-1.1 16.4 1.8 5.8 5.6 11.1 11.1 15.8 9.8 8.3 24.3 14.6 42 18.3 18 3.7 39.5 5.3 62.1 4.7 22.7.6 44.2-1 62.1-4.7 17.7-3.7 32.2-10 42-18.3 5.5-4.7 9.3-10 11.1-15.8 1.8-5.8 1.4-11.3-1.1-16.4-2.5-5-6.3-9.6-11.3-13.6-7.7-6.2-16.9-11.5-27.1-15.6 6.4-3.6 12.5-8 18.2-13.1 2.3-2.1 4.5-4.4 6.5-6.7 14.8-17.1 23.9-38.1 26.1-60.9 14-10.3 24.7-24.2 28.5-37.1 2.9-9.5.9-19.3-5.4-26.2z"/>
                </svg>
                <span>Linux</span>
                <span className="download-os-tag">Source only</span>
              </button>
            </div>
          </div>

          {/* Dual Edition Cards */}
          <div className="download-editions-grid">
            {/* Edition 1: HELIX Normal */}
            <article className="download-card download-card--normal">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--normal">RECOMMENDED</span>
                  <span className="download-version-pill">
                    {installerVersion ? `v${installerVersion}` : versionError ? 'Unavailable' : 'Loading…'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Normal</h2>
                <p className="download-card__desc">
                  Electron desktop shell with Windows integration and the HELIX Python agent.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARCHITECTURE</span>
                  <span className="download-spec-val">Electron + Node.js + Python Core</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">RAM FOOTPRINT</span>
                  <span className="download-spec-val">Not benchmarked across configurations</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALLER</span>
                  <span className="download-spec-val">Windows x64 · see release for current size</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>System Tray with status control and global shortcuts</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>On-demand screen vision and AI-assisted OCR</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Optional microphone input for voice, subject to device and OS permissions</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Separate Electron update channel</span>
                </li>
              </ul>

              <div className="download-card__actions">
                {selectedOS === 'windows' ? (
                  <>
                    <InstallerDownloadButton className="download-action-btn download-action-btn--primary">
                      Download HELIX Normal (.exe)
                    </InstallerDownloadButton>
                    <span className="download-note">
                      Windows 10 / 11 (64-bit) · Requires login to verify license.
                    </span>
                  </>
                ) : selectedOS === 'macos' ? (
                  <span className="download-note">
                    No macOS desktop installer is published. You can run the interactive CLI via <code>npx helix-assistant-cli</code> or build from source.
                    {' '}
                    <a href="https://github.com/joelpizza0818-blip/Helix-Assitant" target="_blank" rel="noreferrer">View source</a>
                  </span>
                ) : (
                  <span className="download-note">
                    No Linux desktop installer is published. You can run the interactive CLI via <code>npx helix-assistant-cli</code> or build from source.
                    {' '}
                    <a href="https://github.com/joelpizza0818-blip/Helix-Assitant" target="_blank" rel="noreferrer">View source</a>
                  </span>
                )}
              </div>
            </article>

            {/* Edition 2: HELIX Lite */}
            <article className="download-card download-card--lite">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--lite">TAURI · RUST DESKTOP SHELL</span>
                  <span className="download-version-pill">
                    {liteRelease ? `v${liteRelease.version}` : liteReleaseError ? 'Unavailable' : 'Loading…'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Lite</h2>
                <p className="download-card__desc">
                  Tauri and Rust desktop shell sharing the HELIX Python agent. Performance has not been benchmarked across supported configurations.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARCHITECTURE</span>
                  <span className="download-spec-val">Tauri v2 + Rust + WebView2 + Python agent</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">RAM FOOTPRINT</span>
                  <span className="download-spec-val">Not benchmarked across configurations</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALLER</span>
                  <span className="download-spec-val">Windows x64 · see release for current size</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Tauri desktop shell using WebView2</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Tauri desktop shell with a shared local Python agent</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Shared agent with configurable AI providers; successful responses require a working provider or local endpoint</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--orange" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Immediate download with no prior account registration</span>
                </li>
              </ul>

              <div className="download-card__actions">
                {selectedOS === 'windows' ? (
                  liteRelease ? (
                    <>
                      <a
                        className="download-action-btn download-action-btn--lite"
                        href={liteRelease.installerUrl}
                        onClick={handleLiteDownloadClick}
                        rel="noreferrer"
                      >
                        Download HELIX Lite (.exe) v{liteRelease.version}
                      </a>
                      <a
                        className="download-checksum-link"
                        href={liteRelease.releaseUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View release and SHA-256 checksum on GitHub
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="7 7 17 7 17 17" />
                        </svg>
                      </a>
                      <PrivacyModal
                        isOpen={litePrivacyOpen}
                        targetEdition="Lite"
                        onClose={() => setLitePrivacyOpen(false)}
                        onConfirm={() => {
                          window.location.assign(liteRelease.installerUrl);
                        }}
                      />
                    </>
                  ) : (
                    <span className="download-note">
                      {liteReleaseError ? 'Lite download temporarily unavailable.' : 'Fetching latest HELIX Lite version…'}
                    </span>
                  )
                ) : selectedOS === 'macos' ? (
                  <>
                    <span className="download-note">
                      No macOS installer published
                      {' '}HELIX Lite is currently released for Windows x64 only.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="download-note">
                      No Linux installer published
                      {' '}HELIX Lite is currently released for Windows x64 only.
                    </span>
                  </>
                )}
              </div>
            </article>
          </div>

          {selectedOS !== 'windows' && (
            <section className="download-public-catalog" aria-live="polite">
              <span className="download-section-eyebrow">ADMIN-SELECTED PUBLIC INSTALLERS</span>
              <h3>{selectedOS === 'macos' ? 'macOS' : 'Linux'} installer versions</h3>
              {catalogError ? (
                <p className="download-note" role="alert">{catalogError}</p>
              ) : catalogInstallers.filter((item) => item.platform === selectedOS && item.edition !== 'mobile').length === 0 ? (
                <p className="download-note">No installer version has been selected for public distribution on this system.</p>
              ) : (
                <div className="download-public-catalog__grid">
                  {catalogInstallers
                    .filter((item) => item.platform === selectedOS && item.edition !== 'mobile')
                    .map((item) => (
                      <article className="download-public-catalog__item" key={item.id}>
                        <div>
                          <span>{item.edition.toUpperCase()}</span>
                          <h4>HELIX {item.edition === 'lite' ? 'Lite' : 'Normal'} v{item.version}</h4>
                        </div>
                        <div className="download-public-catalog__links">
                          {item.installerUrl && <a href={item.installerUrl}>Download installer</a>}
                          {item.checksumUrl && <a href={item.checksumUrl} target="_blank" rel="noreferrer">SHA-256</a>}
                          <a href={item.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
                        </div>
                      </article>
                    ))}
                </div>
              )}
            </section>
          )}

          <section className="download-mobile-section" aria-labelledby="download-mobile-title">
            <div className="download-source-header">
              <span className="download-section-eyebrow">HELIX MOBILE · ANDROID &amp; IOS</span>
              <h3 id="download-mobile-title">Connect to your HELIX desktop from your phone</h3>
              <p>The Flutter mobile client connects to a running HELIX desktop through an authenticated relay or SSH tunnel.</p>
            </div>
            <div className="download-mobile-card">
              <div className="download-mobile-meta">
                <span className="download-mobile-badge">
                  {mobileRelease
                    ? `ANDROID RELEASE · v${mobileRelease.version}`
                    : mobileReleaseError
                    ? 'ANDROID PACKAGE UNAVAILABLE'
                    : 'CHECKING ANDROID RELEASE'}
                </span>
              </div>
              <div className="download-mobile-row">
                <div>
                  <h4>HELIX Mobile</h4>
                  <p>
                    {mobileRelease
                      ? 'The latest stable Android package is available. Review its release notes and SHA-256 checksum before installing.'
                      : mobileReleaseError
                      ? 'No stable Android release with an installer and checksum is available.'
                      : 'Checking for the latest stable Android release.'}
                  </p>
                </div>
                {mobileRelease ? (
                  <div className="download-mobile-actions">
                    <a className="download-action-btn download-action-btn--primary" href={mobileRelease.installerUrl}>
                      {mobileRelease.architecture === 'arm64' ? 'Download ARM64 APK (recommended)' : 'Download Android APK'}
                    </a>
                    {mobileRelease.universalInstallerUrl && (
                      <a className="download-checksum-link" href={mobileRelease.universalInstallerUrl}>
                        Download universal APK (all Android architectures)
                      </a>
                    )}
                    {mobileRelease.universalChecksumUrl && (
                      <a className="download-checksum-link" href={mobileRelease.universalChecksumUrl} target="_blank" rel="noreferrer">
                        Universal APK SHA-256 checksum
                      </a>
                    )}
                    <a className="download-checksum-link" href={mobileRelease.checksumUrl} target="_blank" rel="noreferrer">
                      SHA-256 checksum
                    </a>
                    <a className="download-checksum-link" href={mobileRelease.releaseUrl} target="_blank" rel="noreferrer">
                      Release notes on GitHub
                    </a>
                  </div>
                ) : (
                  <span className="download-note" role="status">
                    {mobileReleaseError ? 'Not selected for public release' : 'Checking availability…'}
                  </span>
                )}
              </div>
              <MobileReleaseHistory
                platform="android"
                releases={mobileReleaseHistory}
                currentVersion={mobileRelease?.version}
                error={historyError}
              />
            </div>
            <div className="download-mobile-card">
                <div className="download-mobile-meta">
                  <span className="download-mobile-badge">
                    {iosRelease
                      ? `IOS RELEASE · v${iosRelease.version}`
                      : iosReleaseError
                      ? 'IOS PACKAGE NOT SELECTED'
                      : 'CHECKING IOS RELEASE'}
                  </span>
                </div>
                <div className="download-mobile-row">
                  <div>
                    <h4>HELIX Mobile for iOS</h4>
                    <p>
                      {iosRelease
                        ? 'The latest stable iOS build is available. Review its release notes and SHA-256 checksum before installing.'
                        : iosReleaseError
                        ? 'No stable iOS release with an installer and checksum is available.'
                        : 'Checking for the latest stable iOS release.'}
                    </p>
                  </div>
                  {iosRelease ? (
                    <div className="download-mobile-actions">
                      <a className="download-action-btn download-action-btn--primary" href={iosRelease.installerUrl}>
                        Download iOS build
                      </a>
                      <a className="download-checksum-link" href={iosRelease.checksumUrl} target="_blank" rel="noreferrer">
                        SHA-256 checksum
                      </a>
                      <a className="download-checksum-link" href={iosRelease.releaseUrl} target="_blank" rel="noreferrer">
                        Release notes
                      </a>
                    </div>
                  ) : (
                    <span className="download-note" role="status">
                      {iosReleaseError ? 'Not selected for public release' : 'Checking availability…'}
                    </span>
                  )}
                </div>
                <MobileReleaseHistory
                  platform="ios"
                  releases={mobileReleaseHistory}
                  currentVersion={iosRelease?.version}
                  error={historyError}
                />
              </div>
          </section>

          {/* HELIX CLI Quickstart */}
          <section className="download-source-section" style={{ marginTop: '3rem' }}>
            <div className="download-source-header">
              <span className="download-section-eyebrow">DEVELOPER CLI · NPM PACKAGE</span>
              <h3>Try HELIX CLI instantly with npx</h3>
              <p>The CLI is published on npm as <code>helix-assistant-cli</code>. No install needed — run it directly with npx:</p>
            </div>

            <div className="download-terminal-card">
              <div className="download-terminal-bar">
                <span className="download-terminal-dots">
                  <i /><i /><i />
                </span>
                <span className="download-terminal-title">Terminal / Command Prompt / PowerShell</span>
                <button
                  type="button"
                  className="download-copy-btn"
                  onClick={handleCopyCli}
                  aria-label="Copy CLI command"
                >
                  {cliCopied ? 'Copied!' : 'Copy npx command'}
                </button>
              </div>
              <pre className="download-code-block">
                <code>{`# Run directly without installing (requires Node.js 18+)
npx helix-assistant-cli

# Or install globally
npm install -g helix-assistant-cli
helix`}</code>
              </pre>
            </div>
          </section>

          {/* Quickstart from Source Terminal */}
          <section className="download-source-section">
            <div className="download-source-header">
              <span className="download-section-eyebrow">OPEN SOURCE</span>
              <h3>Build the Windows desktop app from source</h3>
              <p>Desktop development and installer workflows currently target Windows x64:</p>
            </div>

            <div className="download-terminal-card">
              <div className="download-terminal-bar">
                <span className="download-terminal-dots">
                  <i /><i /><i />
                </span>
                <span className="download-terminal-title">PowerShell (Administrator)</span>
              </div>
              <pre className="download-code-block">
                <code>{`# 1. Clone the repository
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
cd Helix-Assitant

# 2. Run the automated setup script for Windows
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

# 3. Configure environment variables and API keys
copy .env.example .env

# 4. Start the Desktop Shell and Python Agent
npm run dev:desktop`}</code>
              </pre>
            </div>
          </section>

          {/* System & Architecture Notes */}
          <section className="download-notes-section">
            <span className="download-section-eyebrow">ARCHITECTURE & SECURITY</span>
            <h3 className="download-notes-title">Local Operation Guidelines</h3>

            <div className="download-notes-grid">
              <div className="download-info-card">
                <h4>Local Key Storage</h4>
                <p>
                  Provider credentials are stored through the local OS credential store or supplied through the agent environment. HELIX sends requests to the provider you configure; do not enter credentials you do not trust.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Visual Capture & Perception</h4>
                <p>
                  Screen context is opt-in/on-demand; voice and camera features have separate settings. When used with a remote AI provider, the requested content may be sent to that provider.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Start with the Operating System</h4>
                <p>
                  You can enable or disable automatic startup from the settings panel, using a standard entry in <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code>.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Modern Footer */}
      <footer className="download-footer">
        <div className="download-footer__inner">
          <p>© {new Date().getFullYear()} HELIX Project. Desktop installers are currently published for Windows x64.</p>
          <div className="download-footer__links">
            <Link to="/">Home</Link>
            <Link to="/features">What's New</Link>
            <Link to="/docs">Documentation</Link>
            <Link to="/privacy">Privacy</Link>
            <a href="#top">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

function MobileReleaseHistory({
  platform,
  releases,
  currentVersion,
  error,
}: {
  platform: 'android' | 'ios'
  releases: LandingInstaller[]
  currentVersion?: string
  error: string | null
}) {
  const history = releases.filter((release) => (
    release.platform === platform
    && release.edition === 'mobile'
    && release.version !== currentVersion
    && release.installerUrl
    && release.checksumUrl
  ))
  const platformName = platform === 'android' ? 'Android' : 'iOS'

  if (error) return <p className="download-mobile-history-error" role="alert">{error}</p>
  if (history.length === 0) return null

  return (
    <div className="download-mobile-history">
      <h5>Previous {platformName} versions</h5>
      <ul>
        {history.map((release) => (
          <li key={release.id}>
            <span>HELIX Mobile v{release.version}</span>
            <div>
              <a href={release.installerUrl ?? undefined}>Download</a>
              <a href={release.checksumUrl ?? undefined} target="_blank" rel="noreferrer">SHA-256</a>
              <a href={release.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
