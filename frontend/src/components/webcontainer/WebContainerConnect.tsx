'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/**
 * The WebContainer "connect" handshake — ONE body for both connect routes.
 *
 * `/webcontainer/connect` and `/webcontainer/connect/<id>` were two copies of this
 * component, byte for byte. The routes must stay two (`@webcontainer/api`'s
 * `setupConnect()` recognises the bare pathname, and a preview opened in a new tab
 * redirects to the id-suffixed one), but what they run is the same: call
 * `setupConnect()` so the tab can talk to the IDE that opened it, and say how that
 * went. Both routes are served without `COOP: same-origin` (see next.config.js).
 * @see https://github.com/stackblitz/webcontainer-core/issues/1725
 */
export function WebContainerConnect() {
  const t = useTranslations('webcontainerConnect');
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<'connecting' | 'ok' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { setupConnect } = await import('@webcontainer/api/connect');
        setupConnect({ editorOrigin: typeof window !== 'undefined' ? window.location.origin : undefined });
        if (!cancelled) setStatus('ok');
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [errorMessage]);

  const style = {
    padding: 24,
    fontSize: 'var(--font-size-body)',
    color: status === 'error' ? 'var(--error-text)' : 'var(--text-secondary)',
  } as const;

  if (status === 'ok') return <div style={style}>{t('connected')}</div>;
  if (status === 'error') return <div role="alert" style={style}>{t('failed', { error: error ?? '' })}</div>;
  return <div role="status" style={style}>{t('connecting')}</div>;
}
