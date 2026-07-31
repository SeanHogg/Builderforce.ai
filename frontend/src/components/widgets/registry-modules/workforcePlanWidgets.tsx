'use client';

/**
 * Workforce-planning pinnable widgets — the blended human + agent capacity-vs-WIP
 * plan, decomposed into individually-pinnable cards for the app-wide widget
 * registry (see lib/widgets/types.ts). Each card reads the SAME /api/workforce/plan
 * source through the shared, deduped {@link useSharedSource} (one fetch across
 * pins), renders only its body via the shared chart primitives / InsightStat, and
 * drills to /workforce/plan. Manager surface → self-gates on the workforce-metrics
 * capability, matching WorkforcePlanView. Mirrors workforceWidgets.tsx.
 */

import { useTranslations } from 'next-intl';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { workforcePlanApi, type WorkforcePlan } from '@/lib/personaCadenceApi';

const METRICS_CAP = 'insights.engineering' as const;
const HUMAN_COLOR = colorAt(1);
const AGENT_COLOR = colorAt(3);
const int = (n: number) => Math.round(n).toLocaleString();
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function usePlan() {
  return useSharedSource<WorkforcePlan>('wf:plan', () => workforcePlanApi.get());
}

/** Hire-vs-agent weekly-cost split donut. */
function CostSplitCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePlan();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const segments = [
    { key: 'human', label: t('wfp.human'), value: data.totals.humanWeeklyCostUsd, color: HUMAN_COLOR },
    { key: 'agent', label: t('wfp.agent'), value: data.totals.agentWeeklyCostUsd, color: AGENT_COLOR },
  ].filter((s) => s.value > 0);
  if (segments.length === 0) return <Muted>{t('wfp.noCost')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={usd(data.totals.totalWeeklyCostUsd)}
      centerLabel={t('wfp.perWeek')}
      formatValue={(v) => usd(v)}
      ariaLabel={t('title.wfpCostSplit')}
    />
  );
}

/** Open WIP per member (top N), WIP ceiling as the faint comparison track. */
function CapacityCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePlan();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars: BarDatum[] = data.members
    .filter((m) => m.openWip > 0 || (m.maxConcurrentWip ?? 0) > 0)
    .slice(0, 8)
    .map((m) => ({
      key: `${m.memberKind}:${m.memberRef}`,
      label: m.memberName,
      value: m.openWip,
      secondary: m.maxConcurrentWip ?? undefined,
      color: m.overAllocated ? 'var(--coral-bright, #f4726e)' : (m.population === 'agent' ? AGENT_COLOR : HUMAN_COLOR),
    }));
  if (bars.length === 0) return <Muted>{t('wfp.empty')}</Muted>;
  return <BarChart data={bars} formatValue={int} ariaLabel={t('title.wfpCapacity')} />;
}

/** Allocatable capacity gap (unused WIP headroom) at a glance. */
function GapCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePlan();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  return (
    <InsightStat
      label={t('title.wfpGap')}
      value={int(data.totals.capacityGapWip)}
      sub={t('wfp.gapSub', { open: data.totals.totalOpenWip, max: data.totals.totalMaxWip })}
      href="/workforce/plan"
      color={colorAt(2)}
    />
  );
}

const DRILL: WidgetDrill = { kind: 'route', href: '/workforce/plan' };

export const WORKFORCE_PLAN_WIDGETS: WidgetDef[] = [
  { id: 'wfp.cost-split', group: 'wfPlan', titleKey: 'wfpCostSplit', capability: METRICS_CAP, size: 'md', Card: CostSplitCard, drill: DRILL },
  { id: 'wfp.capacity',   group: 'wfPlan', titleKey: 'wfpCapacity',  capability: METRICS_CAP, size: 'md', Card: CapacityCard,  drill: DRILL },
  { id: 'wfp.gap',        group: 'wfPlan', titleKey: 'wfpGap',       capability: METRICS_CAP, size: 'sm', Card: GapCard,       drill: DRILL },
];
