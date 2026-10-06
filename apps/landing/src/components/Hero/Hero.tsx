import React from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../HelixLogo/HelixLogo';
import './Hero.css';

export const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-logo-wrapper">
            <HelixLogo size="xl" showText={true} />
          </div>

          <div className="hero-badge">WINDOWS-RESIDENT AUTONOMOUS AGENT</div>
          
          <h1 className="hero-title">See. Hear. Act. Remember.</h1>

          {/* ── Direct CTAs ── */}
          <div className="hero-ctas">
            <Link to="/download" className="btn-primary hero-btn-main">
              Download for Windows
            </Link>
            <a href="#features" className="btn-secondary hero-btn-secondary">
              Explore Capabilities
            </a>
          </div>

          {/* ── Hardware & Architecture Specifications ── */}
          <div className="hero-specs">
            <div className="spec-item">
              <span className="spec-label">MODELS</span>
              <span className="spec-val">Gemini · Claude · GPT</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">FAILOVER</span>
              <span className="spec-val">3 Keys per Provider</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">SECURITY</span>
              <span className="spec-val">Local DPAPI / Zero-Trust</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
