import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Input from '../components/Input';
import Button from '../components/Button';
import Icon from '../components/Icon';
import '../styles/login.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
let googleScriptPromise;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => {
        googleScriptPromise = null;
        reject(new Error('Google sign-in could not be loaded.'));
      };
      document.head.appendChild(script);
    });
  }
  return googleScriptPromise;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleButtonRef = useRef(null);

  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined;
    let active = true;
    loadGoogleIdentity().then(() => {
      if (!active || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError('');
          setGoogleLoading(true);
          try {
            await loginWithGoogle(credential);
            navigate('/dashboard');
          } catch (err) {
            setError(err.response?.data?.detail || 'Google sign-in failed. Please try again.');
          } finally {
            setGoogleLoading(false);
          }
        },
        auto_select: false,
      });
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: Math.min(360, Math.max(240, googleButtonRef.current.clientWidth)),
      });
    }).catch((err) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, [loginWithGoogle, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo"><Icon name="microphone" /></div>
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to Mahi to fill or manage voice forms.</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <Input
            label="Email Address"
            type="email"
            leftIcon="envelope"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            leftIcon="lock"
            rightAdornment={(
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <Icon name={showPassword ? 'eyeSlash' : 'eye'} />
              </button>
            )}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            style={{ width: '100%', marginTop: '0.75rem' }}
          >
            Sign In
          </Button>
        </form>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="auth-divider"><span>or continue with</span></div>
            <div className="google-signin-shell" aria-busy={googleLoading}>
              <div ref={googleButtonRef} className="google-signin-button" />
              {googleLoading && <p className="google-signin-status" role="status">Signing in with Google…</p>}
            </div>
          </>
        )}

        <div className="auth-footer">
          Don't have an account?
          <Link to="/register" className="auth-link">
            Create account
          </Link>
        </div>

      </div>
    </div>
  );
}
