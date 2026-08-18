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
 * that resource (see METER_PRESENTATION) — tokens → API keys, cloud runs → the IDE,
 * data → integrations, errors → the quality collectors, outbound fetches → the finance
 * report — while its trend chart drills into the matching Insights report and "See plans"
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
  if (percent >= 100) return 'var(--danger)';
  if (percent >= 80) return 'var(--warning, var(--warning))';
  return 'var(--coral-bright, var(--coral-bright))';
}

/**
 * Everything presentation needs to know about ONE meter, in one place.
 *
 * This was three parallel `Record<MeterKey, …>`s — icon, config href, insight
 * href — which meant adding a meter was three edits that nothing forced you to
 * make together, and missing one produced `undefined` rather than a type error.
 * That is exactly how `stage_sandbox_runs` (emitted by the API, absent from all
 * three) reached `<Link href={undefined}>` and crashed the expanded panel.
 *
 * `configHref` is the configuration / key entry point that governs the resource;
 * `insightHref` is the Insights report its trend chart drills into.
 */
interface MeterPresentation {
  icon: string;
  configHref: string;
  insightHref: string;
}

const METER_PRESENTATION: Record<MeterSnapshot['key'], MeterPresentation> = {
  ai_tokens: { icon: '⚡', configHref: '/settings/integrations', insightHref: '/insights/ai' },
  cloud_runs: { icon: '☁️', configHref: '/create?filter=build', insightHref: '/insights/finance' },
  stage_sandbox_runs: { icon: '🧪', configHref: '/marketplace', insightHref: '/insights/finance' },
  ingestion: { icon: '🗄', configHref: '/settings/integrations', insightHref: '/insights/finance' },
  error_events: { icon: '🐞', configHref: '/quality?tab=collectors', insightHref: '/quality' },
  outbound_fetches: { icon: '🌐', configHref: '/insights/finance', insightHref: '/insights/finance' },
};

/**
 * The API and this app deploy separately, so the server can emit a meter this
 * build has never heard of. That is a routine version skew, not an error state:
 * the number is still true and still worth showing, so an unknown meter renders
 * as a plain card — no icon, no deep links, its raw key as the name — instead of
 * taking the whole panel down with it.
 */
function meterPresentation(key: MeterSnapshot['key']): MeterPresentation | undefined {
  return METER_PRESENTATION[key] as MeterPresentation | undefined;
}

/** One card-title typography, whether or not the meter has somewhere to link. */
const meterTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--font-size-card-title)',
  fontWeight: 600,
  color: 'var(--text-primary, var(--fg))',
};

export function ConsumptionMeterCard({
  meter, isFree, title, usageOnly = false, periodLabel,
}: {
  meter: MeterSnapshot;
  isFree: boolean;
  /** Optional scoped title, e.g. "Errors · Web app". */
  title?: string;
  /** Compact amount-only treatment for a scoped meter with no separate quota. */
  usageOnly?: boolean;
  /** Optional window shown by the compact treatment, e.g. "Last 30 days". */
  periodLabel?: string;
}) {
  const t = useTranslations('usageMeter');
  const { percentUsed, unlimited, unit } = meter;

  const amount = formatAmount(unit, meter.limit);
  const allowanceLabel = unlimited
    ? t('unlimited')
    : isFree
    ? t('freePerMo', { amount })
    : t('perMo', { amount });
  const presentation = meterPresentation(meter.key);
  // Same skew rule as the presentation lookup: an unnamed meter shows its raw
  // key rather than throwing on a catalog miss.
  const meterKeyLabel = t.has(`meter.${meter.key}` as never) ? t(`meter.${meter.key}` as never) : meter.key;
  const meterName = title ?? meterKeyLabel;

  if (usageOnly) {
    return (
      <div
        style={{
          minWidth: 112,
          padding: '9px 11px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated, rgba(255,255,255,0.08))',
          border: '1px solid var(--border-subtle, var(--border))',
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 650, color: 'var(--text-muted, var(--muted))', whiteSpace: 'nowrap' }}>
          {meterName}
        </div>
        <div style={{ marginTop: 2, fontSize: 15, fontWeight: 750, color: 'var(--text-primary, var(--fg))', whiteSpace: 'nowrap' }}>
          {formatAmount(unit, meter.used)}
        </div>
        <div style={{ marginTop: 1, fontSize: 10.5, color: 'var(--text-muted, var(--muted))', whiteSpace: 'nowrap' }}>
          {periodLabel ?? t('usedAmount', { amount: '' }).trim()}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: 'var(--radius-lg)',
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        {/* The title routes to the configuration / key entry point for this
            resource — as plain text for a meter this build doesn't know, since
            there is no entry point to route to. */}
        {presentation ? (
          <Link
            href={presentation.configHref}
            className="usage-meter-title-link"
            aria-label={t('configure', { meter: meterName })}
            title={t('configure', { meter: meterName })}
            style={{ ...meterTitleStyle, textDecoration: 'none' }}
          >
            <span aria-hidden style={{ fontSize: '1rem' }}>{presentation.icon}</span>
            {meterName}
          </Link>
        ) : (
          <span style={meterTitleStyle}>{meterName}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-secondary, var(--muted))', textAlign: 'right' }}>
          {allowanceLabel}
        </span>
      </div>

      <div
        style={{
          height: 6,
          borderRadius: 'var(--radius-sm)',
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
            borderRadius: 'var(--radius-sm)',
            transition: 'width 0.3s, background 0.3s',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted, var(--muted))' }}>
          {unlimited ? t('usedAmount', { amount: formatAmount(unit, meter.used) }) : t('percentUsed', { percent: percentUsed })}
        </span>
        <Link href="/pricing" className="usage-meter-link" style={{ fontSize: 12, fontWeight: 500, color: 'var(--coral-bright, var(--coral-bright))' }}>
          {isFree ? t('seePlans') : t('manage')} →
        </Link>
      </div>

      {meter.trend && meter.trend.length > 1 && meter.trend.some((v) => v > 0) && (
        presentation ? (
          <Link
            href={presentation.insightHref}
            className="usage-meter-chart-link"
            aria-label={t('openReport', { meter: meterName })}
            title={t('openReport', { meter: meterName })}
            style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}
          >
            <Sparkline values={meter.trend} width={220} height={26} color={barColor(percentUsed)} ariaLabel={t('trendAria')} />
          </Link>
        ) : (
          // The trend is still true without a report to open it in.
          <div style={{ display: 'block', marginTop: 8 }}>
            <Sparkline values={meter.trend} width={220} height={26} color={barColor(percentUsed)} ariaLabel={t('trendAria')} />
          </div>
        )
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
        <ConsumptionMeterCard key={meter.key} meter={meter} isFree={isFree} />
      ))}
    </div>
  );
}
