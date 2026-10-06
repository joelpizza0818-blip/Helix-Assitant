import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelixLogo } from '../HelixLogo/HelixLogo';
import './Footer.css';

export const Footer: React.FC = () => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-left">
          <div className="footer-brand">
            <HelixLogo size="sm" showText={true} />
            <span className="footer-tagline">Persistent Windows AI Desktop Agent</span>
          </div>
          <p className="footer-copyright">
            © {new Date().getFullYear()} HELIX Project. Licensed under Apache 2.0.
          </p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <span className="footer-col-title">ARCHITECTURE</span>
            <a href={isHome ? '#features' : '/#features'}>Capabilities</a>
            <a href={isHome ? '#router' : '/#router'}>Model Router</a>
            <a href={isHome ? '#security' : '/#security'}>Zero-Trust</a>
          </div>

          <div className="footer-col">
            <span className="footer-col-title">PRODUCT</span>
            <Link to="/download">Download Builds</Link>
            <Link to="/login">Account Portal</Link>
            <Link to="/register">Create Account</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
