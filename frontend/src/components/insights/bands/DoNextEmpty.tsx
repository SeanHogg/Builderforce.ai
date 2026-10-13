/**
 * The "Do next" column (PRD 33 §4.1, 28%) before S4e fills it with ranked
 * fixes: an honest empty state, never a placeholder card.
 */

import { useTranslations } from 'next-intl';

export function DoNextEmpty() {
  const t = useTranslations('insights.overview');
  return (
    <section aria-labelledby="insights-next-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <h3 id="insights-next-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('doNextTitle')}</h3>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('doNextEmpty')}</p>
    </section>
  );
}
