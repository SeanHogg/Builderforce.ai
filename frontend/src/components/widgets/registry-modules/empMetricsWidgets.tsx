'use client';

/**
 * Extended member / EMP metrics decomposed into individually-pinnable widgets —
 * the "insights everywhere" rollout for the EMP lenses (over-allocation,
 * collaboration, documentation, labour cost, performer tiers, initiative
 * allocation). Each card reads its lens's data client through the shared, deduped
 * source ({@link useSharedSource}), renders ONLY its body via the shared chart
 * primitives, and drills back to the /workforce Performance tab. All are
 * manager-gated (the EMP reads are MANAGER+ on the API), mirroring workforceWidgets.
 */

import { useTranslations } from 'next-intl';
import {
  empMetricsApi,
  type AllocationHealthResult,
  type CollaborationResult,
  type DocActivityResult,
  type LaborCostResult,
  type PerformerTiersResult,
  type MemberInitiativeAllocResult,
} from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { colorAt } from '@/components/charts/chartColors';
import { int, pct, usd } from '@/components/insights/format';

const METRICS_CAP = 'insights.engineering' as const;
const DANGER = 'var(--danger, #e5484d)';

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────
const useAllocation = () => useSharedSource<AllocationHealthResult>('emp:alloc', () => empMetricsApi.allocationHealth());
const useCollaboration = () => useSharedSource<CollaborationResult>('emp:collab', () => empMetricsApi.collaboration(30));
const useDocs = () => useSharedSource<DocActivityResult>('emp:docs', () => empMetricsApi.docActivity(30));
const useLabor = () => useSharedSource<LaborCostResult>('emp:labor', () => empMetricsApi.laborCost(30));
const useTiers = () => useSharedSource<PerformerTiersResult>('emp:tiers', () => empMetricsApi.performerTiers(30));
const useInitiatives = () => useSharedSource<MemberInitiativeAllocResult>('emp:init', () => empMetricsApi.initiativeAllocation(30));

function topBars<T>(items: T[], value: (t: T) => number, label: (t: T) => string, key: (t: T) => string, color?: (t: T, i: number) => string, n = 8): BarDatum[] {
  return items
    .filter((it) => value(it) > 0)
    .sort((a, b) => value(b) - value(a))
    .slice(0, n)
    .map((it, i) => ({ key: key(it), label: label(it), value: value(it), color: color ? color(it, i) : colorAt(i) }));
}

// ── EMP-12 — over-allocation (WIP utilization; over-allocated bars in red) ──────
function OverAllocatedCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useAllocation();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const bars = topBars(
    data.members,
    (m) => m.utilizationPct,
    (m) => m.name,
    (m) => `${m.memberKind}:${m.memberRef}`,
    (m, i) => (m.overAllocated ? DANGER : colorAt(i)),
  );
  if (!bars.length) return <Muted>{t('emp.noData')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => pct(v)} ariaLabel={t('title.empOverAllocated')} />;
}

// ── EMP-14 — collaboration score ────────────────────────────────────────────────
function CollabScoreCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useCollaboration();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const bars = topBars(data.members, (m) => m.collaborationScore, (m) => m.name, (m) => `${m.memberKind}:${m.memberRef}`);
  if (!bars.length) return <Muted>{t('emp.noData')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.empCollabScore')} />;
}

// ── EMP-17 — top documentation contributors ──────────────────────────────────────
function DocAuthorsCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useDocs();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const bars = topBars(data.members, (m) => m.score, (m) => m.name, (m) => m.memberRef);
  if (!bars.length) return <Muted>{t('emp.noData')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.empDocAuthors')} />;
}

// ── EMP-19 — labour cost by project ──────────────────────────────────────────────
function LaborByProjectCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useLabor();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const bars = topBars(data.byProject, (p) => p.costUsd, (p) => p.name, (p) => p.id);
  if (!bars.length) return <Muted>{t('emp.noData')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => usd(v)} ariaLabel={t('title.empLaborByProject')} />;
}

// ── EMP-16 — performer tiers (donut) ─────────────────────────────────────────────
function PerformerTiersCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useTiers();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const segments = [
    { key: 'high', label: t('emp.tierHigh'), value: data.counts.high, color: 'rgba(34,197,94,0.9)' },
    { key: 'solid', label: t('emp.tierSolid'), value: data.counts.solid, color: colorAt(1) },
    { key: 'watch', label: t('emp.tierWatch'), value: data.counts.watch, color: DANGER },
  ].filter((s) => s.value > 0);
  if (!segments.length) return <Muted>{t('emp.noData')}</Muted>;
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(total)}
      centerLabel={t('emp.member')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.empPerformerTiers')}
    />
  );
}

// ── EMP-13 — initiative allocation (total effort hours per initiative) ────────────
function InitiativeMixCard(_p: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useInitiatives();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  const hoursByInit = new Map<string, { name: string; hours: number }>();
  for (const m of data.members) for (const s of m.slices) {
    const cur = hoursByInit.get(s.initiativeId) ?? { name: s.initiativeName, hours: 0 };
    cur.hours += s.hours;
    hoursByInit.set(s.initiativeId, cur);
  }
  const bars = topBars([...hoursByInit.entries()], ([, v]) => v.hours, ([, v]) => v.name, ([id]) => id);
  if (!bars.length) return <Muted>{t('emp.noData')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => `${Math.round(v)}h`} ariaLabel={t('title.empInitiativeMix')} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────
const DRILL: WidgetDrill = { kind: 'route', href: '/workforce?tab=performance' };

export const EMP_METRICS_WIDGETS: WidgetDef[] = [
  { id: 'emp.over-allocated', group: 'empAllocation', titleKey: 'empOverAllocated', capability: METRICS_CAP, size: 'md', Card: OverAllocatedCard, drill: DRILL },
  { id: 'emp.collab-score', group: 'empCollaboration', titleKey: 'empCollabScore', capability: METRICS_CAP, size: 'md', Card: CollabScoreCard, drill: DRILL },
  { id: 'emp.doc-authors', group: 'empDocs', titleKey: 'empDocAuthors', capability: METRICS_CAP, size: 'md', Card: DocAuthorsCard, drill: DRILL },
  { id: 'emp.labor-by-project', group: 'empCost', titleKey: 'empLaborByProject', capability: METRICS_CAP, size: 'md', Card: LaborByProjectCard, drill: DRILL },
  { id: 'emp.performer-tiers', group: 'empPerformers', titleKey: 'empPerformerTiers', capability: METRICS_CAP, size: 'sm', Card: PerformerTiersCard, drill: DRILL },
  { id: 'emp.initiative-mix', group: 'empInitiatives', titleKey: 'empInitiativeMix', capability: METRICS_CAP, size: 'md', Card: InitiativeMixCard, drill: DRILL },
];
