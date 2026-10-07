import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navigation } from '../components/Navigation/Navigation';
import { Features } from '../components/Features/Features';
import { ModelRouter } from '../components/ModelRouter/ModelRouter';
import { Security } from '../components/Security/Security';
import { Download } from '../components/Download/Download';
import { Footer } from '../components/Footer/Footer';
import { HelixVoxel } from '../components/HelixVoxel/HelixVoxel';
import './LandingPage.css';

export const LandingPage: React.FC = () => {
  // Scroll-reveal via IntersectionObserver — no external dependency
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.15 }
    );

    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach((el) =>
      observer.observe(el)
    );

    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page">
      <Navigation />

      {/* ── Hero: full-viewport, voxel logo centered ── */}
      <section className="hero-void">
        {/* Flanking text — revealed on scroll */}
        <div className="hero-void__left reveal-left">
          <p className="hero-void__kicker">WINDOWS-RESIDENT</p>
          <h1 className="hero-void__heading">AUTONOMOUS<br />AGENT</h1>
        </div>

        {/* Centre — the 3-D logo. Always visible, no export button */}
        <div className="hero-void__center">
          <HelixVoxel width={380} showExport={false} />
          <Link to="/download" className="hero-void__cta">
            Download for Windows
          </Link>
        </div>

        <div className="hero-void__right reveal-right">
          <p className="hero-void__body">
            Sees your screen.<br />
            Hears your voice.<br />
            Acts on your computer.<br />
            Remembers everything.
          </p>
          <div className="hero-void__specs">
            <span><span className="spec-label">MODELS</span> Gemini · Claude · GPT</span>
            <span><span className="spec-label">FAILOVER</span> 3 Keys / Provider</span>
            <span><span className="spec-label">PRIVACY</span> Local · Zero-Trust</span>
          </div>
        </div>
      </section>

      {/* ── All original sections preserved ── */}
      <main>
        <Features />
        <ModelRouter />
        <Security />
        <Download />
      </main>

      <Footer />
    </div>
  );
};
