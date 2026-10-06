import React from 'react';
import './FloatingUIPreview.css';

export const FloatingUIPreview: React.FC = () => {
  return (
    <div className="preview-card">
      <div className="preview-header">
        <div className="preview-brand">
          <span className="preview-wordmark">HELIX</span>
          <span className="preview-dot" />
        </div>
        <div className="preview-model">
          Google · Gemini 2.0 Flash
        </div>
        <div className="preview-gear">⚙</div>
      </div>

      <div className="preview-fallback-bar">
        <span>⇅ Gemini 2.0 Flash → Gemini 1.5 Pro</span>
      </div>

      <div className="preview-body">
        <div className="preview-msg preview-msg--user">
          <p>Analyze the codebase and run the test suite in the background while I work.</p>
          <span className="preview-time">10:42 AM</span>
        </div>

        <div className="preview-msg preview-msg--assistant">
          <p>Task queued. Initialized 2 concurrent background threads for repository scanning and pytest execution.</p>
          <span className="preview-time">10:42 AM</span>
        </div>

        <div className="preview-tool-log">
          <span className="preview-tool-dot" />
          <span className="preview-tool-name">terminal_tool</span>
          <span className="preview-tool-text">Executing: pytest tests/ -v (PID: 14820)</span>
        </div>

        <div className="preview-msg preview-msg--assistant">
          <p>All 47 tests passed (0 failures). Found 3 optimization candidates in services/agent/memory/.</p>
          <span className="preview-time">10:43 AM</span>
        </div>
      </div>

      <div className="preview-task-bar">
        <span className="preview-pulse-dot" />
        <span className="preview-task-count">1 task running</span>
        <span className="preview-task-sep">·</span>
        <span className="preview-task-desc">Monitoring system telemetry</span>
      </div>

      <div className="preview-input-row">
        <input
          type="text"
          className="preview-input"
          placeholder="Ask HELIX or issue OS command..."
          readOnly
        />
        <div className="preview-input-btn">🎙</div>
        <div className="preview-input-send">↵</div>
      </div>
    </div>
  );
};
