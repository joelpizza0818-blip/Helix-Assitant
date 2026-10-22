import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './FeaturesPage.css';

interface Release {
  version: string;
  tag?: string;
  date: string;
  title: string;
  editions: ('Normal' | 'Lite' | 'CLI')[];
  changes: string[];
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
    version: '0.2.5',
    tag: 'LATEST CONFIRMED RELEASE',
    date: 'October 2026',
    title: 'HELIX v0.2.5 — Seguridad Robusta, Aislamiento & UX Mejorada',
    editions: ['Normal', 'Lite', 'CLI'],
    changes: [
      'Blindaje de seguridad en ejecución de comandos con aislamiento de subprocesos y sandboxes en Toolbox.',
      'Protección estricta contra inyección HTML, XSS y timing attacks en difusión de actualizaciones del servidor.',
      'Modularización de componentes del agente y desacoplamiento de dependencias de runtime.',
      'Buscador interactivo en tiempo real de ajustes y categorización visual en Toolbox.',
      'Efectos de sonido hápticos con Web Audio API sintetizado para acciones del sistema.',
      'Renderizador Markdown limpio en CLI con soporte de modo --plain y estabilización multi-SO en CI/CD.',
    ],
  },
  {
    version: '0.2.4',
    date: 'October 2026',
    title: 'HELIX v0.2.4 — Percepción & Admin Logs',
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
    tag: 'LATEST CONFIRMED LITE RELEASE',
    date: 'October 2026',
    title: 'HELIX Lite v0.2.2 (Tauri)',
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
  const [releases, setReleases] = useState<Release[]>(DEFAULT_RELEASES);
  const [progress, setProgress] = useState(0);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [notifyMessage, setNotifyMessage] = useState('');

  useEffect(() => {
    let active = true;
    const fetchLatestReleases = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/joelpizza0818-blip/Helix-Assitant/releases?per_page=8');
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const dynamicReleases: Release[] = data
          .filter((item: any) => !item.draft && item.tag_name && item.tag_name !== 'capability-packs')
          .map((item: any, idx: number) => {
            const isLite = item.tag_name.startsWith('lite-');
            const isCli =
              (item.name || '').toLowerCase().includes('cli') ||
              (item.body || '').toLowerCase().includes('cli');
            const version = item.tag_name.replace(/^(v|lite-v)/, '');
            const date = item.published_at
              ? new Date(item.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : 'October 2026';

            const editions: ('Normal' | 'Lite' | 'CLI')[] = isLite
              ? ['Lite']
              : isCli
              ? ['Normal', 'CLI']
              : ['Normal'];

            const tag = idx === 0
              ? (isLite ? 'LATEST CONFIRMED LITE RELEASE' : 'LATEST CONFIRMED RELEASE')
              : isLite
              ? 'LITE CHANNEL'
              : undefined;

            return {
              version,
              tag,
              date,
              title: item.name || `HELIX ${item.tag_name}`,
              editions,
              changes: cleanMarkdownChanges(item.body),
            };
          });

        if (active && dynamicReleases.length > 0) {
          setReleases(dynamicReleases.slice(0, 5));
        }
      } catch (e) {
        // Fall back gracefully to DEFAULT_RELEASES
      }
    };

    fetchLatestReleases();
    return () => {
      active = false;
    };
  }, []);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyEmail) return;
    setNotifyStatus('loading');
    setNotifyMessage('');
    try {
      const res = await fetch('/api/updates/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: notifyEmail }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotifyStatus('success');
        setNotifyMessage('Email submitted to the release-update service.');
        setNotifyEmail('');
      } else {
        setNotifyStatus('error');
        setNotifyMessage(data.error || 'Could not register the subscription.');
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
      <header className="features-header">
        <Link to="/" className="features-header__brand" aria-label="Back to HELIX">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="features-header__links">
          <Link to="/" className="features-header__link">Home</Link>
          <Link to="/docs" className="features-header__link">Documentation</Link>
          <Link to="/privacy" className="features-header__link">Privacy</Link>
          <Link to="/download" className="features-header__cta">Download</Link>
        </div>
      </header>

      <div
        className="features-scroll-wrapper"
        ref={containerRef}
        style={{ height: `${Math.max(260, releases.length * 85)}vh` }}
      >
        <div className="features-stage">
          <div className="features-intro">
            <span className="features-eyebrow">VERSION HISTORY & PATCHES</span>
            <h1>What's New in HELIX</h1>
            <p>
              Browse the latest confirmed published release for each desktop edition.
            </p>
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
                        Version {index + 1} of {totalCards}
                      </span>
                      <Link to="/download" className="features-card-download">
                        Install v{release.version}
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </Link>
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
