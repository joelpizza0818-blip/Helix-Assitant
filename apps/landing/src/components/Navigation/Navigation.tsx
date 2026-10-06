import React from 'react';
import { Link } from 'react-router-dom';
import './Navigation.css';

export function Navigation() {
  return (
    <nav className="nav">
      <div className="nav-container">
        <div className="nav-left">
          <Link to="/" className="nav-logo">
            HELIX<span className="nav-dot"></span>
          </Link>
        </div>
        
        <div className="nav-center">
          <a href="#features" className="nav-link">Capabilities</a>
          <a href="#router" className="nav-link">Model Router</a>
          <a href="#security" className="nav-link">Zero-Trust</a>
          <Link to="/download" className="nav-link">Docs</Link>
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
