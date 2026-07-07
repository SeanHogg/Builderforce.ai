'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { isPlanLimitError } from '@/lib/planLimitError';

/**
 * Inline upgrade CTA for a plan-gated insight lens/card. The premium lens routes
 * answer **402 upgrade_required** when the tenant's plan doesn't include
 * `advancedInsights`; the API client turns that into a {@link PlanLimitError}. A
 * lens catches the thrown error and hands it here — if it's a plan-limit error we
 * render an in-place upsell (link to /pricing) instead of a raw error string; any
 * other error falls through to `fallback` (the lens's normal error view).
 *
 * Inline (not a modal) on purpose: the surrounding lens chrome stays visible so
 * the wall reads as "this specific view needs a higher plan", per the product
 * rule of indicating the gate rather than hiding the feature.
 */
export function UpgradeGate({ error, fallback = null }: { error: unknown; fallback?: React.ReactNode }) {
  const t = useTranslations('insights');
  if (!isPlanLimitError(error)) return <>{fallback}</>;

  return (
    <div
      role="region"
      aria-label={t('upgrade.title')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start',
        padding: '20px 22px', borderRadius: 12, border: '1px solid var(--border-subtle)',
        background: 'var(--bg-subtle, rgba(37,99,235,0.06))',
      }}
    >
      <span style={{ fontSize: '1.4rem' }} aria-hidden>🔒</span>
      <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>{t('upgrade.title')}</div>
      <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)', maxWidth: 460 }}>
        {t('upgrade.body', { plan: error.currentPlan })}
      </p>
      <Link
        href="/pricing?upgrade=pro"
        style={{
          marginTop: 4, padding: '8px 16px', borderRadius: 8, textDecoration: 'none',
          background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 600, fontSize: '0.84rem',
        }}
      >
        {t('upgrade.cta')}
      </Link>
    </div>
  );
}
