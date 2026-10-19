import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import { SUPPORTED_LANGUAGES } from '../constants/languages';
import { translationService } from '../services/translationService';

const TAMIL_NAV_TRANSLATIONS = {
  Language: 'மொழி',
  Dashboard: 'முகப்பு',
  Forms: 'படிவங்கள்',
  'Report an issue': 'உதவி',
  Management: 'நிர்வாகம்',
  Logout: 'வெளியேறு',
  Login: 'உள்நுழை',
  Register: 'பதிவு செய்',
  'Install app': 'செயலியை நிறுவு',
  'Close navigation menu': 'வழிசெலுத்தல் பட்டியை மூடு',
  'Open navigation menu': 'வழிசெலுத்தல் பட்டியைத் திற',
};

export default function Navbar() {
  const { user, logout, updatePreferredLanguage, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [translations, setTranslations] = useState({});
  const languageCode = user?.preferred_language || 'en-IN';
  const navTexts = ['Language', 'Dashboard', 'Forms', 'Report an issue', 'Management', 'Logout', 'Login', 'Register', 'Install app', 'Close navigation menu', 'Open navigation menu'];
  const t = (text) => translations[text] || text;

  useEffect(() => {
    let cancelled = false;
    if (languageCode === 'en-IN') {
      setTranslations({});
      return undefined;
    }
    if (languageCode === 'ta-IN') {
      setTranslations(TAMIL_NAV_TRANSLATIONS);
      return undefined;
    }
    translationService.translateTexts(navTexts, 'en-IN', languageCode)
      .then((values) => { if (!cancelled) setTranslations(Object.fromEntries(navTexts.map((value, index) => [value, values[index] || value]))); })
      .catch(() => { if (!cancelled) setTranslations({}); });
    return () => { cancelled = true; };
  }, [languageCode]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const handleLogout = () => {
    closeMobileMenu();
    logout();
    navigate('/login');
  };

  const handleLanguageChange = async (event) => {
    try {
      await updatePreferredLanguage(event.target.value);
    } catch {
      window.alert('Could not save your language preference. Please try again.');
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) {
      window.alert('To install Mahi, open your browser menu and choose “Install app” or “Add to Home Screen”.');
      return;
    }
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setInstallPrompt(null);
  };

  const isActive = (path) => location.pathname === path;

  return (
    <>
    <nav className="navbar" lang={languageCode}>
      <Link to="/" className="nav-brand">
        <img
          className="nav-brand-icon nav-brand-logo"
          src={`${import.meta.env.BASE_URL}mahi-logo.svg`}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <span className="nav-brand-name">Mahi</span>
        <span className="nav-brand-caption">VOICE FORMS</span>
      </Link>

      <button
        type="button"
        className={`mobile-menu-toggle ${mobileMenuOpen ? 'is-open' : ''}`}
        onClick={() => setMobileMenuOpen((open) => !open)}
        aria-label={t(mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu')}
        aria-expanded={mobileMenuOpen}
        aria-controls="primary-navigation"
      >
        <span className="material-symbols-outlined" aria-hidden="true">menu_open</span>
      </button>

      <div id="primary-navigation" className={`nav-links ${mobileMenuOpen ? 'is-open' : ''}`}>
        {isAuthenticated ? (
          <>
            <div className="nav-primary-links">
              <Link to="/dashboard" onClick={closeMobileMenu} className={`nav-link ${isActive('/dashboard') ? 'active' : ''}`}>
                <Icon name="gauge" /> <span>{t('Dashboard')}</span>
              </Link>
              <Link to="/forms" onClick={closeMobileMenu} className={`nav-link ${isActive('/forms') ? 'active' : ''}`}>
                <Icon name="file" /> <span>{t('Forms')}</span>
              </Link>
              <Link to="/support/report" onClick={closeMobileMenu} className={`nav-link ${isActive('/support/report') ? 'active' : ''}`}>
                <Icon name="warning" /> <span>{t('Report an issue')}</span>
              </Link>

              {/* Admin or Form Manager access */}
              {(user?.role === 'admin' || user?.role === 'form_manager') && (
                <Link to="/admin" onClick={closeMobileMenu} className={`nav-link ${isActive('/admin') ? 'active' : ''}`}>
                  <Icon name="sliders" /> <span>{t('Management')}</span>
                </Link>
              )}
            </div>

            <div className="nav-user">
              <label className="nav-language-control">
                <span>{t('Language')}</span>
                <select value={user?.preferred_language || 'en-IN'} onChange={handleLanguageChange} aria-label="Preferred language">
                  {SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
                </select>
              </label>
              <div className="nav-user-badge">
                <span className="nav-user-avatar"><Icon name="user" /></span>
                <span className="nav-user-name">{user?.name}</span>
                <span className={`user-role-badge role-${user?.role}`}>{user?.role}</span>
              </div>
              <button onClick={handleLogout} className="btn btn-secondary nav-logout">
                <Icon name="logout" /> <span>{t('Logout')}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="nav-primary-links nav-auth-links">
            <Link to="/login" onClick={closeMobileMenu} className="btn btn-secondary">
              {t('Login')}
            </Link>
            <Link to="/register" onClick={closeMobileMenu} className="btn btn-primary">
              {t('Register')}
            </Link>
          </div>
        )}
      </div>
    </nav>
    {!isInstalled && (
      <button type="button" className="btn btn-primary nav-install nav-install-floating" onClick={handleInstall}>
        <Icon name="download" /> <span>{t('Install app')}</span>
      </button>
    )}
    </>
  );
}
