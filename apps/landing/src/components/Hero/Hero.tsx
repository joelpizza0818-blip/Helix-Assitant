import React from 'react';
import { Link } from 'react-router-dom';
import { FloatingUIPreview } from './FloatingUIPreview';
import './Hero.css';

export const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="hero-container">
        <div className="hero-left">
          <div className="hero-badge">WINDOWS-RESIDENT AI AGENT</div>
          <h1 className="hero-title">HELIX</h1>
          <h2 className="hero-subtitle">See. Hear. Act. Remember.</h2>
          <p className="hero-desc">
            A persistent computer agent that lives on your Windows system tray. Operates across your screen, filesystem, terminal, and browser while running concurrent background tasks with strict permission controls and provider-bound failovers.
          </p>

          <div className="hero-ctas">
            <Link to="/download" className="btn-primary">
              Download for Windows
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              Source & Docs
            </a>
          </div>

          <div className="hero-specs">
            <div className="spec-item">
              <span className="spec-label">PROVIDERS</span>
              <span className="spec-val">OpenAI · Claude · Gemini</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">INTERACTION</span>
              <span className="spec-val">Tray · Voice · 6 Gestures</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">STORAGE</span>
              <span className="spec-val">DPAPI Encrypted</span>
            </div>
          </div>
        </div>

        <div className="hero-right">
          <FloatingUIPreview />
        </div>
      </div>
    </section>
  );
};
