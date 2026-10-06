import React from 'react';
import './ModelRouter.css';

export const ModelRouter: React.FC = () => {
  return (
    <section className="model-router" id="router">
      <div className="model-router-container">
        <div className="section-header">
          <span className="section-label">PROVIDER & MODEL DISPATCH</span>
          <h2 className="section-title">Strict Provider Boundaries. True 3-Key Resilience.</h2>
          <p className="section-desc">
            HELIX never sends your prompt to a provider you haven't explicitly set up. If a provider fails, HELIX exhausts every key and fallback model inside that provider before reporting status.
          </p>
        </div>

        {/* ── Visual Flow Diagram ────────────────────────────── */}
        <div className="routing-flow-diagram">
          <div className="flow-step">
            <span className="flow-step-num">STEP 1</span>
            <div className="flow-card">
              <span className="flow-title">Task Requirements</span>
              <p className="flow-desc">Inspects command: vision, screen interaction, coding, or text latency.</p>
              <div className="flow-badge-row">
                <span className="flow-badge">vision: true</span>
                <span className="flow-badge">tools: true</span>
              </div>
            </div>
          </div>

          <div className="flow-arrow">→</div>

          <div className="flow-step">
            <span className="flow-step-num">STEP 2</span>
            <div className="flow-card">
              <span className="flow-title">Provider Filter</span>
              <p className="flow-desc">Eliminates unconfigured providers. Only providers with valid keys are considered.</p>
              <div className="flow-badge-row">
                <span className="flow-badge flow-badge--active">Google (Active)</span>
                <span className="flow-badge flow-badge--disabled">OpenAI (None)</span>
              </div>
            </div>
          </div>

          <div className="flow-arrow">→</div>

          <div className="flow-step">
            <span className="flow-step-num">STEP 3</span>
            <div className="flow-card">
              <span className="flow-title">Capability Registry</span>
              <p className="flow-desc">Filters candidate models whose specs match required capabilities.</p>
              <div className="flow-badge-row">
                <span className="flow-badge">gemini-2.0-flash</span>
                <span className="flow-badge">gemini-1.5-pro</span>
              </div>
            </div>
          </div>

          <div className="flow-arrow">→</div>

          <div className="flow-step">
            <span className="flow-step-num">STEP 4</span>
            <div className="flow-card flow-card--final">
              <span className="flow-title">Key Health Selection</span>
              <p className="flow-desc">Selects healthiest key slot (1, 2, or 3) with zero cooldown penalty.</p>
              <div className="flow-badge-row">
                <span className="flow-badge flow-badge--highlight">Key 1 (Healthy)</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Fallback Cascade Table ─────────────────────────── */}
        <div className="fallback-section">
          <h3 className="fallback-title">Provider-Bound Fallback Chain</h3>
          <div className="fallback-table">
            <div className="fallback-table-row fallback-table-header">
              <span>Failure Scenario</span>
              <span>Primary Execution</span>
              <span>Automated Recovery Cascade</span>
              <span>Constraint Guarantee</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">Key 1 Rate Limited</span>
              <span className="text-mono">Gemini 2.0 + Key 1</span>
              <span className="text-mono text-green">→ Gemini 2.0 + Key 2</span>
              <span className="text-secondary">Key 1 enters 60s cooldown</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">All Keys for Model Fail</span>
              <span className="text-mono">Gemini 2.0 (Keys 1-3)</span>
              <span className="text-mono text-green">→ Gemini 1.5 Pro + Key 1</span>
              <span className="text-secondary">Compatible fallback model chosen</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">Provider Quota Exhausted</span>
              <span className="text-mono">All Gemini Models/Keys</span>
              <span className="text-mono text-orange">→ Report Provider Unavailable</span>
              <span className="text-secondary">NO silent jump to Claude/OpenAI</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
