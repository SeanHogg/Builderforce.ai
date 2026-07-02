'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type MeterSnapshot } from '@/lib/builderforceApi';
import { useConsumption } from '@/lib/useConsumption';
import { Sparkline } from '@/components/charts/Sparkline';

/**
 * Sidebar consumption meter — the "USAGE" section, one card PER metered resource
 * (AI tokens, data ingestion, …) showing month-to-date use vs the plan allowance,
 * a fill bar, "X% used", and a "See plans" link. Visible to ALL members
 * (consumption is transparent; we cap processing, never visibility).
 *
 * Self-gating per the DRY rule: it decides its own visibility — renders nothing
 * until there's a tenant session and a successful fetch. Each meter is the SAME
 * card component, driven by the snapshot, so adding a meter server-side lights up
 * here with no new UI.
 */

/** Per-unit short format. Unit symbols (K/M/MB/GB) are universal, left literal. */
function formatAmount(unit: MeterSnapshot['unit'], n: number): string {
  if (n < 0) return '∞';
  const short = (value: number, suffix: string) =>
    `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
  if (unit === 'bytes') {
    if (n >= 1_000_000_000) return short(n / 1_000_000_000, ' GB');
    if (n >= 1_000_000) return short(n / 1_000_000, ' MB');
    if (n >= 1_000) return short(n / 1_000, ' KB');
    return `${n} B`;
  }
  if (n >= 1_000_000) return short(n / 1_000_000, 'M');
  if (n >= 1_000) return short(n / 1_000, 'K');
  return String(n);
}

/** Bar colour escalates as the allowance fills — neutral → amber → red. */
function barColor(percent: number): string {
  if (percent >= 100) return 'var(--danger, #ef4444)';
  if (percent >= 80) return 'var(--warning, #f59e0b)';
  return 'var(--coral-bright, #4d9eff)';
}

const METER_ICON: Record<MeterSnapshot['key'], string> = {
  ai_tokens: '⚡',
  ingestion: '🗄',
  error_events: '🐞',
  outbound_fetches: '🌐',
};

/**
 * Each meter's trend chart deep-links to the matching Insights report — AI tokens
 * → AI Insights, error events → the Quality (error observability) dashboard, data
 * ingestion and outbound web fetches → the Finance hub where metered/billed
 * consumption is reported.
 */
const METER_INSIGHT_HREF: Record<MeterSnapshot['key'], string> = {
  ai_tokens: '/insights/ai',
  ingestion: '/insights/finance',
  error_events: '/quality',
  outbound_fetches: '/insights/finance',
};

function MeterCard({ meter, isFree }: { meter: MeterSnapshot; isFree: boolean }) {
  const t = useTranslations('usageMeter');
  const { percentUsed, unlimited, unit } = meter;

  const amount = formatAmount(unit, meter.limit);
  const allowanceLabel = unlimited
    ? t('unlimited')
    : isFree
    ? t('freePerMo', { amount })
    : t('perMo', { amount });

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, var(--fg))' }}>
          <span aria-hidden style={{ fontSize: '1rem' }}>{METER_ICON[meter.key]}</span>
          {t(`meter.${meter.key}`)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary, var(--muted))', textAlign: 'right' }}>
          {allowanceLabel}
        </span>
      </div>

      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--bg-elevated, rgba(255,255,255,0.08))',
          overflow: 'hidden',
          margin: '10px 0 8px',
        }}
      >
        <div
          style={{
            width: unlimited ? '0%' : `${percentUsed}%`,
            height: '100%',
            background: barColor(percentUsed),
            borderRadius: 3,
            transition: 'width 0.3s, background 0.3s',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted, var(--muted))' }}>
          {unlimited ? t('usedAmount', { amount: formatAmount(unit, meter.used) }) : t('percentUsed', { percent: percentUsed })}
        </span>
        <Link href="/pricing" className="usage-meter-link" style={{ fontSize: 12, fontWeight: 500, color: 'var(--coral-bright, #4d9eff)' }}>
          {isFree ? t('seePlans') : t('manage')} →
        </Link>
      </div>

      {meter.trend && meter.trend.length > 1 && meter.trend.some((v) => v > 0) && (
        <Link
          href={METER_INSIGHT_HREF[meter.key]}
          className="usage-meter-chart-link"
          aria-label={t('openReport', { meter: t(`meter.${meter.key}`) })}
          title={t('openReport', { meter: t(`meter.${meter.key}`) })}
          style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}
        >
          <Sparkline values={meter.trend} width={220} height={26} color={barColor(percentUsed)} ariaLabel={t('trendAria')} />
        </Link>
      )}
    </div>
  );
}

export default function UsageMeter() {
  const t = useTranslations('usageMeter');
  const snapshot = useConsumption();

  // Self-gate: nothing to show until we have a tenant session and data.
  if (!snapshot || snapshot.meters.length === 0) return null;

  const isFree = snapshot.plan.effective === 'free';

  return (
    <div className="usage-meter">
      <div className="nav-section-label">{t('title')}</div>
      {snapshot.meters.map((meter) => (
        <MeterCard key={meter.key} meter={meter} isFree={isFree} />
      ))}
    </div>
  );
}
