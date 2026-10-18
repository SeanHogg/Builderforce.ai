import type { CSSProperties, FocusEvent, ReactNode } from 'react';

/**
 * The pieces of the sign-in and sign-up forms that were written twice, verbatim:
 * the field and label chrome, the glass card the form sits in, the error banner
 * and the primary submit button. Colour, radius and type are theme tokens only.
 */

export const authInputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: '11px 14px',
  fontSize: '0.9rem',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontFamily: 'var(--font-body)',
};

export const authLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
  fontFamily: 'var(--font-display)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

export const authFocusIn = (e: FocusEvent<HTMLInputElement>) => {
  e.currentTarget.style.borderColor = 'var(--coral-bright)';
  e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)';
};

export const authFocusOut = (e: FocusEvent<HTMLInputElement>) => {
  e.currentTarget.style.borderColor = 'var(--border-subtle)';
  e.currentTarget.style.boxShadow = 'none';
};

export function AuthFormCard({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-xl)',
      padding: '32px 28px',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 16px 48px var(--shadow-coral-soft)',
    }}>
      {children}
    </div>
  );
}

export function AuthErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 'var(--radius-lg)', padding: '10px 14px', fontSize: '0.875rem' }}>
      {message}
    </div>
  );
}

export function AuthSubmitButton({ disabled, busy, children }: { disabled: boolean; busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      style={{
        width: '100%',
        background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
        color: 'var(--text-on-accent)',
        border: 'none',
        borderRadius: 'var(--radius-lg)',
        padding: '13px',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '0.95rem',
        cursor: busy ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity 0.2s, transform 0.2s, box-shadow 0.2s',
        boxShadow: '0 6px 20px var(--shadow-coral-mid)',
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </button>
  );
}
