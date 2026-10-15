import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import { InstallerDownloadButton } from '../components/Download/InstallerDownloadButton';
import { PrivacyModal } from '../components/PrivacyModal/PrivacyModal';
import { getLatestInstallerVersion, getLatestLiteRelease, type LiteReleaseDownload } from '../lib/downloads';
import { useAuth } from '../hooks/useAuth';
import './DownloadPage.css';

export const DownloadPage: React.FC = () => {
  const { user } = useAuth();
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [liteRelease, setLiteRelease] = useState<LiteReleaseDownload | null>(null);
  const [liteReleaseError, setLiteReleaseError] = useState(false);
  const [litePrivacyOpen, setLitePrivacyOpen] = useState(false);

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
      {/* Modern Header */}
      <header className="download-header">
        <Link to="/" className="download-header__brand" aria-label="Volver al inicio de HELIX">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="download-header__links">
          <Link to="/" className="download-header__link">Inicio</Link>
          <Link to="/features" className="download-header__link">Novedades</Link>
          <Link to="/docs" className="download-header__link">Documentación</Link>
          <Link to="/privacy" className="download-header__link">Privacidad</Link>
          {user ? (
            <span className="download-header__user">{user.email?.split('@')[0]}</span>
          ) : (
            <Link to="/login" className="download-header__link">Iniciar Sesión</Link>
          )}
          <Link to="/download" className="download-header__cta">Descargar</Link>
        </div>
      </header>

      <main className="download-main">
        <div className="download-container">
          {/* Hero */}
          <div className="download-hero">
            <span className="download-eyebrow">DISTRIBUCIÓN OFICIAL · WINDOWS 10 / 11 (64-BIT)</span>
            <h1 className="download-title">Descarga HELIX para tu Escritorio</h1>
            <p className="download-lead">
              Elige entre la versión completa de escritorio con Electron o la versión ultra-liviana con Tauri. Ambas comparten el mismo núcleo local del agente, enrutador de modelos de IA y arquitectura Zero-Trust.
            </p>
          </div>

          {/* Dual Edition Cards */}
          <div className="download-editions-grid">
            {/* Edition 1: HELIX Normal */}
            <article className="download-card download-card--normal">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--normal">RECOMENDADO</span>
                  <span className="download-version-pill">
                    v{installerVersion || '0.2.0'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Normal</h2>
                <p className="download-card__desc">
                  Shell completo de escritorio en Electron con integración profunda en el sistema operativo Windows y soporte integral de herramientas.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARQUITECTURA</span>
                  <span className="download-spec-val">Electron + Node.js + Python Core</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">HUELLA RAM</span>
                  <span className="download-spec-val">~180 MB en reposo</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALADOR</span>
                  <span className="download-spec-val">~120 MB (Verificado)</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Bandeja del sistema (System Tray) con control de estado y atajos globales</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Visión de pantalla y OCR asistido por IA bajo demanda</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Interacción de audio y voz continua con SoundDevice</span>
                </li>
                <li>
                  <svg className="download-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Canal de actualización integrado y sincronización en la nube</span>
                </li>
              </ul>

              <div className="download-card__actions">
                <InstallerDownloadButton className="download-action-btn download-action-btn--primary">
                  Descargar HELIX Normal para Windows
                </InstallerDownloadButton>
                <span className="download-note">
                  Requiere inicio de sesión para verificar la licencia y vincular credenciales.
                </span>
              </div>
            </article>

            {/* Edition 2: HELIX Lite */}
            <article className="download-card download-card--lite">
              <div className="download-card__header">
                <div className="download-card__badge-row">
                  <span className="download-badge download-badge--lite">ULTRA-LIVIANO · RUST</span>
                  <span className="download-version-pill">
                    v{liteRelease ? liteRelease.version : '0.2.0'}
                  </span>
                </div>
                <h2 className="download-card__title">HELIX Lite</h2>
                <p className="download-card__desc">
                  Shell ultra-ligero desarrollado con Tauri y compilado en Rust. Máximo rendimiento con consumo mínimo de recursos.
                </p>
              </div>

              <div className="download-specs">
                <div className="download-spec-item">
                  <span className="download-spec-label">ARQUITECTURA</span>
                  <span className="download-spec-val">Tauri v2 + Rust + WebView2 + Python Core</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">HUELLA RAM</span>
                  <span className="download-spec-val">~40 MB en reposo</span>
                </div>
                <div className="download-spec-item">
                  <span className="download-spec-label">INSTALADOR</span>
                  <span className="download-spec-val">~15 MB (Descarga rápida)</span>
                </div>
              </div>

              <ul className="download-features-list">
                <li>
                  <svg className="download-check-icon download-check-icon--cyan" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Instalador autónomo de ~15MB sin sobrecarga de Chromium embebido</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--cyan" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Arranque instantáneo y consumo de memoria 75% menor</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--cyan" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Mismo núcleo inteligente con enrutador de modelos (Gemini, Claude, GPT, Ollama)</span>
                </li>
                <li>
                  <svg className="download-check-icon download-check-icon--cyan" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Descarga inmediata sin registro de cuenta previo</span>
                </li>
              </ul>

              <div className="download-card__actions">
                {liteRelease ? (
                  <>
                    <a
                      className="download-action-btn download-action-btn--lite"
                      href={liteRelease.installerUrl}
                      onClick={handleLiteDownloadClick}
                      rel="noreferrer"
                    >
                      Descargar HELIX Lite v{liteRelease.version}
                    </a>
                    <a
                      className="download-checksum-link"
                      href={liteRelease.releaseUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Ver release y suma SHA-256 en GitHub
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
                    {liteReleaseError ? 'Descarga de Lite temporalmente no disponible.' : 'Consultando última versión de HELIX Lite…'}
                  </span>
                )}
              </div>
            </article>
          </div>

          {/* Quickstart from Source Terminal */}
          <section className="download-source-section">
            <div className="download-source-header">
              <span className="download-section-eyebrow">CÓDIGO ABIERTO</span>
              <h3>Compilación directa desde el código fuente</h3>
              <p>Si prefieres compilar y ejecutar HELIX directamente en tu entorno de desarrollo:</p>
            </div>

            <div className="download-terminal-card">
              <div className="download-terminal-bar">
                <span className="download-terminal-dots">
                  <i /><i /><i />
                </span>
                <span className="download-terminal-title">PowerShell (Administrador)</span>
              </div>
              <pre className="download-code-block">
                <code>{`# 1. Clonar el repositorio
git clone https://github.com/joelpizza0818-blip/Helix-Assitant.git
cd Helix-Assitant

# 2. Ejecutar script automatizado de configuración para Windows
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

# 3. Configurar variables de entorno y claves de API
copy .env.example .env

# 4. Iniciar Shell de Escritorio y Agente Python
npm run dev:desktop`}</code>
              </pre>
            </div>
          </section>

          {/* System & Architecture Notes */}
          <section className="download-notes-section">
            <span className="download-section-eyebrow">ARQUITECTURA & SEGURIDAD</span>
            <h3 className="download-notes-title">Directrices de Operación Local</h3>

            <div className="download-notes-grid">
              <div className="download-info-card">
                <h4>Almacenamiento Local de Claves</h4>
                <p>
                  Tus claves de API (Google Gemini, OpenAI, Claude o local Ollama) nunca se envían a servidores de HELIX. Se guardan en <code>Windows Credential Manager</code> o en tu archivo local <code>.env</code>.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Captura Visual & Percepción</h4>
                <p>
                  HELIX analiza la pantalla exclusivamente bajo demanda cuando lo solicitas en el chat. Los fotogramas se procesan en memoria volátil y se descartan de inmediato.
                </p>
              </div>

              <div className="download-info-card">
                <h4>Inicio con el Sistema Operativo</h4>
                <p>
                  Puedes activar o desactivar el inicio automático desde el panel de configuración, mediante una entrada estándar en <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code>.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Modern Footer */}
      <footer className="download-footer">
        <div className="download-footer__inner">
          <p>© {new Date().getFullYear()} Proyecto HELIX. Diseñado para ejecutarse localmente con confianza cero.</p>
          <div className="download-footer__links">
            <Link to="/">Inicio</Link>
            <Link to="/features">Novedades</Link>
            <Link to="/docs">Documentación</Link>
            <Link to="/privacy">Privacidad</Link>
            <a href="#top">Subir ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
