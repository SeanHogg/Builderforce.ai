'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { AUTH_API_URL, persistSession, resolveAndSelectTenant } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/safeRedirect';
import type { AuthUser } from '@/lib/types';

/** Maps the server's `?error=` code to a translation key in the `authCallback` namespace. */
const ERROR_KEYS: Record<string, string> = {
  missing_params: 'errorMissingParams',
  invalid_state: 'errorInvalidState',
  auth_failed: 'errorAuthFailed',
  no_email: 'errorNoEmail',
  account_not_found: 'errorAccountNotFound',
  account_suspended: 'errorAccountSuspended',
  provider_unavailable: 'errorProviderUnavailable',
  already_linked_other: 'errorAlreadyLinkedOther',
};

export default function OAuthCallbackPage() {
  const t = useTranslations('authCallback');
  const searchParams = useSearchParams();

  const errorParam = searchParams.get('error');
  // M6: the OAuth callback now delivers a short-lived, single-purpose exchange
  // `code` (never the 24h session JWT). The code is swapped via POST for the
  // real token, so the session JWT is never placed in a URL.
  const code = searchParams.get('code');

  // Derive initial error from URL params so no synchronous setState inside effects
  const [error, setError] = useState<string | null>(() => {
    if (errorParam) return t(ERROR_KEYS[errorParam] ?? 'errorUnexpected');
    if (!code) return t('errorNoCode');
    return null;
  });

  useEffect(() => {
    if (error || !code) return;

    // Defense-in-depth: strip the single-use code from the URL immediately so it
    // can't leak to analytics (GTM captures page_location), the Referer header,
    // or the browser history entry.
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/auth/callback');
    }

    // Exchange the code for the real session token via POST — the token stays out
    // of the URL entirely (M6). The exchange also returns the (server-validated)
    // redirect target.
    fetch(`${AUTH_API_URL}/api/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('exchange_failed');
        return res.json() as Promise<{ token?: string; user?: AuthUser; redirect?: string }>;
      })
      .then(async (data) => {
        if (!data.token || !data.user) throw new Error('exchange_failed');
        persistSession(data.token, data.user);
        await resolveAndSelectTenant(data.token);
        // The onboarding gate (OnboardingGate) forces the Build-vs-Hired role
        // choice for accounts that never picked one, so no special-casing here.
        // safeRedirectPath is defence-in-depth — the server already validated it.
        window.location.href = safeRedirectPath(data.redirect);
      })
      .catch(() => {
        setError(t('errorProfile'));
      });
  }, [code, error, t]);

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 20,
            padding: '40px 32px',
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Image
            src="/agentHost.png"
            alt=""
            width={48}
            height={48}
            style={{ marginBottom: 16, opacity: 0.5 }}
          />
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            {t('title')}
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
            {error}
          </p>
          <a
            href="/login"
            style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              borderRadius: 10,
              padding: '10px 24px',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            {t('backToLogin')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <Image
          src="/agentHost.png"
          alt=""
          width={56}
          height={56}
          style={{
            filter: 'drop-shadow(0 0 16px var(--logo-glow))',
            animation: 'float 4s ease-in-out infinite',
            marginBottom: 16,
          }}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('signingIn')}</p>
      </div>
    </div>
  );
}
