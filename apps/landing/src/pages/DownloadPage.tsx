import React from 'react';
import { Navigation } from '../components/Navigation/Navigation';
import { Footer } from '../components/Footer/Footer';
import { Download } from '../components/Download/Download';
import './DownloadPage.css';

export const DownloadPage: React.FC = () => {
  return (
    <div className="download-page">
      <Navigation />
      <main className="download-page-content">
        <div className="download-page-header">
          <span className="section-label">INSTALLATION GUIDE</span>
          <h1 className="download-page-title">Deploy HELIX on Windows</h1>
          <p className="download-page-desc">
            Get the full native agent running on your computer. Follow the instructions below to install the desktop shell and the Python agent service.
          </p>
        </div>

        <Download requireAuthenticatedDownload />

        <div className="troubleshooting-section">
          <div className="troubleshooting-container">
            <h3 className="troubleshooting-title">Setup & Architecture Notes</h3>
            <div className="notes-grid">
              <div className="note-card">
                <span className="note-heading">API Keys Configuration</span>
                <p className="note-body">
                  HELIX reads keys from your <code>.env</code> file or Windows Credential Manager. You only need keys for the providers you want to use. If you only provide Google keys, OpenAI and Claude models won't appear.
                </p>
              </div>

              <div className="note-card">
                <span className="note-heading">Voice input</span>
                <p className="note-body">
                  HELIX uses SoundDevice for microphone input. It is installed with the agent's Python requirements; allow microphone access when prompted.
                </p>
              </div>

              <div className="note-card">
                <span className="note-heading">Startup with Windows</span>
                <p className="note-body">
                  When enabled in Toolbox, HELIX adds a safe registry entry under <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code> to launch the tray shell upon user login.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};
