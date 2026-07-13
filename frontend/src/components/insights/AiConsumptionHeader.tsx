'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useConsumption } from '@/lib/useConsumption';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { compactTokens, pct } from './format';

/**
 * AI consumption hero for the /insights/ai hub — the headline answer to "how many
 * AI tokens have we burned this month?". Reads the SAME cached, all-members
 * consumption snapshot as the sidebar <UsageMeter/> and the dashboard
 * <AiUsageCard/> (via the shared useConsumption hook), so it never fires a
 * manager-gated insights read and never 403s. Self-gating per the DRY rule: it
 * renders nothing until there's a tenant session with an ai_tokens meter.
 *
 * The hub previously surfaced productivity/efficiency scores but NOT the raw
 * token count — this card makes the spend the first thing you see, with a
 * month-to-date daily trend.
 */
export function AiConsumptionHeader() {
  const t = useTranslations('insights.aihub.consumption');
  const snapshot = useConsumption();
  const meter = snapshot?.meters.find((m) => m.key === 'ai_tokens');

  // Build dated x-labels from the billing-period start (one entry per elapsed day).
  const labels = useMemo(() => {
    if (!snapshot || !meter?.trend?.length) return [];
    const start = new Date(snapshot.period.start);
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return meter.trend.map((_, i) => fmt.format(new Date(start.getTime() + i * 86_400_000)));
  }, [snapshot, meter]);

  if (!snapshot || !meter) return null;

  const color = colorAt(1); // brand blue — matches the AiUsageCard accent
  const hasTrend = (meter.trend?.length ?? 0) > 1 && (meter.trend ?? []).some((v) => v > 0);

  return (
    <div
      style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: 20,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'stretch' }}>
        {/* Headline figures */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 200, flex: '0 0 auto' }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
              {t('title')}
            </div>
            <div style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1.05, color }}>
              {compactTokens(meter.used)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {meter.unlimited
                ? t('thisMonth')
                : t('ofPlan', { percent: pct(meter.percentUsed), limit: compactTokens(meter.limit) })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <MiniStat label={t('used')} value={compactTokens(meter.used)} />
            {!meter.unlimited && <MiniStat label={t('remaining')} value={compactTokens(Math.max(0, meter.remaining))} />}
            <MiniStat label={t('plan')} value={t(`planName.${snapshot.plan.effective}`)} />
          </div>
        </div>

        {/* Month-to-date daily trend */}
        <div style={{ flex: 1, minWidth: 260 }}>
          {hasTrend ? (
            <TrendChart
              labels={labels}
              series={[{ key: 'tokens', label: t('title'), values: meter.trend ?? [], color }]}
              height={150}
              area
              formatValue={(v) => compactTokens(v)}
              ariaLabel={t('trendAria')}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('noTrend')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
