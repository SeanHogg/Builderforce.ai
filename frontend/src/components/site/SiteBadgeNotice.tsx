'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePlanFeature } from '@/lib/useConsumption';

/**
 * Tells a free-plan creator, where they manage a published site, that it carries
 * the "Made with Builderforce.ai" badge, and that upgrading removes it. The badge
 * itself is added server-side (`api/src/application/ide/siteAttribution.ts`).
 *
 * Decides its own visibility from the shared plan snapshot: renders only when the
 * server says the tenant is NOT entitled to `removeBranding`. Null (still loading)
 * renders nothing, so a paying tenant never sees the upsell flash.
 */
export function SiteBadgeNotice() {
  const t = useTranslations('siteBadge');
  const canRemove = usePlanFeature('removeBranding');
  if (canRemove !== false) return null;

  return (
    <p
      style={{
        margin: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '4px 8px',
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--font-size-small)',
      }}
    >
      <span>{t('body')}</span>
      <Link href="/pricing" style={{ color: 'var(--accent)', fontWeight: 600 }}>
        {t('upgrade')}
      </Link>
    </p>
  );
}
