import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formService } from '../services/formService';
import FormCard from '../components/FormCard';
import { useAuth } from '../context/AuthContext';
import { translationService } from '../services/translationService';
import '../styles/forms.css';

export default function Forms() {
  const { user } = useAuth();
  const preferredLanguage = user?.preferred_language || 'en-IN';
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [translations, setTranslations] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const fetchForms = async () => {
      try {
        const data = await formService.getForms();
        setForms(data);
      } catch (err) {
        setError('Failed to load forms. Please ensure backend is running.');
      } finally {
        setLoading(false);
      }
    };
    fetchForms();
  }, []);

  useEffect(() => {
    if (!forms.length || preferredLanguage === 'en-IN') {
      setTranslations({});
      return undefined;
    }
    let cancelled = false;
    const localize = async () => {
      try {
        const ui = ['Available Voice Forms', 'Choose a form below to start filling it using your microphone and natural voice.', 'No forms available right now.', 'Question', 'Questions', 'Voice ready', 'Start form', 'View', 'No description provided.'];
        const result = {};
        const uiValues = await translationService.translateTexts(ui, 'en-IN', preferredLanguage);
        ui.forEach((value, index) => { result[value] = uiValues[index] || value; });
        for (const form of forms) {
          const source = form.language_code || 'en-IN';
          const values = [form.name, form.description || ''];
          const translated = await translationService.translateTexts(values, source, preferredLanguage);
          values.forEach((value, index) => { result[value] = translated[index] || value; });
        }
        if (!cancelled) setTranslations(result);
      } catch {
        if (!cancelled) setTranslations({});
      }
    };
    localize();
    return () => { cancelled = true; };
  }, [forms, preferredLanguage]);

  const translate = (text) => translations[text] || text;


  const handleStartForm = async (formId) => {
    try {
      const session = await formService.startSession(formId);
      navigate(`/forms/${formId}/fill?session=${session.id}`);
    } catch (err) {
      alert(err.response?.data?.detail || 'Could not start form session.');
    }
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="dashboard-title">{translate('Available Voice Forms')}</h1>
          <p className="dashboard-desc">
            {translate('Choose a form below to start filling it using your microphone and natural voice.')}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" style={{ width: '40px', height: '40px' }} />
        </div>
      ) : forms.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>{translate('No forms available right now.')}</p>
        </div>
      ) : (
        <div className="forms-grid">
          {forms.map((form) => (
            <FormCard
              key={form.id}
              form={form}
              onStart={handleStartForm}
              onManage={true}
              translate={translate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
