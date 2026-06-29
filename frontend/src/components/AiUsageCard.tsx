'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useConsumption } from '@/lib/useConsumption';
import { Sparkline } from '@/components/charts/Sparkline';
import { compactTokens } from '@/components/insights/format';

/**
 * Dashboard AI-usage card — month-to-date AI token consumption with a daily
 * sparkline, for the all-members dashboard home. Self-gating per the DRY rule:
 * it decides its own visibility (renders null until there's a tenant session and
 * an ai_tokens meter with data) and reads the SAME cached, all-members
 * consumption snapshot as the sidebar <UsageMeter/> via the shared hook — no
 * manager-gated insights fetch, so it never 403s for non-managers.
 */

export function AiUsageCard() {
  const t = useTranslations('aiUsageCard');
  const snapshot = useConsumption();
  const meter = snapshot?.meters.find((m) => m.key === 'ai_tokens');
  // Show only once there's a real trend to draw (avoids an empty flat card).
  if (!meter || !meter.trend || meter.trend.length < 2 || !meter.trend.some((v) => v > 0)) return null;

  return (
    <Link
      href="/insights/ai-impact"
      style={{
        display: 'block', background: 'var(--bg-base, #0a0f1a)', border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: '14px 16px', textDecoration: 'none', marginBottom: 32,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('title')}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--coral-bright, #4d9eff)', lineHeight: 1.1 }}>
            {compactTokens(meter.used)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {meter.unlimited ? t('tokensThisMonth') : t('percentOfPlan', { percent: meter.percentUsed })}
          </div>
        </div>
        <div style={{ flex: 1, maxWidth: 360 }}>
          <Sparkline values={meter.trend} width={360} height={48} ariaLabel={t('trendAria')} />
        </div>
      </div>
    </Link>
  );
}
