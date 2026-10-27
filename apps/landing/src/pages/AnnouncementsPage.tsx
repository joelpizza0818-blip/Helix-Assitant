import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveSiteNavigation } from '../components/ResponsiveSiteNavigation';
import { fetchPublicAnnouncements, type AnnouncementCategory, type LandingAnnouncement } from '../lib/landingContent';
import './AnnouncementsPage.css';

const FILTERS: Array<'ALL' | AnnouncementCategory> = [
  'ALL',
  'RELEASE',
  'FEATURE',
  'SECURITY',
  'MOBILE',
  'ECOSYSTEM',
  'COMPATIBILITY',
];

export const AnnouncementsPage: React.FC = () => {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [announcements, setAnnouncements] = useState<LandingAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPublicAnnouncements()
      .then((items) => {
        if (active) setAnnouncements(items);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los anuncios.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filtered = filter === 'ALL'
    ? announcements
    : announcements.filter((announcement) => announcement.category === filter);

  return (
    <div className="ann-page">
      <ResponsiveSiteNavigation />

      <main className="ann-main">
        <div className="ann-container">
          <section className="ann-hero">
            <span className="ann-eyebrow">HELIX NEWSROOM & DISPATCHES</span>
            <h1 className="ann-title">Novedades & Anuncios de HELIX</h1>
            <p className="ann-lead">
              Lanzamientos, cambios de arquitectura y compatibilidad con estados de publicación y validación explícitos.
            </p>
          </section>

          <div className="ann-filters" role="tablist" aria-label="Filtrar anuncios">
            {FILTERS.map((category) => (
              <button
                key={category}
                type="button"
                className={`ann-filter-btn ${filter === category ? 'ann-filter-btn--active' : ''}`}
                onClick={() => setFilter(category)}
                role="tab"
                aria-selected={filter === category}
              >
                {category === 'ALL' ? 'Todos' : category}
              </button>
            ))}
          </div>

          {error && <p className="ann-state ann-state--error" role="alert">{error}</p>}
          {loading && <p className="ann-state" role="status">Cargando anuncios…</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="ann-state">Todavía no hay anuncios publicados en esta categoría.</p>
          )}
          <div className="ann-feed" aria-busy={loading}>
            {filtered.map((item) => (
              <article key={item.id} className="ann-card">
                <div className="ann-card__top">
                  <span className={`ann-category-tag ann-category-tag--${item.category.toLowerCase()}`}>
                    {item.category}
                  </span>
                  <time className="ann-date" dateTime={item.publishedAt ?? item.createdAt}>
                    {new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date(item.publishedAt ?? item.createdAt))}
                  </time>
                </div>
                <h2 className="ann-card__title">{item.title}</h2>
                <p className="ann-card__summary">{item.summary}</p>
                <ul className="ann-card__list">
                  {item.content.map((point) => (
                    <li key={point}>
                      <svg className="ann-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                {item.links.length > 0 && (
                  <div className="ann-card__actions">
                    {item.links.map((link) => link.external ? (
                      <a key={link.text} className="ann-link-btn" href={link.url} target="_blank" rel="noreferrer">
                        {link.text}
                      </a>
                    ) : (
                      <Link key={link.text} className="ann-link-btn" to={link.url}>{link.text}</Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </main>

      <footer className="ann-footer">
        <div className="ann-footer__inner">
          <Link to="/">HELIX</Link>
          <span>Product updates and release notices</span>
          <div className="ann-footer__links">
            <Link to="/features">What's New</Link>
            <Link to="/download">Download</Link>
            <a href="#top">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
