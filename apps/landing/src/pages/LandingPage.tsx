import React, { useEffect, useState } from 'react';
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
  const [introStage, setIntroStage] = useState<'initial' | 'phase1' | 'phase2' | 'done'>('initial');

  useEffect(() => {
    // Stage 1: Reveal the 3D logo + ELIX mark on the pitch-black backdrop
    const t1 = setTimeout(() => {
      setIntroStage('phase1');
    }, 150);

    // Stage 2: Settle / Retreat ("retrocede a su lugar"):
    // ELIX text fades & collapses, 3D logo smoothly retreats to hero scale 1.0,
    // black overlay dissolves, and page content reveals
    const t2 = setTimeout(() => {
      setIntroStage('phase2');
    }, 2600);

    // Stage 3: Unlock page completely
    const t3 = setTimeout(() => {
      setIntroStage('done');
    }, 4500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []); // Run once on mount so timeouts are never interrupted or cancelled

  // Scroll-reveal via IntersectionObserver
  useEffect(() => {
    if (introStage === 'initial' || introStage === 'phase1') return;

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
  }, [introStage]);

  const isIntroActive = introStage !== 'done';

  return (
    <div className={`landing-page ${isIntroActive ? 'intro-active intro-' + introStage : ''}`}>
      {/* ── Pitch Black Overlay for Intro ── */}
      {isIntroActive && (
        <div className={`intro-overlay ${introStage === 'phase2' ? 'fade-out' : ''}`} />
      )}

      <div className="landing-content">
        <Navigation />

        {/* ── Hero: full-viewport, voxel logo centered ── */}
        <section className="hero-void">
          {/* Flanking text */}
          <div className="hero-void__left reveal-left">
            <p className="hero-void__kicker">WINDOWS-RESIDENT</p>
            <h1 className="hero-void__heading">AUTONOMOUS<br />AGENT</h1>
          </div>

          {/* Centre — the 3-D logo + ELIX Lockup */}
          <div className="hero-void__center">
            <div className={`intro-brand-lockup stage-${introStage}`}>
              <div className="intro-voxel-slot">
                <HelixVoxel width={380} showExport={false} />
              </div>
              
              {/* "ELIX" typography for the intro phase */}
              {isIntroActive && (
                <div className={`intro-elix-slot stage-${introStage}`}>
                  <span>ELIX</span>
                </div>
              )}
            </div>

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
    </div>
  );
};
