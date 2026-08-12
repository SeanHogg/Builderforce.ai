'use client';

import { useTranslations } from 'next-intl';
import { type BenchmarkRating } from '@/lib/benchmarkingApi';
import { autonomousHopShare, shareOfCreated } from '@/lib/autonomyApi';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { KpiGrid } from './LensShell';
import { hrs, pct, days as dDays, int } from './format';
import {
  useLifecycle, useBottlenecks, useDora, useSpace, useBenchmarking, useAutonomy, useFunnel,
} from './insightsSources';

/**
 * Compact "at-a-glance" KPI summaries for the combined Delivery dashboard.
 *
 * Each summary reads the SAME cached collector its full lens reads (so the
 * headline numbers always agree) but renders only the KPI row — the full
 * breakdown lives in the drill-down slide-out (the lens itself). Kept tiny and
 * self-contained so the dashboard cards AND the Brain's slide-out can compose
 * them without prop drilling. `days` is owned by the shared window selector.
 * Mirrors AiInsightSummaries.tsx.
 *
 * Every read goes through the deduped {@link insightsSources} layer, so the
 * verdict banner, these summaries and any pinned DORA/Delivery widget on the same
 * page share ONE request per collector instead of each firing their own.
 */

/** Percentile → ordinal label (72 → "72nd"). */
function ordinal(n: number | null): string {
  if (n == null) return '—';
  const v = Math.round(n);
  const rem100 = v % 100;
  const rem10 = v % 10;
  let suffix = 'th';
  if (rem100 < 11 || rem100 > 13) {
    if (rem10 === 1) suffix = 'st';
    else if (rem10 === 2) suffix = 'nd';
    else if (rem10 === 3) suffix = 'rd';
  }
  return `${v}${suffix}`;
}

/** Delivery — scoped end-to-end cycle time (the Life Cycle Explorer rollup). */
export function DeliverySummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useLifecycle(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('delivhub.summary.cycleTime')} value={data.sampleSize > 0 ? dDays(data.totalAvgHours / 24) : '—'} sub={t('delivhub.summary.cycleTimeSub')} />
      <StatCard label={t('delivhub.summary.items')} value={int(data.sampleSize)} sub={t('days', { n: days })} />
    </KpiGrid>
  );
}

/** Bottlenecks — slowest stage, rework rate and currently-stuck WIP. */
export function BottleneckSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useBottlenecks(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('bottleneck.slowest')} value={data.slowestStage ? data.slowestStage.stage : '—'} sub={data.slowestStage ? hrs(data.slowestStage.avgHours) : t('bottleneck.noData')} />
      <StatCard label={t('bottleneck.reworkRate')} value={pct(data.rework.reworkRate * 100)} sub={t('bottleneck.reworkSub', { n: data.rework.reworkedTasks })} />
      <StatCard label={t('bottleneck.stuck')} value={int(data.agingWip.stuckCount)} sub={t('bottleneck.stuckSub', { n: data.agingWip.thresholdHours })} />
    </KpiGrid>
  );
}

/** DORA — the four DevOps keys. */
export function DoraSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useDora(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('dora.deployFreq')} value={t('dora.perDay', { value: data.deploymentFrequencyPerDay.toFixed(2) })} sub={t('dora.deploys', { n: data.totalDeployments })} />
      <StatCard label={t('dora.leadTime')} value={hrs(data.leadTimeHours)} sub={t('dora.leadSub')} />
      <StatCard label={t('dora.cfr')} value={pct(data.changeFailureRatePct)} sub={t('dora.cfrSub')} />
      <StatCard label={t('dora.mttr')} value={hrs(data.mttrHours)} sub={t('dora.mttrSub')} />
    </KpiGrid>
  );
}

/** SPACE — the five productivity dimensions (0..100 each). */
export function SpaceSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useSpace(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const dims: Array<{ id: string; score: number | null }> = [
    { id: 'satisfaction', score: data.satisfaction.score },
    { id: 'performance', score: data.performance.score },
    { id: 'activity', score: data.activity.score },
    { id: 'communication', score: data.communication.score },
    { id: 'efficiency', score: data.efficiency.score },
  ];

  return (
    <KpiGrid>
      {dims.map((d) => (
        <StatCard key={d.id} label={t(`space.dim.${d.id}`)} value={d.score == null ? '—' : `${Math.round(d.score)}`} sub={t(`space.sub.${d.id}`)} />
      ))}
    </KpiGrid>
  );
}

/** Industry benchmarking — average percentile + how many metrics rate elite/high. */
export function BenchmarkingSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useBenchmarking(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const rated = data.metrics.filter((m) => m.percentile != null);
  const avgPct = rated.length ? rated.reduce((s, m) => s + (m.percentile ?? 0), 0) / rated.length : null;
  const top = data.metrics.filter((m) => m.rating === ('elite' as BenchmarkRating) || m.rating === ('high' as BenchmarkRating)).length;

  return (
    <KpiGrid>
      <StatCard label={t('delivhub.summary.avgPercentile')} value={ordinal(avgPct)} sub={t('delivhub.summary.metricsRated', { n: rated.length })} />
      <StatCard label={t('delivhub.summary.topRated')} value={int(top)} sub={t('delivhub.summary.topRatedSub')} />
    </KpiGrid>
  );
}

/**
 * Autonomy Health — did the work actually finish itself? The three figures that
 * answer it: end-to-end autonomous completion, the share of lane moves autonomy
 * made, and how many tickets are sitting at a gate. Reads the SAME cached
 * collector the full lens reads, so the card and the report always agree.
 */
export function AutonomySummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useAutonomy(days);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const s = data.totals;
  const hopShare = autonomousHopShare(s);

  return (
    <KpiGrid>
      <StatCard
        label={t('autonomy.stat.fully')}
        value={s.tickets > 0 ? pct(shareOfCreated(s, s.fullyAutonomous)) : '—'}
        sub={t('autonomy.stat.fullySub', { n: int(s.fullyAutonomous), total: int(s.tickets) })}
      />
      <StatCard
        label={t('autonomy.stat.hopShare')}
        value={hopShare == null ? '—' : pct(hopShare)}
        sub={t('autonomy.stat.hopShareSub', { a: int(s.autonomousHops), h: int(s.humanHops) })}
      />
      <StatCard
        label={t('autonomy.stat.stalled')}
        value={int(s.stalled)}
        sub={t('autonomy.stat.stalledSub', { share: pct(shareOfCreated(s, s.stalled)) })}
      />
    </KpiGrid>
  );
}

/** Innovation funnel — pipeline size, idea→ship conversion and time-to-value. */
export function FunnelSummary(_: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useFunnel();

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('funnel.total')} value={String(data.totalIdeas)} sub={t('funnel.activeSub', { n: data.activeIdeas })} />
      <StatCard label={t('funnel.ideaToShip')} value={pct(data.ideaToShipPct)} sub={t('funnel.ideaToShipSub')} />
      <StatCard label={t('funnel.timeToValue')} value={dDays(data.avgIdeaToShipDays)} sub={t('funnel.timeToValueSub')} />
      <StatCard label={t('funnel.killed')} value={String(data.killedCount)} sub={t('funnel.killedSub')} />
    </KpiGrid>
  );
}
