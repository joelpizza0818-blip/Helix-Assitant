import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelixLogo } from '../HelixLogo/HelixLogo';
import './Navigation.css';

export function Navigation() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <nav className="nav">
      <div className="nav-container">
        <div className="nav-left">
          <Link to="/" className="nav-logo-link" title="HELIX AI">
            <HelixLogo size="sm" showText={true} />
          </Link>
        </div>
        
        <div className="nav-center">
          <a href={isHome ? '#features' : '/#features'} className="nav-link">Capabilities</a>
          <a href={isHome ? '#router' : '/#router'} className="nav-link">Model Router</a>
          <a href={isHome ? '#security' : '/#security'} className="nav-link">Zero-Trust</a>
          <Link to="/download" className="nav-link">Documentation</Link>
        </div>
        
        <div className="nav-right">
          <Link to="/login" className="btn-ghost">Log in</Link>
          <Link to="/download" className="btn-primary nav-cta">
            Download for Windows
          </Link>
        </div>
      </div>
    </nav>
  );
}
