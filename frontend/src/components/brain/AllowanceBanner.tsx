'use client';

/**
 * Token-allowance banner for the Brain composer.
 *
 * The allowance is what silently degrades a chat: once the monthly cap is spent
 * the gateway 429s (`plan_token_limit_exceeded`) and turns fail or stop
 * mid-answer, and near the cap long turns get cut off. Until now that state was
 * only visible in `/api/consumption` and the copy-diagnostics dump — so from the
 * chat it looked like the feature was broken.
 *
 * Thresholds come from {@link allowanceState} in brain-embedded, the same
 * function the diagnostics signals use, so the banner and the report can never
 * disagree about when to warn.
 *
 * Self-gating: renders nothing when there is no snapshot, when the tenant is
 * uncapped (`meter.unlimited` — a superadmin-member tenant is NOT out of tokens
 * however large `used` grows), or while the allowance is healthy.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { allowanceState } from '@seanhogg/builderforce-brain-embedded';
import { useConsumption } from '@/lib/useConsumption';

/** Compact number for banner copy ("1.2M", "48K"). */
function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function AllowanceBanner() {
  const t = useTranslations('brain.allowance');
  const snapshot = useConsumption();
  const [dismissed, setDismissed] = useState('');

  const meter = snapshot?.meters.find((m) => m.key === 'ai_tokens');
  const state = allowanceState(meter);
  if (!snapshot || !meter || state === 'ok') return null;

  // Key on the state + period, so a reset month or an upgrade re-arms the banner
  // rather than staying dismissed forever.
  const key = `${state}:${snapshot.period.resetsAt}:${meter.limit}`;
  if (dismissed === key) return null;

  const resets = new Date(snapshot.period.resetsAt).toLocaleDateString();
  const exhausted = state === 'exhausted';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        margin: '8px 12px 0',
        padding: '8px 12px',
        fontSize: 13,
        background: exhausted ? 'var(--danger-bg, rgba(239,68,68,0.12))' : 'var(--warning-bg, rgba(234,179,8,0.12))',
        color: exhausted ? 'var(--danger-text, #b91c1c)' : 'var(--warning-text, #b45309)',
        border: `1px solid ${exhausted ? 'var(--danger-border, rgba(239,68,68,0.3))' : 'var(--warning-border, rgba(234,179,8,0.3))'}`,
        borderRadius: 8,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {exhausted
          ? t('exhausted', { used: compact(meter.used), limit: compact(meter.limit), resets })
          : t('nearLimit', { percent: meter.percentUsed, remaining: compact(meter.remaining), resets })}{' '}
        <Link href="/pricing" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
          {t('upgrade')}
        </Link>
        {' · '}
        <Link href="/settings/integrations" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
          {t('connectAccount')}
        </Link>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(key)}
        title={t('dismiss')}
        aria-label={t('dismiss')}
        style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
}
