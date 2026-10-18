'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { AUTH_API_URL } from '@/lib/auth';
import { AuthStatusScreen, completeTokenSignIn, type SignInExchange } from '@/components/account/AuthStatusScreen';

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
        return res.json() as Promise<SignInExchange>;
      })
      .then((data) => completeTokenSignIn(data, 'exchange_failed'))
      .catch(() => {
        setError(t('errorProfile'));
      });
  }, [code, error, t]);

  return (
    <AuthStatusScreen
      loadingLabel={t('signingIn')}
      failure={error ? { title: t('title'), message: error, backLabel: t('backToLogin') } : null}
    />
  );
}
