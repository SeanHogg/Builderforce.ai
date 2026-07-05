'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { resendVerificationCode } from '@/lib/auth';

interface EmailVerificationStepProps {
  /** Address the code was sent to — shown in the copy and submitted with the code. */
  email: string;
  /** Called once the code verifies and the session is set (navigate from here). */
  onVerified: () => void | Promise<void>;
  /** Optional "use a different email" escape hatch (e.g. back to the register form). */
  onChangeEmail?: () => void;
}

/**
 * Shared email-OTP entry step used by both the register and login flows (a
 * half-finished signup that tries to log in lands here too). Self-contained:
 * verifies via AuthContext, resends via the API, and handles the "keep me signed in
 * for 30 days" device-trust option. Fully localized + theme/responsive.
 */
export default function EmailVerificationStep({ email, onVerified, onChangeEmail }: EmailVerificationStepProps) {
  const t = useTranslations('emailVerify');
  const { verifyEmail } = useAuth();

  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const errorFor = (reason: string | undefined): string => {
    switch (reason) {
      case 'expired': return t('errExpired');
      case 'too_many': return t('errTooMany');
      case 'none': return t('errNone');
      case 'invalid': return t('errInvalid');
      default: return t('errGeneric');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await verifyEmail(email, code.trim(), trustDevice);
      await onVerified();
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      setError(errorFor(reason));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setResent(false);
    setResending(true);
    try {
      const { cooldownSeconds } = await resendVerificationCode(email);
      if (cooldownSeconds) {
        setError(t('resendCooldown', { seconds: cooldownSeconds }));
      } else {
        setResent(true);
      }
    } catch {
      setError(t('errGeneric'));
    } finally {
      setResending(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 10,
    padding: '14px',
    fontSize: '1.4rem',
    letterSpacing: '0.5em',
    textAlign: 'center',
    fontWeight: 700,
    outline: 'none',
    fontFamily: 'var(--font-display)',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 20,
      padding: '32px 28px',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 16px 48px var(--shadow-coral-soft)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }} aria-hidden>✉️</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          {t('title')}
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {t('subtitle')}
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>
          {email}
        </p>
      </div>

      <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label htmlFor="verification-code" style={{
            display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: 8, fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            {t('codeLabel')}
          </label>
          <input
            id="verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            style={inputStyle}
            required
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={e => setTrustDevice(e.target.checked)}
            style={{ accentColor: 'var(--coral-bright)' }}
          />
          <span>{t('trustDevice')}</span>
        </label>

        {error && (
          <div style={{ background: 'var(--error-bg, rgba(239,68,68,0.12))', border: '1px solid var(--error-border, rgba(239,68,68,0.4))', color: 'var(--error-text, #f87171)', borderRadius: 10, padding: '10px 14px', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}
        {resent && !error && (
          <div style={{ color: 'var(--coral-bright)', fontSize: '0.875rem', fontWeight: 600, textAlign: 'center' }}>
            {t('resent')}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || code.length < 6}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: '#fff', border: 'none', borderRadius: 12, padding: '13px',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem',
            cursor: isLoading ? 'wait' : 'pointer',
            opacity: (isLoading || code.length < 6) ? 0.5 : 1,
            transition: 'opacity 0.2s, box-shadow 0.2s',
            boxShadow: '0 6px 20px var(--shadow-coral-mid)',
            letterSpacing: '0.02em',
          }}
        >
          {isLoading ? t('verifying') : t('verifyButton')}
        </button>
      </form>

      <div style={{ marginTop: 18, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            fontSize: '0.875rem', cursor: 'pointer', textDecoration: 'underline',
            opacity: resending ? 0.5 : 1, fontFamily: 'var(--font-body)',
          }}
        >
          {resending ? t('resending') : t('resend')}
        </button>
        {onChangeEmail && (
          <button
            type="button"
            onClick={onChangeEmail}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}
          >
            {t('wrongEmail')}
          </button>
        )}
      </div>
    </div>
  );
}
