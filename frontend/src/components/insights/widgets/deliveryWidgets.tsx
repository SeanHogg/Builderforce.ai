'use client';

/**
 * Delivery + DORA lenses, decomposed into individually-pinnable widgets.
 *
 * The consolidated Delivery hub (DeliveryLens) and the DORA four-keys lens
 * (DoraLens) each drew a stack of cards — throughput / cycle time / velocity /
 * say-do for delivery; deploy frequency / lead time / change-fail rate / MTTR for
 * DORA. Every one of those is now a standalone {@link WidgetDef} so a user can pin
 * the exact tile they want onto their dashboard. Cards backed by the same
 * collector read through ONE {@link useSharedSource} (deduped to a single request
 * per window), render only their body (the WidgetCard chrome supplies frame +
 * title + pin), and drill back into the matching Delivery slide-out panel.
 *
 * Mirrors aiImpactWidgets.tsx exactly. The delivery cards use the tenant-wide,
 * window-keyed delivery collectors (lifecycle + derived sprint velocity) since a
 * dashboard widget only receives the shared `days` window — not a picked
 * deliverable — which is also what the lens shows tenant-wide.
 */

import { useTranslations } from 'next-intl';
import {
  insightsApi, agileMetricsApi,
  type DoraInsights, type LifecycleInsights, type VelocityInsights, type LifecyclePhase,
} from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { BandedMetricBar, type MetricTier } from '@/components/charts/BandedMetricBar';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { hrs, pct } from '../format';

// ── Shared, deduped collector reads (one request per source × window) ──────────

/** One shared read of the DORA four-keys collector per window. */
function useDora(days: number) {
  return useSharedSource<DoraInsights>(`dora:${days}`, () => insightsApi.dora(days));
}
/** One shared read of the life-cycle (cycle time) collector per window. */
function useLifecycle(days: number) {
  return useSharedSource<LifecycleInsights>(`lifecycle:${days}`, () => insightsApi.lifecycle(days));
}
/** One shared read of the derived sprint-velocity collector (tenant-wide). */
function useVelocity(days: number) {
  return useSharedSource<VelocityInsights>(`velocity:${days}`, () => agileMetricsApi.derivedVelocity());
}

// Both lenses live behind the same Delivery hub slide-out.
const DRILL_DELIVERY: WidgetDrill = { kind: 'panel', hub: 'delivery', panel: 'delivery' };
const DRILL_DORA: WidgetDrill = { kind: 'panel', hub: 'delivery', panel: 'dora' };
// Capabilities reused verbatim from the matching panels in deliveryPanels.tsx.
const CAP_DELIVERY = 'insights.delivery' as const;
const CAP_DORA = 'insights.delivery' as const;

const TIER_ORDER = ['elite', 'high', 'medium', 'low'] as const;
type TierKey = (typeof TIER_ORDER)[number];
const TIER_COLOR: Record<TierKey, string> = { elite: '#15803d', high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
const PHASE_ORDER: LifecyclePhase[] = ['refinement', 'work', 'review', 'deploy'];

// DORA tier classification (index 0=Elite … 3=Low) — same thresholds as DoraLens.
const tierDeployFreq = (perDay: number) => (perDay >= 1 ? 0 : perDay >= 1 / 7 ? 1 : perDay >= 1 / 30 ? 2 : 3);
const tierLeadTime = (h: number) => (h < 24 ? 0 : h < 168 ? 1 : h < 730 ? 2 : 3);
const tierCfr = (p: number) => (p <= 5 ? 0 : p <= 15 ? 1 : p <= 30 ? 2 : 3);
const tierMttr = (h: number) => (h < 1 ? 0 : h < 24 ? 1 : h < 168 ? 2 : 3);

/** Compact hours → "Xd Yh" / "Yh" / "Zm" for lifecycle phase durations. */
function fmtDur(hours: number): string {
  if (hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

/** Loading / error wrapper for the DORA-backed cards. */
function useDoraBody(days: number) {
  const t = useTranslations('insights');
  const { data, error } = useDora(days);
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}
/** Loading / error wrapper for the life-cycle-backed cards. */
function useLifecycleBody(days: number) {
  const t = useTranslations('insights');
  const { data, error } = useLifecycle(days);
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}
/** Loading / error wrapper for the velocity-backed cards. */
function useVelocityBody(days: number) {
  const t = useTranslations('insights');
  const { data, error } = useVelocity(days);
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── DORA widget bodies ─────────────────────────────────────────────────────────

function DeployFreqCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  return <Stat value={t('dora.perDay', { value: data.deploymentFrequencyPerDay.toFixed(2) })} sub={t('dora.deploys', { n: data.totalDeployments })} />;
}

function LeadTimeCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  return <Stat value={hrs(data.leadTimeHours)} sub={t('dora.leadSub')} />;
}

function ChangeFailCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  return <Stat value={pct(data.changeFailureRatePct)} sub={t('dora.cfrSub')} />;
}

function MttrCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  return <Stat value={hrs(data.mttrHours)} sub={t('dora.mttrSub')} />;
}

function TotalDeploysCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  return <Stat value={String(data.totalDeployments)} sub={t('days', { n: data.windowDays })} />;
}

function DoraPerformanceCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  const tiers: MetricTier[] = TIER_ORDER.map((k) => ({ key: k, label: t(`dora.tier.${k}`), color: TIER_COLOR[k] }));
  const idxDeploy = data.totalDeployments > 0 ? tierDeployFreq(data.deploymentFrequencyPerDay) : null;
  const idxLead = data.leadTimeHours != null ? tierLeadTime(data.leadTimeHours) : null;
  const idxCfr = data.changeFailureRatePct != null ? tierCfr(data.changeFailureRatePct) : null;
  const idxMttr = data.mttrHours != null ? tierMttr(data.mttrHours) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <BandedMetricBar label={t('dora.deployFreq')} valueText={t('dora.perDay', { value: data.deploymentFrequencyPerDay.toFixed(2) })} tiers={tiers} activeIndex={idxDeploy} ariaLabel={t('dora.barAria', { metric: t('dora.deployFreq') })} />
      <BandedMetricBar label={t('dora.leadTime')} valueText={hrs(data.leadTimeHours)} tiers={tiers} activeIndex={idxLead} ariaLabel={t('dora.barAria', { metric: t('dora.leadTime') })} />
      <BandedMetricBar label={t('dora.cfr')} valueText={pct(data.changeFailureRatePct)} tiers={tiers} activeIndex={idxCfr} ariaLabel={t('dora.barAria', { metric: t('dora.cfr') })} />
      <BandedMetricBar label={t('dora.mttr')} valueText={hrs(data.mttrHours)} tiers={tiers} activeIndex={idxMttr} ariaLabel={t('dora.barAria', { metric: t('dora.mttr') })} />
    </div>
  );
}

function ChangeOutcomesCard({ days }: WidgetCardProps) {
  const { data, state, t } = useDoraBody(days);
  if (!data) return state;
  const cfr = data.changeFailureRatePct;
  if (cfr == null) return <Muted>{t('dora.noCfr')}</Muted>;
  return (
    <DonutChart
      ariaLabel={t('dora.ringAria')}
      centerValue={pct(cfr)}
      centerLabel={t('dora.cfr')}
      formatValue={() => ''}
      segments={[
        { key: 'failed', label: t('dora.failed'), value: cfr, color: '#ef4444' },
        { key: 'ok', label: t('dora.succeeded'), value: Math.max(0, 100 - cfr), color: '#22c55e' },
      ]}
    />
  );
}

// ── Delivery widget bodies ──────────────────────────────────────────────────────

function CycleTimeCard({ days }: WidgetCardProps) {
  const { data, state, t } = useLifecycleBody(days);
  if (!data) return state;
  if (data.sampleSize === 0) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  return <Stat value={fmtDur(data.totalAvgHours)} sub={t('deliv.lifecycle.subtitle', { d: fmtDur(data.totalAvgHours), n: data.sampleSize })} />;
}

function LifecyclePhasesCard({ days }: WidgetCardProps) {
  const { data, state, t } = useLifecycleBody(days);
  if (!data) return state;
  if (data.sampleSize === 0) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  const phases = [...data.byPhase].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
  const bars = phases.map((p, i) => ({ key: p.phase, label: t(`deliv.lifecycle.phase.${p.phase}`), value: p.avgHours, color: colorAt(i) }));
  if (bars.every((b) => b.value === 0)) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => fmtDur(v)} ariaLabel={t('deliv.lifecycle.title')} />;
}

function LifecycleTrendCard({ days }: WidgetCardProps) {
  const { data, state, t } = useLifecycleBody(days);
  if (!data) return state;
  if (data.trend.length < 2) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  return (
    <TrendChart
      labels={data.trend.map((p) => p.period)}
      series={[{ key: 'lifecycle', label: t('deliv.lifecycle.trendSeries'), values: data.trend.map((p) => p.avgLifecycleHours / 24), color: '#7c5cff' }]}
      formatValue={(v) => `${v.toFixed(0)}d`}
      area
      ariaLabel={t('deliv.lifecycle.trendAria')}
    />
  );
}

function VelocityCard({ days }: WidgetCardProps) {
  const { data, state, t } = useVelocityBody(days);
  if (!data) return state;
  if (data.sprints.length === 0) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  return <Stat value={data.averageVelocity != null ? data.averageVelocity.toFixed(1) : '—'} sub={t('deliv.avgVelocitySub', { n: data.velocitySampleSize })} />;
}

function EstimationCard({ days }: WidgetCardProps) {
  const { data, state, t } = useVelocityBody(days);
  if (!data) return state;
  return <Stat value={`${data.estimatedTasks}`} sub={t('deliv.estimatedSub', { n: data.unestimatedTasks })} />;
}

