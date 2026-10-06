import React from 'react';
import './Features.css';

interface FeatureItem {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
}

const FEATURES: FeatureItem[] = [
  {
    number: '01',
    title: 'Persistent Computer Agent',
    subtitle: 'Lives on Windows. Not a browser tab.',
    description: 'Runs silently in the Windows system tray and launches with Windows when enabled. Summonable as a lightweight, non-intrusive floating control surface that never breaks your workflow.',
    tags: ['Electron', 'Windows Tray', 'Floating UI', 'Zero-Latency']
  },
  {
    number: '02',
    title: 'Multi-Provider Model Router',
    subtitle: 'Provider-aware capability routing.',
    description: 'Inspects your configured keys to show ONLY available providers. Maps tasks to models capable of the exact requirements (vision, code, computer-use) with 3-key fallback per provider.',
    tags: ['OpenAI', 'Anthropic', 'Google', '3-Key Fallback']
  },
  {
    number: '03',
    title: 'Native Computer Control',
    subtitle: 'Controlled OS automation layer.',
    description: 'Directly moves mouse, inputs keystrokes, resizes/manages native windows, and analyzes displays using high-speed screen capture and OCR. No model direct access without tool validation.',
    tags: ['pywin32', 'pyautogui', 'OCR', 'Window Management']
  },
  {
    number: '04',
    title: 'Voice & Optical Gestures',
    subtitle: 'Natural local perceptual pipeline.',
    description: 'Wake word detection ("Helix") with VAD and speech-to-text. Camera recognizes 6 core gestures (Confirm, Reject, Search, Stop, Close, Open) locally via MediaPipe.',
    tags: ['Wake Word', 'VAD', 'MediaPipe', '6 Gestures']
  },
  {
    number: '05',
    title: 'Autonomous Web Research',
    subtitle: 'Playwright-driven browser agent.',
    description: 'Navigates search engines, traverses links, extracts structured data, cross-checks facts across multiple sources, and synthesizes answers. Triggered via text, voice, or optical gesture.',
    tags: ['Playwright', 'Data Extraction', 'Synthesis', 'Multi-Page']
  },
  {
    number: '06',
    title: 'Concurrent Background Tasks',
    subtitle: 'Parallel execution while you focus.',
    description: 'Create long-running jobs that execute concurrently via asyncio. Check real-time progress, review execution logs, and halt or cancel operations at any moment from the task manager.',
    tags: ['Asyncio', 'Task Manager', 'Priority Queue', 'Cancellation']
  },
  {
    number: '07',
    title: 'Policy & Permission Engine',
    subtitle: 'Rigorous security and confirmation.',
    description: 'Hierarchical permission tiers (READ_ONLY to CRITICAL). Potentially destructive actions require affirmative confirmation with full explanations of what will change and why.',
    tags: ['6 Tiers', 'Protected Paths', 'Gesture Confirm', 'Audit Logs']
  },
  {
    number: '08',
    title: 'Tiered Memory Architecture',
    subtitle: 'Remembers context without bloat.',
    description: 'Maintains short-term conversational context alongside long-term semantic knowledge using embeddings. Integrates with PostgreSQL pgvector for semantic retrieval.',
    tags: ['Short-Term', 'Conversation', 'Semantic', 'pgvector']
  }
];

export const Features: React.FC = () => {
  return (
    <section className="features" id="features">
      <div className="features-container">
        <div className="section-header">
          <span className="section-label">SYSTEM CAPABILITIES</span>
          <h2 className="section-title">Engineered for Resident Autonomy</h2>
          <p className="section-desc">
            HELIX is built from the ground up as a deep Windows service agent, not a wrapped web page. Every module functions under strict security and architectural isolation.
          </p>
        </div>

        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.number} className="feature-card">
              <div className="feature-card-header">
                <span className="feature-number">{f.number}</span>
                <div className="feature-tags">
                  {f.tags.map((tag) => (
                    <span key={tag} className="tag-pill">{tag}</span>
                  ))}
                </div>
              </div>
              <h3 className="feature-title">{f.title}</h3>
              <h4 className="feature-subtitle">{f.subtitle}</h4>
              <p className="feature-body">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
