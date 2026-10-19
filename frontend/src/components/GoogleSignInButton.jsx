import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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

export default function GoogleSignInButton() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef(null);
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) return undefined;
    let active = true;
    loadGoogleIdentity().then(() => {
      if (!active || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError('');
          setLoading(true);
          try {
            await loginWithGoogle(credential);
            navigate('/dashboard');
          } catch (err) {
            setError(err.response?.data?.detail || 'Google sign-in failed. Please try again.');
          } finally {
            setLoading(false);
          }
        },
        auto_select: false,
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: Math.min(360, Math.max(240, buttonRef.current.clientWidth)),
      });
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    });
    return () => { active = false; };
  }, [loginWithGoogle, navigate]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <div className="auth-divider"><span>or continue with</span></div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <div className="google-signin-shell" aria-busy={loading}>
        <div ref={buttonRef} className="google-signin-button" />
        {loading && <p className="google-signin-status" role="status">Signing in with Google…</p>}
      </div>
    </>
  );
}
