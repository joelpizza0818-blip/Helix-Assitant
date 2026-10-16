import React from 'react';
import './ModelRouter.css';

export const ModelRouter: React.FC = () => {
  return (
    <section className="model-router" id="router">
      <div className="model-router-container">
        <div className="section-header">
          <span className="section-label">PROVIDER & MODEL DISPATCH</span>
          <h2 className="section-title">Provider-Aware Model Routing</h2>
          <p className="section-desc">
            HELIX selects from providers with configured credentials and models that match the requested capabilities. Fallback behavior depends on provider health and your cross-provider fallback setting.
          </p>
        </div>

        {/* ── Visual Flow Diagram ────────────────────────────── */}
        <div className="routing-flow-diagram">
          <div className="flow-step">
            <span className="flow-step-num">STEP 1</span>
            <div className="flow-card">
              <span className="flow-title">Task Requirements</span>
              <p className="flow-desc">Detects requested capabilities such as vision, tools, and coding.</p>
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
              <p className="flow-desc">Providers with configured credentials become candidates; actual key validity is determined by the provider response.</p>
              <div className="flow-badge-row">
                <span className="flow-badge flow-badge--active">Google (Configured)</span>
                <span className="flow-badge flow-badge--disabled">OpenAI (Not configured)</span>
              </div>
            </div>
          </div>

          <div className="flow-arrow">→</div>

          <div className="flow-step">
            <span className="flow-step-num">STEP 3</span>
            <div className="flow-card">
              <span className="flow-title">Capability Registry</span>
              <p className="flow-desc">Matches candidate models against the local capability registry.</p>
              <div className="flow-badge-row">
                <span className="flow-badge">Vision-capable model</span>
                <span className="flow-badge">Text model</span>
              </div>
            </div>
          </div>

          <div className="flow-arrow">→</div>

          <div className="flow-step">
            <span className="flow-step-num">STEP 4</span>
            <div className="flow-card flow-card--final">
              <span className="flow-title">Eligible Key Selection</span>
              <p className="flow-desc">Selects an eligible key slot from the configured provider pool.</p>
              <div className="flow-badge-row">
                <span className="flow-badge flow-badge--highlight">Available key slot</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Fallback Cascade Table ─────────────────────────── */}
        <div className="fallback-section">
          <h3 className="fallback-title">Fallback Behavior Depends on Health and Settings</h3>
          <div className="fallback-table">
            <div className="fallback-table-row fallback-table-header">
              <span>Failure Scenario</span>
              <span>Possible Next Step</span>
              <span>What Determines It</span>
              <span>Limit</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">Key is rate limited</span>
              <span className="text-mono text-green">Try another eligible key or model</span>
              <span className="text-secondary">Provider and key health</span>
              <span className="text-secondary">A usable alternative must exist</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">Model is unavailable</span>
              <span className="text-mono text-green">Try another compatible model</span>
              <span className="text-secondary">Model capability and health</span>
              <span className="text-secondary">Availability depends on the provider</span>
            </div>
            <div className="fallback-table-row">
              <span className="text-bone">Provider is unavailable</span>
              <span className="text-mono text-orange">Report an error or try configured fallback</span>
              <span className="text-secondary">Fallback settings</span>
              <span className="text-secondary">Cross-provider fallback is configurable</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
