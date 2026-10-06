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
          <a href="#features" className="nav-link">Features</a>
          <a href="#how-it-works" className="nav-link">How it Works</a>
          <a href="#security" className="nav-link">Security</a>
          <Link to="/download" className="nav-link">Download</Link>
        </div>
        
        <div className="nav-right">
          <Link to="/login" className="btn-ghost">Login</Link>
          <Link to="/download" className="btn-primary nav-download">Download <span className="nav-download-os">for Windows</span></Link>
        </div>
      </div>
    </nav>
  );
}
