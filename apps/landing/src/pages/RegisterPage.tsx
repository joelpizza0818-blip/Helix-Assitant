import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import { getPostAuthRedirect } from '../lib/authRedirect';
import './AuthPage.css';

export const RegisterPage: React.FC = () => {
  const [authError, setAuthError] = useState<string | null>(null);
  const { user, signInWithGitHub, isLoading, error: hookError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = getPostAuthRedirect(location.search);

  useEffect(() => {
    if (!isLoading && user) navigate(redirectTo, { replace: true });
  }, [isLoading, navigate, redirectTo, user]);

  const handleGitHubSignUp = async () => {
    setAuthError(null);
    try {
      await signInWithGitHub(redirectTo);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to register with GitHub');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-header">
          <Link to="/" className="auth-logo-link" aria-label="Back to HELIX">
            <HelixLogo size="md" showText={true} />
          </Link>
          <h2 className="auth-title">Create Account with GitHub</h2>
          <p className="auth-subtitle">
            Link your GitHub account in a single step to sync telemetry and settings.
          </p>
        </div>

        {authError && <div className="auth-alert">{authError}</div>}
        {hookError && <div className="auth-alert">{hookError}</div>}

        <div className="auth-github-exclusive">
          <button
            className="btn-github btn-github--large"
            onClick={handleGitHubSignUp}
            type="button"
            disabled={isLoading}
          >
            <svg height="22" width="22" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '10px' }}>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {isLoading ? 'Connecting to GitHub...' : 'Sign up with GitHub'}
          </button>

          <p className="auth-gh-note">
            No additional passwords required. All access is securely managed through your GitHub developer profile.
          </p>
        </div>

        <div className="auth-footer">
          <p className="auth-privacy-notice">
            By signing up, you accept the <Link to="/privacy" className="auth-inline-link">Privacy Policy</Link> of HELIX.
          </p>
        </div>
      </div>
    </div>
  );
};
