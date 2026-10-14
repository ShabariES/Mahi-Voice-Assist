import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formService } from '../services/formService';
import { formatDate } from '../utils/formatters';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { translationService } from '../services/translationService';
import '../styles/dashboard.css';

export default function Dashboard() {
  const { user } = useAuth();
  const languageCode = user?.preferred_language || 'en-IN';
  const [forms, setForms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [translations, setTranslations] = useState({});
  const t = (text) => translations[text] || text;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [formsData, sessionsData] = await Promise.all([
          formService.getForms(),
          formService.getMySessions()
        ]);
        setForms(formsData);
        setSessions(sessionsData);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (languageCode === 'en-IN') {
      setTranslations({});
      return undefined;
    }
    const uiTexts = [
      'YOUR MAHI WORKSPACE', 'A simpler way to', 'get things', 'done.', 'Welcome back,',
      'Mahi asks, listens, and lets you review every answer before it is saved.', 'Start a form',
      'Voice form feature', 'Your voice, your pace', 'Answer one question at a time. Edit anything before moving on.',
      'Available Forms', 'Completed Sessions', 'In Progress', 'Your Recent Form Sessions', 'Browse All Forms',
      "You haven't filled out any forms yet.", 'Start Your First Voice Form', 'Form Name', 'Status',
      'Current Step', 'Started Date', 'Action', 'Completed', 'All done', 'Question', 'of',
      'View Answers', 'Resume Voice', 'FORM SESSION', 'Current step', 'Started',
    ];
    const localize = async () => {
      try {
        const uiValues = await translationService.translateTexts(uiTexts, 'en-IN', languageCode);
        const result = Object.fromEntries(uiTexts.map((value, index) => [value, uiValues[index] || value]));
        await Promise.all(sessions.map(async (session) => {
          if (!session.form_name) return;
          const source = session.form_language_code || 'en-IN';
          const [name] = await translationService.translateTexts([session.form_name], source, languageCode);
          result[session.form_name] = name || session.form_name;
        }));
        if (!cancelled) setTranslations(result);
      } catch {
        if (!cancelled) setTranslations({});
      }
    };
    localize();
    return () => { cancelled = true; };
  }, [languageCode, sessions]);

  const completedCount = sessions.filter((s) => s.status === 'completed').length;
  const inProgressCount = sessions.filter((s) => s.status === 'in_progress').length;

  return (
    <div>
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow"><Icon name="sparkle" /> {t('YOUR MAHI WORKSPACE')}</span>
          <h1 className="dashboard-title">{t('A simpler way to')}<br />{t('get things')} <span>{t('done.')}</span></h1>
          <p className="dashboard-desc">
            {t('Welcome back,')} {user?.name}. {t('Mahi asks, listens, and lets you review every answer before it is saved.')}
          </p>
          <Link to="/forms" className="dashboard-hero-action">
            <Button variant="primary"><Icon name="microphone" /> {t('Start a form')} <Icon name="arrowRight" /></Button>
          </Link>
        </div>
        <div className="dashboard-hero-note" aria-label={t('Voice form feature')}>
          <span className="dashboard-hero-note-icon"><Icon name="microphone" /></span>
          <div>
            <strong>{t('Your voice, your pace')}</strong>
            <p>{t('Answer one question at a time. Edit anything before moving on.')}</p>
          </div>
          <span className="dashboard-hero-orbit orbit-one" />
          <span className="dashboard-hero-orbit orbit-two" />
        </div>
      </section>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><Icon name="file" /></div>
          <div className="stat-info">
            <span className="stat-value">{forms.length}</span>
            <span className="stat-label">{t('Available Forms')}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Icon name="circleCheck" />
          </div>
          <div className="stat-info">
            <span className="stat-value">{completedCount}</span>
            <span className="stat-label">{t('Completed Sessions')}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Icon name="clock" />
          </div>
          <div className="stat-info">
            <span className="stat-value">{inProgressCount}</span>
            <span className="stat-label">{t('In Progress')}</span>
          </div>
        </div>
      </div>

      <div className="section-header">
        <h2 className="section-title">{t('Your Recent Form Sessions')}</h2>
        <Link to="/forms">
          <Button variant="secondary" style={{ fontSize: '0.85rem' }}>
            {t('Browse All Forms')} <Icon name="arrowRight" />
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {t("You haven't filled out any forms yet.")}
          </p>
          <Link to="/forms">
            <Button variant="primary"><Icon name="microphone" /> {t('Start Your First Voice Form')}</Button>
          </Link>
        </div>
      ) : (
        <>
        <div className="card dashboard-session-table" style={{ padding: '0.5rem 1rem' }}>
          <table className="recent-sessions-table">
            <thead>
              <tr>
                <th>{t('Form Name')}</th>
                <th>{t('Status')}</th>
                <th>{t('Current Step')}</th>
                <th>{t('Started Date')}</th>
                <th>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((sess) => (
                <tr key={sess.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{t(sess.form_name)}</td>
                  <td>
                    <span className={`status-badge status-${sess.status}`}>
                      {sess.status === 'completed' ? t('Completed') : t('In Progress')}
                    </span>
                  </td>
                  <td>{sess.status === 'completed' ? t('All done') : `${t('Question')} ${sess.current_field} ${t('of')} ${sess.total_fields}`}</td>
                  <td>{formatDate(sess.created_at)}</td>
                  <td>
                    <Link to={`/forms/${sess.form_id}/fill?session=${sess.id}`}>
                      <Button variant={sess.status === 'completed' ? 'secondary' : 'primary'} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                        {sess.status === 'completed' ? t('View Answers') : <><Icon name="microphone" /> {t('Resume Voice')}</>}
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dashboard-session-cards">
          {sessions.map((sess) => (
            <article className="dashboard-session-card card" key={sess.id}>
              <div className="dashboard-session-card-header">
                <div className="dashboard-session-card-name">
                  <span className="dashboard-session-kicker">{t('FORM SESSION')}</span>
                  <h3>{t(sess.form_name)}</h3>
                </div>
                <span className={`status-badge status-${sess.status}`}>
                  {sess.status === 'completed' ? t('Completed') : t('In Progress')}
                </span>
              </div>
              <div className="dashboard-session-details">
                <div>
                  <span>{t('Current step')}</span>
                  <strong>{sess.status === 'completed' ? t('All done') : `${t('Question')} ${sess.current_field} ${t('of')} ${sess.total_fields}`}</strong>
                </div>
                <div>
                  <span>{t('Started')}</span>
                  <strong>{formatDate(sess.created_at)}</strong>
                </div>
              </div>
              <Link to={`/forms/${sess.form_id}/fill?session=${sess.id}`} className="dashboard-session-action">
                <Button variant={sess.status === 'completed' ? 'secondary' : 'primary'}>
                  {sess.status === 'completed' ? t('View Answers') : <><Icon name="microphone" /> {t('Resume Voice')}</>}
                  <Icon name="arrowRight" />
                </Button>
              </Link>
            </article>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
