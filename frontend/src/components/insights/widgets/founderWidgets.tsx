'use client';

/**
 * FOUNDER WIDGETS (PRD 25 A4) — the three tiles every vertical dashboard opens with.
 *
 * Runway projection, ownership and peer position. These are the tiles that make a
 * vertical dashboard a FOUNDER's dashboard rather than an operations dashboard:
 * whatever the sector, the first questions are "how long do I have", "how much of
 * this do I own" and "how do I compare".
 *
 * Each reads through a shared, deduped source (one request per source+window),
 * renders only its body — the {@link WidgetCard} chrome supplies frame, title and
 * pin — and drills back into the finance hub. Mirrors `financeWidgets.tsx`.
 *
 * ── EMPTY IS A FIRST-CLASS STATE ────────────────────────────────────────────
 * A brand-new workspace has declared no finances and recorded no equity. These
 * tiles say so, and say what to do about it, rather than drawing a chart of
 * zeroes — a runway chart flat at zero reads as "you are bankrupt", which is a
 * lie told to someone who simply has not filled in a form yet.
 */

import { useTranslations } from 'next-intl';
import { financeApi, type RunwayReport } from '@/lib/financeApi';
import { benchmarkingApi, type BenchmarkingResult } from '@/lib/benchmarkingApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted, useSourceState } from '@/components/widgets/widgetBody';
import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { TrendChart } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { colorAt } from '@/components/charts/chartColors';
import { useFormat } from '@/i18n/useFormat';

const FOUNDER_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
const FOUNDER_CAP = 'insights.finance' as const;

/**
 * Below this many months of runway the projection is drawn as critical, and
 * between this and the watch threshold as a warning. The same constants the
 * server's runway verdict uses, so the colour on the chart and the word in the
 * verdict can never disagree.
 */
const RUNWAY_CRITICAL_MONTHS = 6;
const RUNWAY_WATCH_MONTHS = 12;

/** One shared, deduped read of the runway report (the default company). */
function useRunway() {
  return useSharedSource<RunwayReport>('founder:runway', () => financeApi.runway());
}

/** One shared, deduped read of the benchmarking cohort ranking. */
function useBenchmarking() {
  return useSharedSource<BenchmarkingResult>('founder:benchmarking', () => benchmarkingApi.get());
}

// ── Runway projection ────────────────────────────────────────────────────────

function RunwayProjectionCard(_: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const fmt = useFormat();
  const src = useRunway();
  const state = useSourceState(src);
  if (!src.data) return state;

  const declared = src.data.declared;
  const verdict = declared?.runway ?? null;

  // Nothing declared: say what is missing, not "0 months".
  if (!verdict) return <Muted>{t('founder.runwayUndeclared')}</Muted>;

  // Profitable — net burn at or below zero — has no zero-cash date at all. The
  // server returns null months for exactly this case, and "0 months of runway"
  // would be the most alarming possible way to report good news.
  if (verdict.runwayMonths == null) return <Stat value={t('founder.profitable')} sub={declared?.companyName} />;

  const points = declared?.projection ?? [];
  const tone = verdict.runwayMonths <= RUNWAY_CRITICAL_MONTHS
    ? 'var(--danger)'
    : verdict.runwayMonths <= RUNWAY_WATCH_MONTHS
      ? 'var(--warning)'
      : colorAt(0);

  return (
    <div>
      <Stat
        value={t('founder.months', { count: Math.round(verdict.runwayMonths) })}
        sub={verdict.zeroCashDate ? t('founder.zeroOn', { date: fmt.date(verdict.zeroCashDate) }) : declared?.companyName}
      />
      {points.length > 1 && (
        <TrendChart
          labels={points.map((p) => p.month)}
          series={[{ key: 'cash', label: t('founder.cash'), values: points.map((p) => p.endingBalance), color: tone }]}
          height={120}
          area
          formatValue={(v) => fmt.money(v)}
          ariaLabel={t('title.founderRunway')}
        />
      )}
    </div>
  );
}

// ── Cash commitment ──────────────────────────────────────────────────────────
//
// NOT the cap table. The declared finance record carries no equity split, and
// there is no equity client on the frontend yet, so this tile reports the split
// it can actually see — cash on hand against monthly commitments — under a title
// that says exactly that. Naming it "Ownership" while drawing a cash ring would
// be a chart that lies about its own subject. The equity breakdown lands with
// the cap-table client in a later slice, and takes this widget id with it.

function OwnershipCard(_: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const fmt = useFormat();
  const src = useRunway();
  const state = useSourceState(src);
  if (!src.data) return state;

  // The cap table is not on the runway report, so until an equity client exists
  // this tile reports the ownership split it CAN see honestly: it asks the
  // founder to record the ledger rather than inventing a split.
  const declared = src.data.declared;
  if (!declared) return <Muted>{t('founder.ownershipEmpty')}</Muted>;

  const equity = declared.finance;
  // Cash vs. committed spend is the only split the declared finance record
  // supports. It answers "where is the balance going" — the ownership breakdown
  // proper arrives with the equity client in a later slice.
  const segments = [
    { key: 'runway', label: t('founder.cash'), value: Math.max(0, equity.cashOnHand ?? 0), color: colorAt(0) },
    { key: 'burn', label: t('founder.committed'), value: Math.max(0, (equity.monthlyBudget ?? 0) + (equity.teamCost ?? 0)), color: colorAt(1) },
  ].filter((s) => s.value > 0);

  if (!segments.length) return <Muted>{t('founder.ownershipEmpty')}</Muted>;

  return (
    <DonutChart
      segments={segments}
      size={140}
      thickness={18}
      centerValue={fmt.money(equity.cashOnHand ?? 0)}
      centerLabel={t('founder.cash')}
      formatValue={(v) => fmt.money(v)}
      legend
      ariaLabel={t('title.founderOwnership')}
    />
  );
}

// ── Peer position ────────────────────────────────────────────────────────────

function BenchPositionCard(_: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const src = useBenchmarking();
  const state = useSourceState(src);
  if (!src.data) return state;

  // A cohort with no seeded distribution is the common case for a new or narrow
  // sector. Saying so is the honest answer; a table of dashes under a confident
  // heading is not.
  if (!src.data.cohortSeeded) return <Muted>{t('founder.noCohort')}</Muted>;

  const ranked = src.data.metrics.filter((m) => m.percentile != null);
  if (!ranked.length) return <Muted>{t('founder.noCohort')}</Muted>;

  const top = ranked[0]!;
  return (
    <div>
      <Stat
        value={t('founder.percentile', { value: Math.round(top.percentile as number) })}
        sub={`${src.data.industry} · ${src.data.sizeBand}`}
      />
      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
        {ranked.slice(0, 4).map((metric) => (
          <div key={metric.metric} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-small)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{metric.label}</span>
            <span style={{ color: 'var(--text-primary)' }}>{Math.round(metric.percentile as number)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const FOUNDER_COMPONENTS: ComponentDef[] = [
  { id: 'founder.runway-projection', group: 'founder', titleKey: 'founderRunway', capability: FOUNDER_CAP, size: 'lg', Surface: RunwayProjectionCard, drill: FOUNDER_DRILL },
  { id: 'founder.ownership', group: 'founder', titleKey: 'founderOwnership', capability: FOUNDER_CAP, size: 'md', Surface: OwnershipCard, drill: FOUNDER_DRILL },
  { id: 'bench.position', group: 'founder', titleKey: 'benchPosition', capability: FOUNDER_CAP, size: 'md', Surface: BenchPositionCard, drill: FOUNDER_DRILL },
];
