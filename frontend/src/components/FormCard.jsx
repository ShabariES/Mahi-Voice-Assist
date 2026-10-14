import React from 'react';
import { Link } from 'react-router-dom';
import Button from './Button';
import Icon from './Icon';

export default function FormCard({ form, onStart, onManage, translate = (value) => value }) {
  const questionCount = form.total_fields || 0;

  return (
    <div className="form-card">
      <div>
        <h3 className="form-card-title">{translate(form.name)}</h3>
        <p className="form-card-desc">{translate(form.description || 'No description provided.')}</p>
      </div>

      <div>
        <div className="form-card-meta">
          <span className="field-badge">{questionCount} {translate(questionCount === 1 ? 'Question' : 'Questions')}</span>
          <span><Icon name="microphone" /> {translate('Voice ready')}</span>
        </div>

        <div className="form-card-actions">
          <Button
            variant="primary"
            onClick={() => onStart(form.id)}
            style={{ flex: 1 }}
          >
            <Icon name="microphone" /> {translate('Start form')}
          </Button>

          {onManage && (
            <Link to={`/forms/${form.id}`}>
              <Button variant="secondary">{translate('View')}</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
