'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type MeterSnapshot } from '@/lib/builderforceApi';
import { useConsumption } from '@/lib/useConsumption';
import { Sparkline } from '@/components/charts/Sparkline';

/**
 * Sidebar consumption meter — the collapsible "USAGE" section, one card PER metered
 * resource (AI tokens, data, …) showing month-to-date use vs the plan allowance,
 * a fill bar, "X% used", and a "See plans" link. Visible to ALL members
 * (consumption is transparent; we cap processing, never visibility).
 *
 * Self-gating per the DRY rule: it decides its own visibility — renders nothing
 * until there's a tenant session and a successful fetch. Each meter is the SAME
 * card component, driven by the snapshot, so adding a meter server-side lights up
 * here with no new UI.
 *
 * Each card's TITLE deep-links to the configuration / key entry point that governs
 * that resource (see METER_CONFIG_HREF) — tokens → API keys, cloud runs → the IDE,
 * data → integrations, errors → the quality collectors, uptime → the finance report
 * — while its trend chart drills into the matching Insights report and "See plans"
 * routes to billing. The whole section collapses via the header toggle, persisted so
 * a member who folds it away keeps it folded.
 */

const COLLAPSE_STORAGE_KEY = 'bf.usageMeter.collapsed';

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
  cloud_runs: '☁️',
  ingestion: '🗄',
  error_events: '🐞',
  outbound_fetches: '🌐',
};

/**
 * Each meter's TITLE deep-links to the configuration / key entry point that
 * represents its functionality — AI tokens → provider API keys, cloud runs → the
 * IDE launcher where they run, data → the integrations/connectors that feed
 * ingestion, errors → the quality error collectors, uptime (outbound web fetches)
 * → the Finance hub where that metered activity is reported.
 */
const METER_CONFIG_HREF: Record<MeterSnapshot['key'], string> = {
  ai_tokens: '/settings/integrations',
  cloud_runs: '/ide/dashboard',
  ingestion: '/settings/integrations',
  error_events: '/quality?tab=collectors',
  outbound_fetches: '/insights/finance',
};

/**
 * Each meter's trend chart deep-links to the matching Insights report — AI tokens
 * → AI Insights, error events → the Quality (error observability) dashboard, data
 * ingestion and outbound web fetches → the Finance hub where metered/billed
 * consumption is reported.
 */
const METER_INSIGHT_HREF: Record<MeterSnapshot['key'], string> = {
  ai_tokens: '/insights/ai',
  cloud_runs: '/insights/finance',
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
  const meterName = t(`meter.${meter.key}`);

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
        {/* The title routes to the configuration / key entry point for this resource. */}
        <Link
          href={METER_CONFIG_HREF[meter.key]}
          className="usage-meter-title-link"
          aria-label={t('configure', { meter: meterName })}
          title={t('configure', { meter: meterName })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, var(--fg))', textDecoration: 'none' }}
        >
          <span aria-hidden style={{ fontSize: '1rem' }}>{METER_ICON[meter.key]}</span>
          {meterName}
        </Link>
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
          aria-label={t('openReport', { meter: meterName })}
          title={t('openReport', { meter: meterName })}
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

  // Collapse state persists across sessions — a member who folds Usage away keeps it
  // folded. Initialise expanded (SSR-safe), then hydrate from localStorage on mount.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — in-memory only */
      }
      return next;
    });
  };

  // Self-gate: nothing to show until we have a tenant session and data.
  if (!snapshot || snapshot.meters.length === 0) return null;

  const isFree = snapshot.plan.effective === 'free';

  return (
    <div className="usage-meter">
      <button
        type="button"
        className="usage-meter-head"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('expandSection') : t('collapseSection')}
        title={collapsed ? t('expandSection') : t('collapseSection')}
      >
        <span className="nav-section-label" style={{ padding: 0, margin: 0 }}>{t('title')}</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && snapshot.meters.map((meter) => (
        <MeterCard key={meter.key} meter={meter} isFree={isFree} />
      ))}
    </div>
  );
}
