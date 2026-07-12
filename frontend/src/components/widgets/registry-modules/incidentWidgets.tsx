'use client';

/**
 * Incident Management (`/incidents`) decomposed into individually-pinnable widgets
 * — the "insights everywhere" rollout for the reliability surface, so a human asking
 * "how are things looking?" sees open incidents, severity mix, hot systems and MTTR
 * as chart tiles they can pin to /insights or drop on a shared dashboard.
 *
 * Every card reads the SINGLE already-aggregated monitoring report
 * ({@link monitoringApi.getReport} → total / open / bySeverity / bySystem /
 * mttrMinutes / recent) through the shared, deduped source (one request regardless
 * of how many incident widgets are pinned), renders ONLY its body via the shared
 * chart primitives / the canonical {@link InsightStat}, and drills back to the
 * incident reporting view. Mirrors observabilityWidgets.tsx — no new endpoint.
 */

import { useTranslations } from 'next-intl';
import { monitoringApi, type MonitoringReport, type IncidentSeverity } from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { formatRecency } from '@/components/dashboard/metricFormat';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { colorAt } from '@/components/charts/chartColors';
import { int } from '@/components/insights/format';

// ── Shared, deduped source (one fetch regardless of pins) ───────────────────────

function useMonitoringReport() {
  return useSharedSource<MonitoringReport>('inc:report', () => monitoringApi.getReport());
}

/** Most-recent ISO timestamp across a list (drives the "last incident Xh ago" badge). */
function latestTs(times: Array<string | null | undefined>): number | null {
  let max = -Infinity;
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  return max === -Infinity ? null : max;
}

/** Severity → badge colour, matching the incident page's SEVERITY_BADGE mapping. */
const SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  sev1: 'rgba(239,68,68,0.9)',  // red
  sev2: 'rgba(249,115,22,0.9)', // orange
  sev3: 'rgba(245,158,11,0.9)', // amber
  sev4: 'rgba(59,130,246,0.9)', // blue
};
const SEVERITY_ORDER: IncidentSeverity[] = ['sev1', 'sev2', 'sev3', 'sev4'];

/** minutes → compact "1.4h" / "37m" / "—". */
function fmtMinutes(m: number | null): string {
  if (m == null) return '—';
  return m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${Math.round(m)}m`;
}

// ── Widgets ─────────────────────────────────────────────────────────────────────

/** Open-vs-total incidents with recency + an "all clear" / "N open" nudge. */
function IncidentStatusCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useMonitoringReport();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const { open, total, recent } = data.incidents;
  const recency = formatRecency(latestTs(recent.map((i) => i.startedAt)), dt);
  return (
    <InsightStat
      label={t('title.incStatus')}
      value={int(open)}
      sub={t('inc.ofTotal', { total })}
      nudge={open > 0 ? t('inc.openNudge', { count: open }) : t('inc.allClear')}
      recencyLabel={recency}
      color={open > 0 ? 'rgba(239,68,68,0.9)' : undefined}
      href="/incidents"
    />
  );
}

/** Severity mix donut (sev1..sev4) over the window. */
function IncidentSeverityCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useMonitoringReport();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const { bySeverity, total } = data.incidents;
  if (total === 0) return <Muted>{t('inc.noIncidents')}</Muted>;
  const segments = SEVERITY_ORDER
    .map((s) => ({ key: s, label: t(`inc.${s}`), value: bySeverity[s] ?? 0, color: SEVERITY_COLOR[s] }))
    .filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(total)}
      centerLabel={t('inc.incidents')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.incSeverity')}
    />
  );
}

/** By-affected-system donut — which systems are burning (top 6). */
function IncidentSystemCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useMonitoringReport();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const { bySystem, total } = data.incidents;
  const entries = Object.entries(bySystem).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return <Muted>{t('inc.noIncidents')}</Muted>;
  const segments = entries.map(([k, v], i) => ({
    key: k,
    label: k || t('inc.unclassified'),
    value: v,
    color: colorAt(i),
  }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(total)}
      centerLabel={t('inc.incidents')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.incSystems')}
    />
  );
}

/** Mean time to resolve — the reliability headline number. */
function IncidentMttrCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useMonitoringReport();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  return (
    <InsightStat
      label={t('title.incMttr')}
      value={fmtMinutes(data.incidents.mttrMinutes)}
      sub={t('inc.mttrSub')}
      href="/incidents?tab=reporting"
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const INCIDENTS_DRILL: WidgetDrill = { kind: 'route', href: '/incidents' };
const REPORTING_DRILL: WidgetDrill = { kind: 'route', href: '/incidents?tab=reporting' };

export const INCIDENT_WIDGETS: WidgetDef[] = [
  { id: 'inc.status', group: 'incidents', titleKey: 'incStatus', size: 'sm', capability: 'quality.view', Card: IncidentStatusCard, drill: INCIDENTS_DRILL },
  { id: 'inc.severity', group: 'incidents', titleKey: 'incSeverity', size: 'md', capability: 'quality.view', Card: IncidentSeverityCard, drill: REPORTING_DRILL },
  { id: 'inc.systems', group: 'incidents', titleKey: 'incSystems', size: 'md', capability: 'quality.view', Card: IncidentSystemCard, drill: REPORTING_DRILL },
  { id: 'inc.mttr', group: 'incidents', titleKey: 'incMttr', size: 'sm', capability: 'quality.view', Card: IncidentMttrCard, drill: REPORTING_DRILL },
];
