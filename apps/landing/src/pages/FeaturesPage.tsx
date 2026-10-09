import { Link } from 'react-router-dom';
import { Footer } from '../components/Footer/Footer';
import { Navigation } from '../components/Navigation/Navigation';
import './FeaturesPage.css';

interface Release {
  version: string;
  title: string;
  changes: string[];
}

const RELEASES: Release[] = [
  {
    version: '0.1.9',
    title: 'Windows installer reliability',
    changes: [
      'Include dynamically loaded Windows automation modules in the bundled Python agent.',
      'Add this version-by-version release history to the landing page.',
    ],
  },
  {
    version: '0.1.8',
    title: 'Reliable GitHub sign-in',
    changes: ['Accept the HELIX callback URL as parsed by Chromium on Windows.'],
  },
  {
    version: '0.1.7',
    title: 'Windows sign-in fixes',
    changes: ['Normalize Windows OAuth callback URLs before exchanging the sign-in code.'],
  },
  {
    version: '0.1.6',
    title: 'Installer verification',
    changes: ['Make SHA-256 verification compatible with Windows release builds.'],
  },
  {
    version: '0.1.5',
    title: 'GitHub profile sign-in',
    changes: [
      'Repair desktop GitHub OAuth and prevent sign-in from waiting indefinitely.',
      'Bundle a checksum-verified GitHub CLI with Windows builds.',
    ],
  },
  {
    version: '0.1.4',
    title: 'Profiles and administration',
    changes: [
      'Add GitHub-linked HELIX profiles, administrator roles, and error reporting.',
      'Preserve conversation context when switching models after a provider failure.',
    ],
  },
  {
    version: '0.1.3',
    title: 'Voice, memory, and release controls',
    changes: [
      'Add live voice and memory controls.',
      'Add GitHub-backed release administration and shared release policy.',
    ],
  },
  {
    version: '0.1.2',
    title: 'Installer updates on the landing page',
    changes: ['Show the latest published installer version on the landing page.'],
  },
  {
    version: '0.1.1',
    title: 'In-app updates',
    changes: ['Add desktop update checks, downloads, and installation from HELIX.'],
  },
  {
    version: '0.1.0',
    title: 'HELIX foundation',
    changes: [
      'Establish the Windows desktop agent, system-tray controls, and floating interface.',
      'Bring together AI model routing, computer tools, voice, gestures, browser research, and memory.',
    ],
  },
];

export function FeaturesPage() {
  return (
    <div className="features-page">
      <Navigation />
      <main className="features-page__content">
        <header className="features-page__header">
          <span className="features-page__eyebrow">HELIX RELEASE HISTORY</span>
          <h1>Features, version by version.</h1>
          <p>
            A look at what has changed from the first HELIX release to the latest build.
          </p>
        </header>

        <ol className="release-list">
          {RELEASES.map((release) => (
            <li className="release-card" key={release.version}>
              <div className="release-card__meta">
                <span className="release-card__version">v{release.version}</span>
              </div>
              <div className="release-card__details">
                <h2>{release.title}</h2>
                <ul>
                  {release.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <div className="features-page__action">
          <Link to="/download" className="features-page__download">Get HELIX for Windows</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
