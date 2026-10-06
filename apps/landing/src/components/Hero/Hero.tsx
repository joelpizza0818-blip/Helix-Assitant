import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FloatingUIPreview } from './FloatingUIPreview';
import './Hero.css';

const QUICK_PROMPTS = [
  'Analyze codebase & run tests',
  'Automate browser research',
  'Inspect active window',
  'Concurrent background jobs'
];

export const Hero: React.FC = () => {
  const [promptText, setPromptText] = useState('Analyze the repository and run all tests in the background');

  const handleChipClick = (prompt: string) => {
    setPromptText(prompt);
  };

  return (
    <section className="hero">
      <div className="hero-container">
        {/* ── Left Column: Editorial Content & Interactive Prompt Bar ── */}
        <div className="hero-left">
          <div className="hero-badge">WINDOWS-RESIDENT AUTONOMOUS AGENT</div>
          <h1 className="hero-title">See. Hear. Act. Remember.</h1>
          <p className="hero-desc">
            A persistent desktop agent operating alongside you on Windows. Automates filesystem, terminal, screen, and browser tasks across OpenAI, Anthropic, and Google with strict 3-key failover resilience.
          </p>

          {/* ── OpenAI-style Prompt / Command Bar ── */}
          <div className="hero-prompt-bar">
            <div className="prompt-input-wrapper">
              <span className="prompt-icon">⌘</span>
              <input
                type="text"
                className="prompt-input"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="What can HELIX do for you? Type a command or OS task..."
              />
              <Link to="/download" className="prompt-submit-btn" title="Run with HELIX">
                ↑
              </Link>
            </div>

            {/* ── Tag Chip Row (Suggested Actions) ── */}
            <div className="tag-chip-row">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`tag-chip ${promptText === item ? 'tag-chip--active' : ''}`}
                  onClick={() => handleChipClick(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

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
              Source & Architecture
            </a>
          </div>

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

        {/* ── Right Column: Floating UI Product Mockup ── */}
        <div className="hero-right">
          <FloatingUIPreview />
        </div>
      </div>
    </section>
  );
};
