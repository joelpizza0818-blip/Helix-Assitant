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
    subtitle: 'A desktop app, not a browser tab.',
    description: 'Runs in the Windows system tray and can launch with Windows when enabled. The desktop shell also provides a floating control surface.',
    tags: ['Electron', 'Windows Tray', 'Floating UI']
  },
  {
    number: '02',
    title: 'Multi-Provider Model Router',
    subtitle: 'Provider-aware capability routing.',
    description: 'Uses configured provider credentials, model capabilities, and fallback settings to select candidates. Additional key slots can be configured per provider.',
    tags: ['OpenAI', 'Anthropic', 'Google', 'Configurable Key Slots']
  },
  {
    number: '03',
    title: 'Native Computer Control',
    subtitle: 'Controlled OS automation layer.',
    description: 'The agent exposes desktop automation and screen/OCR tools through its tool layer; availability depends on local permissions and configuration.',
    tags: ['pywin32', 'pyautogui', 'OCR', 'Window Management']
  },
  {
    number: '04',
    title: 'Voice & Optical Gestures',
    subtitle: 'Natural local perceptual pipeline.',
    description: 'Optional voice input supports wake-word detection, VAD, and local or OpenAI speech-to-text. Camera gesture recognition uses MediaPipe when enabled.',
    tags: ['Wake Word', 'VAD', 'MediaPipe']
  },
  {
    number: '05',
    title: 'Web Research Tools',
    subtitle: 'Playwright-driven browser agent.',
    description: 'Can navigate web sources and extract information through configured browser tools. Results depend on accessible sources and tool configuration.',
    tags: ['Playwright', 'Data Extraction', 'Synthesis', 'Multi-Page']
  },
  {
    number: '06',
    title: 'Concurrent Background Tasks',
    subtitle: 'Parallel execution while you focus.',
    description: 'Tasks may run concurrently through asyncio. The task manager shows status and logs for supported jobs; cancellation depends on the current operation.',
    tags: ['Asyncio', 'Task Manager', 'Priority Queue', 'Cancellation']
  },
  {
    number: '07',
    title: 'Policy & Permission Engine',
    subtitle: 'Permission checks for supported tools.',
    description: 'Local permission checks and confirmation prompts are applied according to tool risk and policy. They do not replace operating-system security controls.',
    tags: ['Permission Checks', 'Confirmation Gates', 'Policy Engine']
  },
  {
    number: '08',
    title: 'Tiered Memory Architecture',
    subtitle: 'Conversation context and optional semantic memory.',
    description: 'Short-term context and semantic-memory features are available; persistence and retrieval depend on application and server configuration.',
    tags: ['Short-Term Context', 'Conversation', 'Optional Semantic Memory']
  }
];

export const Features: React.FC = () => {
  return (
    <section className="features" id="features">
      <div className="features-container">
        <div className="section-header">
          <span className="section-label">SYSTEM CAPABILITIES</span>
          <h2 className="section-title">Built for the Windows Desktop</h2>
          <p className="section-desc">
            HELIX combines a Windows desktop shell with a local Python agent. Available capabilities and permissions depend on the edition and configuration.
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
