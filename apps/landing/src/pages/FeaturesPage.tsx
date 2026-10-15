import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './FeaturesPage.css';

interface Release {
  version: string;
  tag?: string;
  date: string;
  title: string;
  editions: ('Normal' | 'Lite')[];
  changes: string[];
}

const RELEASES: Release[] = [
  {
    version: '0.2.0',
    tag: 'ÚLTIMA VERSIÓN',
    date: 'Octubre 2026',
    title: 'Stagger transitions, HELIX Lite & Privacy Gates',
    editions: ['Normal', 'Lite'],
    changes: [
      'Motor de scrollytelling con tarjetas apiladas fluidas (Stagger) de aceleración por hardware en aterrizaje y novedades.',
      'Soporte oficial y distribución dual de HELIX Lite (Tauri, binario ligero ~15MB y 40MB RAM) junto a HELIX Normal (Electron).',
      'Integración de modal de verificación y consentimiento de políticas de privacidad previo a la descarga de ejecutables.',
      'Nueva página oficial de Privacidad con pautas Zero-Trust para OCR de pantalla y captura de voz bajo demanda.',
      'Centro de Documentación técnica oficial y rediseño de interfaz en los portales de autenticación.',
    ],
  },
  {
    version: '0.1.10',
    date: 'Octubre 2026',
    title: 'Model Fallbacks & Fail-Safes de Capacidad',
    editions: ['Normal', 'Lite'],
    changes: [
      'Conmutación automática de modelos cuando un proveedor o clave individual falla sin perder el contexto.',
      'Autenticación reforzada del servicio local del agente con detención segura si falta una capacidad crítica.',
      'Mejoras en las herramientas de escritorio para control de ventanas y conexiones MCP.',
    ],
  },
  {
    version: '0.1.9',
    date: 'Septiembre 2026',
    title: 'Fiabilidad de Automatización en Windows',
    editions: ['Normal'],
    changes: [
      'Inclusión de módulos de automatización de Windows compilados en el entorno de Python integrado.',
      'Verificación de sumas de comprobación SHA-256 en el proceso de instalación.',
    ],
  },
  {
    version: '0.1.5',
    date: 'Agosto 2026',
    title: 'Identidad, Perfiles & Resiliencia',
    editions: ['Normal'],
    changes: [
      'Inicio de sesión seguro vinculado con GitHub OAuth sin requerir GitHub CLI instalado.',
      'Preservación de historial de conversación durante reintentos por caída de red.',
      'Panel de configuración con almacenamiento seguro en Windows Credential Manager.',
    ],
  },
  {
    version: '0.1.0',
    date: 'Julio 2026',
    title: 'Fundación del Agente de Escritorio HELIX',
    editions: ['Normal'],
    changes: [
      'Lanzamiento inicial del agente residente en bandeja de sistema (System Tray) para Windows.',
      'Enrutador inteligente de modelos de lenguaje (Gemini, Claude, GPT-4o y Ollama local).',
      'Primer motor de interacción por voz nativo con SoundDevice y OCR de pantalla.',
    ],
  },
];

export function FeaturesPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

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

  const totalCards = RELEASES.length;
  // Calculate relative progress for each card beyond card 0
  // Card index 0 is fixed at 0. Card index i moves up from 105% to 0% during its slice
  const stepSlice = 1 / (totalCards - 0.2);

  return (
    <div className="features-page" id="top">
      <header className="features-header">
        <Link to="/" className="features-header__brand" aria-label="Volver a HELIX">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="features-header__links">
          <Link to="/" className="features-header__link">Inicio</Link>
          <Link to="/docs" className="features-header__link">Documentación</Link>
          <Link to="/privacy" className="features-header__link">Privacidad</Link>
          <Link to="/download" className="features-header__cta">Descargar</Link>
        </div>
      </header>

      <div className="features-scroll-wrapper" ref={containerRef}>
        <div className="features-stage">
          <div className="features-intro">
            <span className="features-eyebrow">HISTORIAL DE VERSIONES & PARCHES</span>
            <h1>What's New in HELIX</h1>
            <p>
              Explora las versiones de la más reciente a la inicial. Desplaza la rueda para apilar cada entrega.
            </p>
          </div>

          <div className="features-cards-viewport">
            {RELEASES.map((release, index) => {
              let translateY = 0;
              if (index > 0) {
                const start = (index - 1) * stepSlice;
                const end = index * stepSlice;
                const t = Math.min(1, Math.max(0, (progress - start) / (end - start)));
                translateY = (1 - t) * 105;
              }

              return (
                <div
                  key={release.version}
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
                        Versión {index + 1} de {totalCards}
                      </span>
                      <Link to="/download" className="features-card-download">
                        Instalar v{release.version}
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
            <span>Última (v0.2.0)</span>
            <div className="features-progress-track">
              <i style={{ width: `${Math.max(6, progress * 100)}%` }} />
            </div>
            <span>Inicial (v0.1.0)</span>
          </div>
        </div>
      </div>

      <footer className="features-footer">
        <div className="features-footer__inner">
          <p>© {new Date().getFullYear()} Proyecto HELIX. Historial de lanzamientos y versiones.</p>
          <div className="features-footer__links">
            <Link to="/">Inicio</Link>
            <Link to="/docs">Documentación</Link>
            <Link to="/privacy">Privacidad</Link>
            <Link to="/download">Descargar</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
