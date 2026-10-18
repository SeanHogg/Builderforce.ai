'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { AUTH_API_URL } from '@/lib/auth';
import { AuthStatusScreen, completeTokenSignIn, type SignInExchange } from '@/components/account/AuthStatusScreen';
import { useErrorText } from '@/i18n/useErrorMessage';

export default function MagicLinkVerifyPage() {
  const t = useTranslations('authCallback');
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const errorText = useErrorText();

  // Derive initial state from URL so no synchronous setState inside the effect
  const [errorMsg, setErrorMsg] = useState<string | null>(!token ? t('magicLinkNoToken') : null);

  useEffect(() => {
    if (!token) return;

    fetch(`${AUTH_API_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`)
      .then((res) => res.json() as Promise<SignInExchange & { error?: string }>)
      .then((data) => completeTokenSignIn(data, data.error ?? t('magicLinkInvalid')))
      .catch((err: unknown) => {
        setErrorMsg(errorText(err));
      });
  }, [searchParams, token, errorText, t]);

  return (
    <AuthStatusScreen
      loadingLabel={t('magicLinkVerifying')}
      failure={errorMsg !== null ? { title: t('magicLinkTitle'), message: errorMsg, backLabel: t('backToLogin') } : null}
    />
  );
}
