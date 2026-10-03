'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Where a sign-in pop-up lands once its session is stored. The page that opened
 * it has already signed in from that storage write (`AuthProvider` listens), so
 * all that is left is to close. A browser that refuses `close()` (the opener link
 * was severed on the way through the provider) leaves this message instead.
 */
export default function SignInPopupDonePage() {
  const t = useTranslations('authCallback');

  useEffect(() => {
    window.close();
  }, []);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-deep)', color: 'var(--text-primary)', textAlign: 'center' }}>
      <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-section)' }}>{t('popupDoneTitle')}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('popupDoneBody')}</p>
      </div>
    </main>
  );
}
