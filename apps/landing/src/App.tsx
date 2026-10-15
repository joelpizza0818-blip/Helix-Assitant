import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DownloadPage } from './pages/DownloadPage';
import { FeaturesPage } from './pages/FeaturesPage';
import { ScrollytellingLandingPage } from './pages/ScrollytellingLandingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { DocsPage } from './pages/DocsPage';
import { RequireAuth } from './components/Auth/RequireAuth';

function App() {
  return (
    <Routes>
      <Route path="/" element={<ScrollytellingLandingPage />} />
      <Route path="/landing-candidate" element={<ScrollytellingLandingPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/whats-new" element={<FeaturesPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/download" element={<DownloadPage />} />
    </Routes>
  );
}

export default App;