function VelocityTrendCard({ days }: WidgetCardProps) {
  const { data, state, t } = useVelocityBody(days);
  if (!data) return state;
  if (data.sprints.length < 2) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  // Sprints come newest-first from the table; chart them oldest → newest.
  const ordered = [...data.sprints].slice(0, 8).reverse();
  return (
    <TrendChart
      labels={ordered.map((s) => s.name)}
      series={[
        { key: 'committed', label: t('deliv.committed'), values: ordered.map((s) => s.committedPoints) },
        { key: 'completed', label: t('deliv.completed'), values: ordered.map((s) => s.completedPoints) },
      ]}
      formatValue={(v) => String(Math.round(v))}
      ariaLabel={t('deliv.velocity')}
    />
  );
}

function SprintTableCard({ days }: WidgetCardProps) {
  const { data, state, t } = useVelocityBody(days);
  if (!data) return state;
  if (data.sprints.length === 0) return <Muted>{t('deliv.lifecycle.empty')}</Muted>;
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>{t('deliv.sprint')}</th>
            <th style={thStyle}>{t('deliv.committed')}</th>
            <th style={thStyle}>{t('deliv.completed')}</th>
            <th style={thStyle}>{t('deliv.sayDo')}</th>
          </tr>
        </thead>
        <tbody>
          {data.sprints.slice(0, 8).map((s) => (
            <tr key={s.sprintId} style={trStyle}>
              <td style={tdStyle}>{s.name}</td>
              <td style={tdMutedStyle}>{s.committedPoints}</td>
              <td style={tdMutedStyle}>{s.completedPoints}</td>
              <td style={tdMutedStyle}>{s.completionRatePct != null ? pct(s.completionRatePct) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const DELIVERY_WIDGETS: WidgetDef[] = [
  // Delivery (cycle time + velocity, tenant-wide window-keyed collectors)
  { id: 'delivery.cycle-time', group: 'delivery', titleKey: 'delivCycleTime', capability: CAP_DELIVERY, size: 'sm', Card: CycleTimeCard, drill: DRILL_DELIVERY },
  { id: 'delivery.velocity', group: 'delivery', titleKey: 'delivVelocity', capability: CAP_DELIVERY, size: 'sm', Card: VelocityCard, drill: DRILL_DELIVERY },
  { id: 'delivery.estimation', group: 'delivery', titleKey: 'delivEstimation', capability: CAP_DELIVERY, size: 'sm', Card: EstimationCard, drill: DRILL_DELIVERY },
  { id: 'delivery.lifecycle-phases', group: 'delivery', titleKey: 'delivLifecyclePhases', capability: CAP_DELIVERY, size: 'md', Card: LifecyclePhasesCard, drill: DRILL_DELIVERY },
  { id: 'delivery.lifecycle-trend', group: 'delivery', titleKey: 'delivLifecycleTrend', capability: CAP_DELIVERY, size: 'md', Card: LifecycleTrendCard, drill: DRILL_DELIVERY },
  { id: 'delivery.velocity-trend', group: 'delivery', titleKey: 'delivVelocityTrend', capability: CAP_DELIVERY, size: 'md', Card: VelocityTrendCard, drill: DRILL_DELIVERY },
  { id: 'delivery.sprints', group: 'delivery', titleKey: 'delivSprints', capability: CAP_DELIVERY, size: 'lg', Card: SprintTableCard, drill: DRILL_DELIVERY },
  // DORA four-keys
  { id: 'dora.deploy-freq', group: 'dora', titleKey: 'doraDeployFreq', capability: CAP_DORA, size: 'sm', Card: DeployFreqCard, drill: DRILL_DORA },
  { id: 'dora.lead-time', group: 'dora', titleKey: 'doraLeadTime', capability: CAP_DORA, size: 'sm', Card: LeadTimeCard, drill: DRILL_DORA },
  { id: 'dora.change-fail', group: 'dora', titleKey: 'doraChangeFail', capability: CAP_DORA, size: 'sm', Card: ChangeFailCard, drill: DRILL_DORA },
  { id: 'dora.mttr', group: 'dora', titleKey: 'doraMttr', capability: CAP_DORA, size: 'sm', Card: MttrCard, drill: DRILL_DORA },
  { id: 'dora.total-deploys', group: 'dora', titleKey: 'doraTotalDeploys', capability: CAP_DORA, size: 'sm', Card: TotalDeploysCard, drill: DRILL_DORA },
  { id: 'dora.performance', group: 'dora', titleKey: 'doraPerformance', capability: CAP_DORA, size: 'lg', Card: DoraPerformanceCard, drill: DRILL_DORA },
  { id: 'dora.change-outcomes', group: 'dora', titleKey: 'doraChangeOutcomes', capability: CAP_DORA, size: 'md', Card: ChangeOutcomesCard, drill: DRILL_DORA },
];
