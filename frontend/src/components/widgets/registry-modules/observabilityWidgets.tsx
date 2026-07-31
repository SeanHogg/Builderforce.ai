'use client';

/**
 * Observability / knowledge surfaces (Alerts, Logs, Quality, Integrations,
 * Content Manager) decomposed into individually-pinnable widgets — the "insights
 * everywhere" rollout for the surfaces that previously showed their signal only as
 * a raw list or a text badge.
 *
 * Every card reads its surface's EXISTING data client through the shared, deduped
 * source ({@link useSharedSource} → one request per surface regardless of how many
 * of its widgets are pinned), renders ONLY its body via the shared chart
 * primitives / the canonical {@link InsightStat}, and drills back to its source
 * route. Mirrors operationalWidgets.tsx / catalogWidgets.tsx exactly — no new
 * backend endpoint where the surface already fetches the signal.
 */

import { useTranslations } from 'next-intl';
import {
  alertsApi,
  analyticsApi,
  qualityApi,
  integrationsApi,
  ceremonySessionsApi,
  type Alert,
  type AlertEvent,
  type TenantActivityRollup,
  type QualityStats,
  type IntegrationCredential,
  type CeremonyRollup,
} from '@/lib/builderforceApi';
import { knowledgeApi, type KnowledgeOverview } from '@/lib/knowledgeApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { formatRecency } from '@/components/dashboard/metricFormat';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { int } from '@/components/insights/format';

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Most-recent ISO timestamp across a list (drives the "last activity Xh ago" badge). */
function latestTs(times: Array<string | null | undefined>): number | null {
  let max = -Infinity;
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  return max === -Infinity ? null : max;
}

/**
 * Bucket ISO timestamps into a per-UTC-day count series spanning the last `days`
 * days (inclusive of today), producing aligned `{ labels, values }` for a
 * TrendChart. Zero-fills empty days so the trend reads honestly.
 */
function dailySeries(times: Array<string | null | undefined>, days: number, nowMs: number): { labels: string[]; values: number[] } {
  const span = Math.max(1, Math.min(days, 90));
  const DAY = 86_400_000;
  const today = Math.floor(nowMs / DAY);
  const counts = new Array<number>(span).fill(0);
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) continue;
    const idx = span - 1 - (today - Math.floor(ms / DAY));
    if (idx >= 0 && idx < span) counts[idx] += 1;
  }
  const labels = counts.map((_, i) => {
    const d = new Date((today - (span - 1 - i)) * DAY);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  });
  return { labels, values: counts };
}

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────

function useAlertRules() {
  return useSharedSource<Alert[]>('obs:alert-rules', () => alertsApi.list().then((r) => r.alerts));
}
function useAlertEvents() {
  return useSharedSource<AlertEvent[]>('obs:alert-events', () => alertsApi.listEvents({ limit: 200 }).then((r) => r.events));
}
function useActivityRollup(days: number) {
  return useSharedSource<TenantActivityRollup>(`obs:activity:${days}`, () => analyticsApi.tenantRollup(days));
}
function useQualityStats(days: number) {
  return useSharedSource<QualityStats>(`obs:quality:${days}`, () => qualityApi.stats(null, days));
}
function useIntegrations() {
  return useSharedSource<IntegrationCredential[]>('obs:integrations', () => integrationsApi.list());
}
function useKnowledgeOverview() {
  return useSharedSource<KnowledgeOverview>('obs:knowledge', () => knowledgeApi.overview());
}
function useCeremonyRollup(days: number) {
  return useSharedSource<CeremonyRollup>(`obs:ceremonies:${days}`, () => ceremonySessionsApi.rollup(days));
}

// ── Alerts (`/alerts`, group: 'alerts') ─────────────────────────────────────────

