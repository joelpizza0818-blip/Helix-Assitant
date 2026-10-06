import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './AuthPage.css';

export const RegisterPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const { signUp, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSuccessMsg(null);

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match');
      return;
    }

    try {
      const { error } = await signUp(email, password);
      if (error) {
        setAuthError(error.message);
      } else {
        setSuccessMsg('Account created. Check your inbox to confirm your email or sign in directly.');
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Registration failed');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-header">
          <Link to="/" className="auth-logo-link">
            <HelixLogo size="md" showText={true} />
          </Link>
          <h2 className="auth-title">Register Account</h2>
          <p className="auth-subtitle">Initialize cloud persistence & cross-device settings</p>
        </div>

        {authError && <div className="auth-alert">{authError}</div>}
        {successMsg && <div className="auth-alert auth-alert--success">{successMsg}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">EMAIL ADDRESS</label>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@domain.com"
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">PASSWORD</label>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={8}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">CONFIRM PASSWORD</label>
            <input
              type="password"
              className="auth-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={8}
            />
          </div>

          <button type="submit" className="btn-primary auth-submit" disabled={isLoading}>
            {isLoading ? 'Creating Account...' : 'Register'}
          </button>
        </form>

        <div className="auth-footer">
          <span className="text-muted">Already registered?</span>{' '}
          <Link to="/login" className="auth-link">Log In</Link>
        </div>
      </div>
    </div>
  );
};
