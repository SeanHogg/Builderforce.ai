'use client';

import { useState } from 'react';

type Props = {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  style?: React.CSSProperties;
};

export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
  minLength,
  style,
}: Props) {
  const [visible, setVisible] = useState(false);

  const focusIn = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--coral-bright)';
    e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)';
  };
  const focusOut = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--border-subtle)';
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        onFocus={focusIn}
        onBlur={focusOut}
        style={{ ...style, paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          top: '50%',
          right: 8,
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          padding: 6,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
        }}
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