/** Alert firings per day over the window — the volume trend the surface lacked. */
function AlertFiresTrendCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useAlertEvents();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('obs.noFirings')}</Muted>;
  const { labels, values } = dailySeries(data.map((e) => e.createdAt), days, Date.now());
  return (
    <TrendChart
      labels={labels}
      series={[{ key: 'fires', label: t('obs.firesPerDay'), values, color: colorAt(1) }]}
      height={180}
      area
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsAlertFires')}
    />
  );
}

/** Rule-health donut: enabled vs paused vs currently-firing rules. */
function AlertRuleHealthCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useAlertRules();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('obs.noRules')}</Muted>;
  const DAY = 86_400_000;
  const now = Date.now();
  let firing = 0, enabled = 0, paused = 0;
  for (const r of data) {
    if (!r.enabled) { paused += 1; continue; }
    const recentlyFired = r.lastTriggeredAt && now - Date.parse(r.lastTriggeredAt) < r.windowDays * DAY;
    if (recentlyFired) firing += 1; else enabled += 1;
  }
  const segments = [
    { key: 'firing', label: t('obs.firing'), value: firing, color: 'rgba(239,68,68,0.9)' },
    { key: 'healthy', label: t('obs.healthy'), value: enabled, color: 'rgba(34,197,94,0.9)' },
    { key: 'paused', label: t('obs.paused'), value: paused, color: colorAt(4) },
  ].filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('obs.rules')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsAlertRuleHealth')}
    />
  );
}

// ── Logs / activity (`/logs`, group: 'logs') ────────────────────────────────────

/** Event-volume trend from the tenant activity rollup's daily series. */
function LogVolumeTrendCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useActivityRollup(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (!data.daily.length) return <Muted>{t('obs.noEvents')}</Muted>;
  const labels = data.daily.map((d) => d.date.slice(5));
  const values = data.daily.map((d) => d.count);
  return (
    <TrendChart
      labels={labels}
      series={[{ key: 'events', label: t('obs.eventsPerDay'), values, color: colorAt(0) }]}
      height={180}
      area
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsLogVolume')}
    />
  );
}

/** Event-type mix donut (commit / review / deploy / …) from the rollup's byType. */
function LogTypeMixCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useActivityRollup(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const entries = Object.entries(data.byType).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return <Muted>{t('obs.noEvents')}</Muted>;
  const segments = entries.map(([k, v], i) => ({ key: k, label: k.replace(/_/g, ' '), value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.totalEvents)}
      centerLabel={t('obs.events')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsLogTypes')}
    />
  );
}

// ── Quality (`/quality`, group: 'quality') ──────────────────────────────────────

/** Error-event volume per day over the window (from /api/quality/stats daily). */
function QualityErrorVolumeCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useQualityStats(30);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (!data.daily.length) return <Muted>{t('obs.noErrors')}</Muted>;
  const labels = data.daily.map((d) => d.day.slice(5));
  const values = data.daily.map((d) => d.count);
  return (
    <TrendChart
      labels={labels}
      series={[{ key: 'errors', label: t('obs.errorsPerDay'), values, color: 'rgba(239,68,68,0.85)' }]}
      height={180}
      area
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsQualityVolume')}
    />
  );
}

/** Resolution mix donut: unresolved / resolved / ignored error groups. */
function QualityResolutionCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useQualityStats(30);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (!data.byStatus.length) return <Muted>{t('obs.noErrors')}</Muted>;
  const COLORS: Record<string, string> = {
    unresolved: 'rgba(239,68,68,0.9)', fixing: colorAt(1), resolved: 'rgba(34,197,94,0.9)', ignored: colorAt(4),
  };
  const KNOWN = new Set(['unresolved', 'fixing', 'resolved', 'ignored']);
  const segments = data.byStatus
    .sort((a, b) => b.groups - a.groups)
    .map((s, i) => ({
      key: s.status,
      label: KNOWN.has(s.status) ? t(`obs.status_${s.status}`) : s.status,
      value: s.groups,
      color: COLORS[s.status] ?? colorAt(i),
    }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.totals.groups)}
      centerLabel={t('obs.groups')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsQualityResolution')}
    />
  );
}

