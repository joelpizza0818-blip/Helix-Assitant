import React from 'react';
import './FloatingUIPreview.css';

export const FloatingUIPreview: React.FC = () => {
  return (
    <div className="preview-card">
      <div className="preview-header">
        <div className="preview-brand">
          <span className="preview-wordmark">HELIX PREVIEW</span>
          <span className="preview-dot" />
        </div>
        <div className="preview-model">
          Configured provider · Model
        </div>
        <div className="preview-gear" aria-label="Settings">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
      </div>

      <div className="preview-fallback-bar">
        <span>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
          Primary model
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', margin: '0 5px' }}>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          Fallback model
        </span>
      </div>

      <div className="preview-body">
        <div className="preview-msg preview-msg--user">
          <p>Analyze the codebase and run the test suite in the background while I work.</p>
          <span className="preview-time">10:42 AM</span>
        </div>

        <div className="preview-msg preview-msg--assistant">
          <p>Task queued. Review progress and results in the task manager.</p>
          <span className="preview-time">10:42 AM</span>
        </div>

        <div className="preview-tool-log">
          <span className="preview-tool-dot" />
          <span className="preview-tool-name">terminal_tool</span>
          <span className="preview-tool-text">Running configured tool</span>
        </div>

        <div className="preview-msg preview-msg--assistant">
          <p>Example result ready for review. Check the task output before applying changes.</p>
          <span className="preview-time">10:43 AM</span>
        </div>
      </div>

      <div className="preview-task-bar">
        <span className="preview-pulse-dot" />
        <span className="preview-task-count">1 task running</span>
        <span className="preview-task-sep">·</span>
        <span className="preview-task-desc">Example task in progress</span>
      </div>

      <div className="preview-input-row">
        <input
          type="text"
          className="preview-input"
          placeholder="Ask HELIX or issue OS command..."
          readOnly
        />
        <div className="preview-input-btn" aria-label="Microphone">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <div className="preview-input-send" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        </div>
      </div>
    </div>
  );
};
