import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { formService } from '../services/formService';
import { useAuth } from '../context/AuthContext';
import { capitalize, getFieldTypeLabel, formatDate } from '../utils/formatters';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { translationService } from '../services/translationService';
import { parseOptions } from '../utils/options';
import '../styles/forms.css';

export default function FormDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('fields'); // 'fields' or 'submissions'
  const [translations, setTranslations] = useState({});
  const preferredLanguage = user?.preferred_language || 'en-IN';
  const translate = (text) => translations[text] || text;

  const canManage = user?.role === 'admin' || user?.role === 'form_manager';

  useEffect(() => {
    const loadData = async () => {
      try {
        const formData = await formService.getFormById(id);
        setForm(formData);

        if (canManage) {
          try {
            const subData = await formService.getFormSubmissions(id);
            setSubmissions(subData);
          } catch {}
        }
      } catch (err) {
        console.error('Failed to load form details:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, canManage]);

  useEffect(() => {
    if (!form) return undefined;
    let cancelled = false;
    const localize = async () => {
      try {
        const ui = ['Form Not Found', 'Back to Forms', 'Start voice form', 'Form details', 'Form Fields', 'Submissions', 'Field Name', 'Question (Spoken aloud)', 'Type', 'Options / Allowed Values', 'Required', 'Yes', 'No', 'Options', 'No submissions recorded yet for this form.'];
        const content = [...new Set([form.name, form.description || '', ...form.fields.flatMap((field) => [field.question, capitalize(field.field_name.replace(/[_-]+/g, ' ')), ...parseOptions(field.options)])].filter(Boolean))];
        const source = form.language_code || 'en-IN';
        const [uiValues, contentValues] = await Promise.all([
          preferredLanguage === 'en-IN' ? Promise.resolve(ui) : translationService.translateTexts(ui, 'en-IN', preferredLanguage),
          translationService.translateTexts(content, source, preferredLanguage),
        ]);
        if (cancelled) return;
        const result = Object.fromEntries(ui.map((value, index) => [value, uiValues[index] || value]));
        content.forEach((value, index) => { result[value] = contentValues[index] || value; });
        setTranslations(result);
      } catch {
        if (!cancelled) setTranslations({});
      }
    };
    localize();
    return () => { cancelled = true; };
  }, [form, preferredLanguage]);

  const handleStart = async () => {
    try {
      const session = await formService.startSession(id);
      navigate(`/forms/${id}/fill?session=${session.id}`);
    } catch (err) {
      alert(err.response?.data?.detail || 'Could not start session.');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h2>{translate('Form Not Found')}</h2>
        <Link to="/forms">
          <Button variant="secondary" style={{ marginTop: '1rem' }}>{translate('Back to Forms')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="form-detail-header">
        <div>
          <Link to="/forms" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'inline-block' }}>
            ← {translate('Back to Forms')}
          </Link>
          <h1 className="dashboard-title">{translate(form.name)}</h1>
          <p className="dashboard-desc">{translate(form.description || '')}</p>
        </div>

        <Button variant="primary" onClick={handleStart}>
          <Icon name="microphone" /> {translate('Start voice form')}
        </Button>
      </div>

      {canManage && (
        <div className="form-detail-tabs" role="tablist" aria-label={translate('Form details')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'fields'}
            className={`form-detail-tab ${activeTab === 'fields' ? 'active' : ''}`}
            onClick={() => setActiveTab('fields')}
          >
            {translate('Form Fields')} ({form.fields?.length || 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'submissions'}
            className={`form-detail-tab ${activeTab === 'submissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('submissions')}
          >
            {translate('Submissions')} ({submissions.length})
          </button>
        </div>
      )}

      {activeTab === 'fields' ? (
        <>
        <div className="card detail-data-table" style={{ padding: '0.5rem 1rem' }}>
          <table className="recent-sessions-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{translate('Field Name')}</th>
                <th>{translate('Question (Spoken aloud)')}</th>
                <th>{translate('Type')}</th>
                <th>{translate('Options / Allowed Values')}</th>
                <th>{translate('Required')}</th>
              </tr>
            </thead>
            <tbody>
              {form.fields.map((f, idx) => (
                <tr key={f.id}>
                  <td>{f.field_order || idx + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{translate(capitalize(f.field_name.replace(/[_-]+/g, ' ')))}</td>
                  <td>"{translate(f.question)}"</td>
                  <td>
                    <span className="field-badge">{translate(getFieldTypeLabel(f.field_type))}</span>
                  </td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    {parseOptions(f.options).map(translate).join(', ') || '—'}
                  </td>
                  <td>{translate(f.required ? 'Yes' : 'No')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-mobile-list">
          {form.fields.map((f, idx) => (
            <article className="card detail-mobile-card" key={f.id}>
              <div className="detail-mobile-topline">
                <span className="detail-mobile-kicker">FIELD {f.field_order || idx + 1}</span>
                <span className="field-badge">{translate(getFieldTypeLabel(f.field_type))}</span>
              </div>
              <h2>{translate(capitalize(f.field_name.replace(/[_-]+/g, ' ')))}</h2>
              <span className="detail-mobile-field-key">{f.field_name}</span>
              <p className="detail-field-question">“{translate(f.question)}”</p>
              {f.options && <p className="detail-field-options"><span>{translate('Options')}</span>{parseOptions(f.options).map(translate).join(', ')}</p>}
              <div className="detail-field-required"><span>{translate('Required')}</span><strong>{translate(f.required ? 'Yes' : 'No')}</strong></div>
            </article>
          ))}
        </div>
        </>
      ) : (
        <>
        <div className="card detail-data-table" style={{ padding: '0.5rem 1rem' }}>
          {submissions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              {translate('No submissions recorded yet for this form.')}
            </div>
          ) : (
            <table className="recent-sessions-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Answers Provided</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.session_id}>
                    <td>#{sub.session_id}</td>
                    <td>
                      <div><strong>{sub.user_name}</strong></div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{sub.user_email}</div>
                    </td>
                    <td>
                      <span className={`status-badge status-${sub.status}`}>
                        {sub.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {sub.answers.map((ans) => (
                          <div key={ans.id} style={{ fontSize: '0.85rem' }}>
                            <strong style={{ color: 'var(--text-main)' }}>{ans.field_name}:</strong> {ans.answer}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>{formatDate(sub.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {submissions.length > 0 && (
          <div className="detail-mobile-list">
            {submissions.map((sub) => (
              <article className="card detail-mobile-card" key={sub.session_id}>
                <div className="detail-mobile-topline">
                  <span className="detail-mobile-kicker">SESSION #{sub.session_id}</span>
                  <span className={`status-badge status-${sub.status}`}>{sub.status.replace('_', ' ')}</span>
                </div>
                <h2>{sub.user_name}</h2>
                <p className="detail-mobile-email">{sub.user_email}</p>
                <div className="detail-submission-answers">
                  {sub.answers.map((ans) => (
                    <p key={ans.id}><strong>{ans.field_name}</strong><span>{ans.answer}</span></p>
                  ))}
                </div>
                <div className="detail-field-required"><span>Submitted</span><strong>{formatDate(sub.created_at)}</strong></div>
              </article>
            ))}
          </div>
        )}
        </>
      )}
    </div>
  );
}