// ── Integrations (`/integrations`, group: 'integrations') ───────────────────────

/** Connected integrations with the healthy (last-test-ok) share as the sub-line. */
function IntegrationsConnectedCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useIntegrations();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const enabled = data.filter((i) => i.isEnabled).length;
  const healthy = data.filter((i) => i.lastTestOk === true).length;
  const recency = formatRecency(latestTs(data.map((i) => i.lastTestedAt ?? i.updatedAt ?? i.createdAt)), dt);
  return (
    <InsightStat
      label={t('title.obsIntegrationsConnected')}
      value={int(enabled)}
      sub={t('obs.integrationsSub', { total: data.length, healthy })}
      recencyLabel={recency}
      href="/integrations"
    />
  );
}

/** By-provider mix donut — which tools the workspace is wired into. */
function IntegrationsByProviderCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useIntegrations();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('obs.noIntegrations')}</Muted>;
  const counts = new Map<string, number>();
  for (const i of data) counts.set(i.provider, (counts.get(i.provider) ?? 0) + 1);
  const segments = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ key: k, label: k, value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('obs.connected')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsIntegrationsByProvider')}
    />
  );
}

// ── Content Manager (`/content-manager`, group: 'content') ──────────────────────

/** Knowledge-base coverage score with the stale-doc count as the nudge. */
function ContentCoverageCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useKnowledgeOverview();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  return (
    <InsightStat
      label={t('title.obsContentCoverage')}
      value={`${Math.round(data.coverage.score)}%`}
      sub={t('obs.coverageSub', { present: data.coverage.present, total: data.coverage.total })}
      nudge={data.stale > 0 ? t('obs.staleNudge', { count: data.stale, days: data.staleDays }) : undefined}
      href="/content-manager"
    />
  );
}

/** Documents by kind donut (SOP / Process / Doc) with published vs draft split. */
function ContentByKindCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useKnowledgeOverview();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const c = data.counts;
  if (c.total === 0) return <Muted>{t('obs.noDocs')}</Muted>;
  const segments = [
    { key: 'sop', label: t('obs.sop'), value: c.sop, color: colorAt(0) },
    { key: 'process', label: t('obs.process'), value: c.process, color: colorAt(1) },
    { key: 'doc', label: t('obs.doc'), value: c.doc, color: colorAt(2) },
  ].filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(c.total)}
      centerLabel={t('obs.docs')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsContentByKind')}
    />
  );
}

// ── Ceremonies (`/projects?tab=ceremonies`, group: 'ceremonies') ────────────────

/** Ceremonies-run cadence per day + completion-rate sub-line. */
function CeremonyCadenceCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useCeremonyRollup(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.totals.sessions === 0) return <Muted>{t('obs.noCeremonies')}</Muted>;
  const labels = data.series.map((d) => d.day.slice(5));
  const values = data.series.map((d) => d.sessions);
  return (
    <TrendChart
      labels={labels}
      series={[{ key: 'sessions', label: t('obs.ceremoniesPerDay'), values, color: colorAt(3) }]}
      height={180}
      area
      formatValue={(v) => int(v)}
      ariaLabel={t('title.obsCeremonyCadence')}
    />
  );
}

