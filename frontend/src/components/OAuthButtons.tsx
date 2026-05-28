'use client';

import { useSearchParams } from 'next/navigation';
import { getOAuthUrl } from '@/lib/auth';

const PROVIDERS = [
  { provider: 'google',    label: 'Continue with Google',    icon: 'G' },
  { provider: 'github',    label: 'Continue with GitHub',    icon: '⌥' },
  { provider: 'linkedin',  label: 'Continue with LinkedIn',  icon: 'in' },
  { provider: 'microsoft', label: 'Continue with Microsoft', icon: 'M' },
];

/**
 * Shared OAuth provider buttons for both /login and /register.
 * The same backend endpoint provisions a new account on first sign-in,
 * so this block serves login and signup identically.
 */
export default function OAuthButtons() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';

  return (
    <>
      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      </div>

      {/* OAuth buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {PROVIDERS.map(({ provider, label, icon }) => (
          <button
            key={provider}
            type="button"
            onClick={() => { window.location.href = getOAuthUrl(provider, next); }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: '0.875rem',
              transition: 'border-color 0.2s',
            }}
            onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--coral-bright)'; }}
            onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'; }}
          >
            <span style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', background: 'var(--bg-surface)', borderRadius: 4, flexShrink: 0 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
