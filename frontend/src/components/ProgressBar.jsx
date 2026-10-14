import React from 'react';
import { formatPercent } from '../utils/formatters';

export default function ProgressBar({ current, total, isCompleted = false, translate = (value) => value }) {
  const percent = isCompleted ? 100 : formatPercent(current, total);

  return (
    <div className="progress-container">
      <div className="progress-header">
        <span>{translate('Form Progress')}</span>
        <span>{percent}%</span>
      </div>
      <div className="progress-bar-bg">
        <div
          className="progress-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
