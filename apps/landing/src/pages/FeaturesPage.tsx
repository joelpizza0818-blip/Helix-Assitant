import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveSiteNavigation } from '../components/ResponsiveSiteNavigation';
import { fetchPublicInstallers, type InstallerPlatform, type LandingInstaller } from '../lib/landingContent';
import './FeaturesPage.css';

const configuredApiUrl = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
const apiBaseUrl = configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const releaseSubscriptionUrl = (import.meta.env.VITE_RELEASE_SUBSCRIPTION_URL ?? '').trim().replace(/\/+$/, '');

interface Release {
  version: string;
  tag?: string;
  date: string;
  title: string;
  summary: string;
  editions: ('Normal' | 'Lite' | 'CLI' | 'Mobile')[];
  changes: string[];
  platform?: InstallerPlatform;
  installerUrl?: string;
  checksumUrl?: string;
  releaseUrl?: string;
}

function platformLabel(platform: InstallerPlatform): string {
  return { windows: 'Windows', linux: 'Linux', macos: 'macOS', android: 'Android', ios: 'iOS' }[platform]
}

function releaseFromInstaller(installer: LandingInstaller): Release {
  const edition = { normal: 'Normal', lite: 'Lite', mobile: 'Mobile' }[installer.edition] as Release['editions'][number]
  return {
    version: installer.version,
    tag: 'ADMIN-SELECTED PUBLIC RELEASE',
    date: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
      .format(new Date(installer.publishedAt ?? installer.createdAt)),
    title: `HELIX ${edition} ${installer.version} · ${platformLabel(installer.platform)}`,
    summary: `This is the ${edition} installer currently selected for public distribution on ${platformLabel(installer.platform)}.`,
    editions: [edition],
    changes: [
      `Installer selected for ${platformLabel(installer.platform)}.`,
      'A SHA-256 checksum is provided with this release.',
    ],
    platform: installer.platform,
    installerUrl: installer.installerUrl ?? undefined,
    checksumUrl: installer.checksumUrl ?? undefined,
    releaseUrl: installer.releaseUrl,
  }
}

function cleanMarkdownSummary(body: string): string {
  if (!body) return 'Actualización publicada con mejoras funcionales y de estabilidad.';

  const summary = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20)
    .slice(0, 3)
    .join(' ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!summary) return 'Actualización publicada con mejoras funcionales y de estabilidad.';
  return summary.length > 180 ? `${summary.slice(0, 177).trimEnd()}…` : summary;
}

function cleanMarkdownChanges(body: string): string[] {
  if (!body) return ['Actualización publicada con mejoras de rendimiento y estabilidad general.'];
  const lines = body.split('\n');
  const bulletLines = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .map((l) =>
      l
        .replace(/^[-*]\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .trim()
    )
    .filter((l) => l.length > 5);

  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 6);
  }
  return [body.trim().slice(0, 160)];
}

