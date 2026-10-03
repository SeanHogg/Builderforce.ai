import { getTranslations } from 'next-intl/server';
import { ClosePopupWindow } from './ClosePopupWindow';

export const runtime = 'edge';

/**
 * Where a sign-in pop-up lands once its session is stored. The page that opened
 * it has already signed in from that storage write (`AuthProvider` listens), so
 * all that is left is to close. A browser that refuses `close()` (the opener link
 * was severed on the way through the provider) leaves this message instead.
 */
export default async function SignInPopupDonePage() {
  const t = await getTranslations('authCallback');
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-deep)', color: 'var(--text-primary)', textAlign: 'center' }}>
      <ClosePopupWindow />
      <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-section)' }}>{t('popupDoneTitle')}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('popupDoneBody')}</p>
      </div>
    </main>
  );
}
