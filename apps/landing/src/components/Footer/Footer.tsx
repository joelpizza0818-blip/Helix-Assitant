import React from 'react';
import './Footer.css';

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-left">
          <div className="footer-brand">
            <span className="footer-wordmark">HELIX</span>
            <span className="footer-tagline">Persistent Windows AI Desktop Agent</span>
          </div>
          <p className="footer-copyright">
            © {new Date().getFullYear()} HELIX Project. Licensed under Apache 2.0. Built for real engineering.
          </p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <span className="footer-col-title">ARCHITECTURE</span>
            <a href="#features">Capabilities</a>
            <a href="#router">Model Router</a>
            <a href="#security">Zero-Trust</a>
          </div>

          <div className="footer-col">
            <span className="footer-col-title">DEVELOPER</span>
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub Repository</a>
            <a href="/download">Download Builds</a>
            <a href="/login">Account Portal</a>
          </div>
        </div>
      </div>
    </footer>
  );
};