const DEFAULT_RELEASES: Release[] = [
  {
    version: '0.2.13',
    tag: 'LATEST CONFIRMED RELEASE',
    date: 'October 2026',
    title: 'HELIX v0.2.13 — Estabilidad del agente y transporte MCP',
    summary: 'La release Normal corrige el transporte de mensajes MCP con caracteres no ASCII y mejora el arranque del agente Python. Su instalador Windows x64 y checksum se verificaron en GitHub Releases.',
    editions: ['Normal'],
    changes: [
      'Corrección del manejo de caracteres no ASCII en respuestas JSON de MCP.',
      'Mejoras en el arranque del agente Python y en la configuración de dependencias.',
      'Instalador Windows x64 publicado con checksum SHA-256 verificado.',
      'La publicación del canal Lite y del paquete CLI debe verificarse de forma independiente.',
    ],
  },
  {
    version: '0.2.12',
    date: 'October 2026',
    title: 'HELIX v0.2.12 — Proveedores y releases separados',
    summary: 'Se corrigió la conversión de nombres de herramientas para Google y se mejoró la clasificación de errores de cuota, facturación y disponibilidad.',
    editions: ['Normal', 'Lite', 'CLI'],
    changes: [
      'Normal y Lite cuentan con releases externas verificadas.',
      'helix-assistant-cli@0.2.12 quedó publicado como latest en npm.',
      'La conversación real con Google recibió 429 por cuota agotada; no se presenta como una prueba exitosa del proveedor.',
    ],
  },
  {
    version: '0.2.4',
    date: 'October 2026',
    title: 'HELIX v0.2.4 — Percepción & Admin Logs',
    summary: 'Se incorporaron los modelos locales de voz y gestos al runtime empaquetado y se añadieron registros administrativos en desktop.',
    editions: ['Normal', 'Lite', 'CLI'],
    changes: [
      'Empaquetado integral y resolución dinámica de modelos de IA (MediaPipe HandLandmarker y OpenWakeWord).',
      'Nuevo subsistema de Registros del Sistema (Admin Logs) con consola interactiva en tiempo real para administradores.',
      'Buffer circular de 2000 líneas en Electron y persistencia rotativa a agent.log y helix.log.',
      'Blindaje de codificación y compatibilidad multiplataforma en terminales para helix-assistant-cli (PowerShell, CMD, Bash).',
      'Corrección de permisos multimedia en Electron para entornos empaquetados Windows (orígenes Chromium locales).',
    ],
  },
  {
    version: '0.2.2',
    tag: 'LITE CHANNEL HISTORY',
    date: 'October 2026',
    title: 'HELIX Lite v0.2.2 (Tauri)',
    summary: 'Release del canal Lite para Windows x64 con verificación de integridad y degradación ante sesiones remotas sin hardware disponible.',
    editions: ['Lite'],
    changes: [
      'Canal de release independiente para instalador Windows x64 NSIS con arquitectura Rust/Tauri ultraligera.',
      'Degradación elegante ante sesiones remotas de Windows (RDP/ICA) en motores de visión y voz.',
      'Verificación de integridad con distribución de sumas de comprobación SHA-256 oficiales.',
    ],
  },
  {
    version: '0.2.1',
    tag: 'CLI & HARDWARE STABILITY',
    date: 'October 2026',
    title: 'HELIX CLI & Perception Fixes',
    summary: 'Correcciones del ciclo de captura de cámara, limpieza de tareas de audio y lanzamiento del CLI como paquete npm.',
    editions: ['Normal', 'CLI'],
    changes: [
      'Lanzamiento oficial del CLI en npm como helix-assistant-cli con ejecución directa npx.',
      'Corrección del ciclo de captura de cámara para evitar contención de referencias de frames RGB.',
      'Limpieza y cancelación preventiva de tareas de audio ante fallos en suscripción de micrófono.',
    ],
  },
];

