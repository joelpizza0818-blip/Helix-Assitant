import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { HelixLogo } from '../HelixLogo/HelixLogo';
import { useLocale } from '../../hooks/useLocale';
import './Navigation.css';

export function Navigation() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const { user } = useAuth();
  const { locale, setLocale } = useLocale();

  return (
    <nav className="nav">
      <div className="nav-container">
        <div className="nav-left">
          <Link to="/" className="nav-logo-link" title="HELIX AI">
            <HelixLogo size="sm" showText={true} />
          </Link>
        </div>
        
        <div className="nav-center">
          <a href={isHome ? '#features' : '/#features'} className="nav-link">{locale === 'es' ? 'Capacidades' : 'Capabilities'}</a>
          <Link to="/features" className="nav-link">{locale === 'es' ? 'Novedades' : "What's New"}</Link>
          <a href={isHome ? '#router' : '/#router'} className="nav-link">{locale === 'es' ? 'Router de modelos' : 'Model Router'}</a>
          <a href={isHome ? '#security' : '/#security'} className="nav-link">{locale === 'es' ? 'Controles de seguridad' : 'Security controls'}</a>
          <Link to="/docs" className="nav-link">Docs</Link>
        </div>
        
        <div className="nav-right">
          <button type="button" className="btn-ghost nav-language" aria-label="Select language" onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}>{locale.toUpperCase()}</button>
          {!user && <Link to="/login" className="btn-ghost">{locale === 'es' ? 'Entrar' : 'Log in'}</Link>}
          <Link to="/download" className="btn-primary nav-cta">
            {locale === 'es' ? 'Descargar para Windows' : 'Download for Windows'}
          </Link>
        </div>
      </div>
    </nav>
  );
}
