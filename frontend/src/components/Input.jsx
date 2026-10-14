import React from 'react';
import Icon from './Icon';

export default function Input({
  label,
  id,
  type = 'text',
  value,
  onChange,
  placeholder = '',
  required = false,
  error = '',
  as = 'input', // 'input', 'textarea', 'select'
  children,
  className = '',
  leftIcon = null,
  rightAdornment = null,
  ...props
}) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label} {required && <span style={{ color: 'var(--accent-rose)' }}>*</span>}
        </label>
      )}

      {as === 'textarea' ? (
        <textarea
          id={inputId}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="form-textarea"
          rows={3}
          {...props}
        />
      ) : as === 'select' ? (
        <select
          id={inputId}
          value={value}
          onChange={onChange}
          required={required}
          className="form-select"
          {...props}
        >
          {children}
        </select>
      ) : leftIcon || rightAdornment ? (
        <div className="login-input-shell">
          {leftIcon && <Icon name={leftIcon} className="login-field-icon" />}
          <input
            id={inputId}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            required={required}
            className={`form-input ${leftIcon ? 'has-left-icon' : ''} ${rightAdornment ? 'has-right-adornment' : ''}`}
            {...props}
          />
          {rightAdornment}
        </div>
      ) : (
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="form-input"
          {...props}
        />
      )}

      {error && <span className="form-error-text">{error}</span>}
    </div>
  );
}