/** Talk-time balance donut: human vs AI-agent share of ceremony speaking time. */
function CeremonyBalanceCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useCeremonyRollup(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.totals.participants === 0) return <Muted>{t('obs.noCeremonies')}</Muted>;
  const agent = Math.round(data.totals.agentTalkShare * 100);
  const human = 100 - agent;
  const segments = [
    { key: 'human', label: t('obs.humanTalk'), value: human, color: colorAt(0) },
    { key: 'agent', label: t('obs.agentTalk'), value: agent, color: colorAt(1) },
  ].filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={`${Math.round(data.totals.completionRate * 100)}%`}
      centerLabel={t('obs.completed')}
      formatValue={(v) => `${v}%`}
      ariaLabel={t('title.obsCeremonyBalance')}
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const ALERTS_DRILL: WidgetDrill = { kind: 'route', href: '/alerts' };
const CEREMONIES_DRILL: WidgetDrill = { kind: 'route', href: '/projects?tab=ceremonies' };
const LOGS_DRILL: WidgetDrill = { kind: 'route', href: '/logs' };
const QUALITY_DRILL: WidgetDrill = { kind: 'route', href: '/quality' };
const INTEGRATIONS_DRILL: WidgetDrill = { kind: 'route', href: '/integrations' };
const CONTENT_DRILL: WidgetDrill = { kind: 'route', href: '/content-manager' };

export const OBSERVABILITY_WIDGETS: WidgetDef[] = [
  // ── Alerts (`/alerts`) ──
  { id: 'obs.alert-fires', group: 'alerts', titleKey: 'obsAlertFires', size: 'md', capability: 'insights.engineering', Card: AlertFiresTrendCard, drill: ALERTS_DRILL },
  { id: 'obs.alert-rule-health', group: 'alerts', titleKey: 'obsAlertRuleHealth', size: 'md', capability: 'insights.engineering', Card: AlertRuleHealthCard, drill: ALERTS_DRILL },

  // ── Logs / activity (`/logs`) — the tenant activity rollup is manager-gated ──
  { id: 'obs.log-volume', group: 'logs', titleKey: 'obsLogVolume', size: 'md', capability: 'insights.engineering', Card: LogVolumeTrendCard, drill: LOGS_DRILL },
  { id: 'obs.log-types', group: 'logs', titleKey: 'obsLogTypes', size: 'md', capability: 'insights.engineering', Card: LogTypeMixCard, drill: LOGS_DRILL },

  // ── Quality (`/quality`) ──
  { id: 'obs.quality-volume', group: 'quality', titleKey: 'obsQualityVolume', size: 'md', capability: 'quality.view', Card: QualityErrorVolumeCard, drill: QUALITY_DRILL },
  { id: 'obs.quality-resolution', group: 'quality', titleKey: 'obsQualityResolution', size: 'md', capability: 'quality.view', Card: QualityResolutionCard, drill: QUALITY_DRILL },

  // ── Integrations (`/integrations`) ──
  { id: 'obs.integrations-connected', group: 'integrations', titleKey: 'obsIntegrationsConnected', size: 'sm', Card: IntegrationsConnectedCard, drill: INTEGRATIONS_DRILL },
  { id: 'obs.integrations-by-provider', group: 'integrations', titleKey: 'obsIntegrationsByProvider', size: 'md', Card: IntegrationsByProviderCard, drill: INTEGRATIONS_DRILL },

  // ── Content Manager (`/content-manager`) ──
  { id: 'obs.content-coverage', group: 'content', titleKey: 'obsContentCoverage', size: 'sm', Card: ContentCoverageCard, drill: CONTENT_DRILL },
  { id: 'obs.content-by-kind', group: 'content', titleKey: 'obsContentByKind', size: 'md', Card: ContentByKindCard, drill: CONTENT_DRILL },

  // ── Ceremonies (`/projects?tab=ceremonies`) — tenant rollup is manager-gated ──
  { id: 'obs.ceremony-cadence', group: 'ceremonies', titleKey: 'obsCeremonyCadence', size: 'md', capability: 'insights.engineering', Card: CeremonyCadenceCard, drill: CEREMONIES_DRILL },
  { id: 'obs.ceremony-balance', group: 'ceremonies', titleKey: 'obsCeremonyBalance', size: 'md', capability: 'insights.engineering', Card: CeremonyBalanceCard, drill: CEREMONIES_DRILL },
];