export function FeaturesPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [notifyMessage, setNotifyMessage] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetchPublicInstallers(controller.signal)
      .then((installers) => {
        if (active) setReleases(installers.map(releaseFromInstaller));
      })
      .catch((loadError: unknown) => {
        if (active && !controller.signal.aborted) {
          setReleaseError(loadError instanceof Error ? loadError.message : 'Could not load published releases.')
        }
      })
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyEmail) return;
    setNotifyStatus('loading');
    setNotifyMessage('');
    try {
      const endpoint = releaseSubscriptionUrl || (apiBaseUrl ? `${apiBaseUrl}/api/updates/subscribe` : '/api/updates/subscribe');
      if (!endpoint) {
        throw new Error('Release update service is not configured for this deployment.');
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: notifyEmail }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json') ? await res.json() : null;
      if (res.ok && data?.success) {
        setNotifyStatus('success');
        setNotifyMessage('Email submitted to the release-update service.');
        setNotifyEmail('');
      } else {
        setNotifyStatus('error');
        setNotifyMessage(data?.error || 'Could not register the subscription.');
      }
    } catch (error: unknown) {
      console.error('Could not register for HELIX release updates.', error);
      setNotifyStatus('error');
      setNotifyMessage('Could not reach the subscription service. Please try again later.');
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const verticalTravel = Math.max(1, container.offsetHeight - window.innerHeight);
      const scrolled = Math.min(verticalTravel, Math.max(0, -container.getBoundingClientRect().top));
      setProgress(scrolled / verticalTravel);
    };

    const scheduleUpdate = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  const totalCards = releases.length;
  // Calculate relative progress for each card beyond card 0
  // Card index 0 is fixed at 0. Card index i moves up from 105% to 0% during its slice
  const stepSlice = totalCards > 1 ? 1 / (totalCards - 0.2) : 1;

  return (
    <div className="features-page" id="top">
      <ResponsiveSiteNavigation />

      <div
        className="features-scroll-wrapper"
        ref={containerRef}
        style={{
          height: releases.length ? `${Math.max(150, releases.length * 85)}vh` : 'auto',
          minHeight: releases.length ? undefined : '0',
        }}
      >
        <div className="features-stage">
          <div className="features-intro">
            <span className="features-eyebrow">VERSION HISTORY & PATCHES</span>
            <h1>What's New in HELIX</h1>
            <p>
              Only the versions selected for public distribution by a HELIX admin are shown here.
            </p>
            {releaseError && <p className="features-release-error" role="alert">{releaseError}</p>}
            {!releaseError && releases.length === 0 && <p className="features-release-empty">No installer versions have been selected for public distribution yet.</p>}
          </div>

          <div className="features-cards-viewport">
            {releases.map((release, index) => {
              let translateY = 0;
              if (index > 0) {
                const start = (index - 1) * stepSlice;
                const end = index * stepSlice;
                const t = Math.min(1, Math.max(0, (progress - start) / (end - start)));
                translateY = (1 - t) * 105;
              }

              return (
                <div
                  key={`${release.version}-${index}`}
                  className="features-card-layer"
                  style={{
                    zIndex: index + 1,
                    transform: `translate3d(0, ${translateY}%, 0)`,
                  }}
                >
                  <article className="features-release-card">
                    <div className="features-card-topbar">
                      <div className="features-card-tags">
                        <span className="features-version-tag">v{release.version}</span>
                        {release.tag && <span className="features-status-tag">{release.tag}</span>}
                        {release.editions.map((ed) => (
                          <span key={ed} className="features-edition-tag">
                            HELIX {ed}
                          </span>
                        ))}
                      </div>
                      <span className="features-date">{release.date}</span>
                    </div>

                    <h2 className="features-card-title">{release.title}</h2>

                    <p className="features-card-summary">{release.summary}</p>

                    <ul className="features-changes-list">
                      {release.changes.map((change, cIdx) => (
                        <li key={cIdx}>
                          <span className="features-bullet" aria-hidden="true">
                            <svg viewBox="0 0 16 16" width="6" height="6" fill="currentColor">
                              <circle cx="8" cy="8" r="6" />
                            </svg>
                          </span>
                          <span>{change}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="features-card-footer">
                      <span className="features-step-label">
                        {release.platform ? platformLabel(release.platform) : 'HELIX'} · {index + 1} of {totalCards}
                      </span>
                      <div className="features-card-actions">
                        {release.checksumUrl && <a href={release.checksumUrl} target="_blank" rel="noreferrer">SHA-256</a>}
                        {release.releaseUrl && <a href={release.releaseUrl} target="_blank" rel="noreferrer">Release</a>}
                        <Link to="/download" className="features-card-download">
                          Install v{release.version}
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                        </Link>
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>

          <div className="features-progress-bar" aria-hidden="true">
            <span>{releases[0] ? `Latest: v${releases[0].version} (${releases[0].editions.join('/')})` : 'Latest release'}</span>
            <div className="features-progress-track">
              <i style={{ width: `${Math.max(6, progress * 100)}%` }} />
            </div>
            <span>{releases.length > 1 ? `History: v${releases[releases.length - 1].version}` : 'Changelog'}</span>
          </div>
        </div>
      </div>

      {/* Version Updates Notification Subscription */}
      <section className="features-subscribe-section">
        <div className="features-subscribe-box">
          <div className="features-subscribe-copy">
            <span className="features-subscribe-eyebrow">RELEASE UPDATES</span>
            <h3>Request HELIX release updates</h3>
            <p>
              Submit your email to the release-update service. Delivery and retention depend on that service's configuration.
            </p>
          </div>
          <form className="features-subscribe-form" onSubmit={handleSubscribe}>
            <input
              type="email"
              className="features-subscribe-input"
              placeholder="your-email@developer.com"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              required
            />
            <button
              type="submit"
              className="features-subscribe-btn"
              disabled={notifyStatus === 'loading'}
            >
              {notifyStatus === 'loading' ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>
          {notifyMessage && (
            <div className={`features-subscribe-status ${notifyStatus === 'error' ? 'is-error' : 'is-success'}`}>
              {notifyMessage}
            </div>
          )}
        </div>
      </section>

      <footer className="features-footer">
        <div className="features-footer__inner">
          <p>© {new Date().getFullYear()} HELIX Project. Published release information.</p>
          <div className="features-footer__links">
            <Link to="/">Home</Link>
            <Link to="/docs">Documentation</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/download">Download</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
