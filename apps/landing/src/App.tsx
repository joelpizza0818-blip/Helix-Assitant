import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';

import { RequireAuth } from './components/Auth/RequireAuth';

const LoginPage = lazy(() => import('./pages/LoginPage').then(({ LoginPage: page }) => ({ default: page })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(({ RegisterPage: page }) => ({ default: page })));
const DownloadPage = lazy(() => import('./pages/DownloadPage').then(({ DownloadPage: page }) => ({ default: page })));
const FeaturesPage = lazy(() => import('./pages/FeaturesPage').then(({ FeaturesPage: page }) => ({ default: page })));
const ScrollytellingLandingPage = lazy(() => import('./pages/ScrollytellingLandingPage').then(({ ScrollytellingLandingPage: page }) => ({ default: page })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(({ PrivacyPage: page }) => ({ default: page })));
const DocsPage = lazy(() => import('./pages/DocsPage').then(({ DocsPage: page }) => ({ default: page })));
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage').then(({ AnnouncementsPage: page }) => ({ default: page })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(({ AdminPage: page }) => ({ default: page })));

function CanonicalManager() {
  const location = useLocation();

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='canonical']");
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    const cleanPath = location.pathname === '/' ? '/' : location.pathname.replace(/\/$/, '');
    link.setAttribute('href', `https://helix-assistant.vercel.app${cleanPath}`);
  }, [location.pathname]);

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'HELIX — Local-first AI desktop agent',
      '/features': 'HELIX capabilities and releases',
      '/whats-new': 'What’s new in HELIX',
      '/announcements': 'HELIX announcements and newsroom',
      '/admin': 'HELIX landing administration',
      '/download': 'Download HELIX',
      '/docs': 'HELIX documentation',
      '/privacy': 'HELIX privacy and security',
    };
    const descriptions: Record<string, string> = {
      '/': 'A local-first desktop agent with approval-gated tools, optional voice and screen context, and a supported CLI.',
      '/features': 'Explore HELIX capabilities, architecture, releases, and the controls that keep actions reviewable.',
      '/whats-new': 'See the latest HELIX releases and changes.',
      '/download': 'Choose the supported HELIX desktop installer for Windows or use the CLI on macOS and Linux.',
      '/docs': 'Read HELIX setup, usage, architecture, and security documentation.',
      '/privacy': 'Understand how HELIX handles local data, accounts, and update notifications.',
      '/announcements': 'Read HELIX release notes, product updates, and announcements selected for public release.',
    };
    document.title = titles[location.pathname] ?? 'HELIX — Local-first AI desktop agent';
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    description.content = descriptions[location.pathname] ?? descriptions['/'];
  }, [location.pathname]);

  return null;
}

function App() {
  return (
    <>
      <CanonicalManager />
      <Suspense fallback={<main className="auth-page"><p className="auth-subtitle">Loading HELIX…</p></main>}>
        <Routes>
          <Route path="/" element={<ScrollytellingLandingPage />} />
          <Route path="/landing-candidate" element={<ScrollytellingLandingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/whats-new" element={<FeaturesPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route
            path="/admin"
            element={(
              <RequireAuth>
                <AdminPage />
              </RequireAuth>
            )}
          />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/download" element={<DownloadPage />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
