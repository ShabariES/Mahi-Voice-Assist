import React from 'react';

export default function Button({
  children,
  type = 'button',
  variant = 'primary', // 'primary', 'secondary', 'outline', 'danger'
  loading = false,
  disabled = false,
  onClick,
  className = '',
  style = {},
  ...props
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      style={style}
      {...props}
    >
      {loading ? (
        <>
          <div className="spinner" />
          <span>Processing...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
