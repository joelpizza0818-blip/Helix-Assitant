import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DownloadPage } from './pages/DownloadPage';
import { RequireAuth } from './components/Auth/RequireAuth';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/download" element={<RequireAuth><DownloadPage /></RequireAuth>} />
    </Routes>
  );
}

export default App;
