import React from 'react';
import { getFieldTypeLabel } from '../utils/formatters';
import { parseOptions } from '../utils/options';
import Icon from './Icon';

export default function QuestionCard({
  currentField,
  totalFields,
  question,
  fieldType,
  options,
  onReplayAudio,
  isSpeaking,
  translate = (value) => value,
}) {
  const optionsList = parseOptions(options);

  return (
    <div className="question-header-content">
      <div className="question-step">
        {translate('Question')} {currentField} {translate('of')} {totalFields}
      </div>

      <div className="question-text-row">
        <h2 className="question-text">{question}</h2>
        <button
          className="speak-again-btn"
          onClick={onReplayAudio}
          title={translate('Listen to question again')}
          aria-label={translate('Replay Question Audio')}
        >
          <Icon name="volume" />
        </button>
      </div>

      <div className="question-meta">
        <span>{translate('Type:')} {translate(getFieldTypeLabel(fieldType))}</span>
      </div>

      {fieldType === 'choice' && optionsList.length > 0 && (
        <div className="question-options-hint">
          {optionsList.map((opt, idx) => (
            <span key={idx} className="option-pill">
              {opt}
            </span>
          ))}
        </div>
      )}

      {fieldType === 'yes_no' && (
        <div className="question-options-hint">
          <span className="option-pill">{translate('Yes')}</span>
          <span className="option-pill">{translate('No')}</span>
        </div>
      )}
    </div>
  );
}
