'use client';

/**
 * Workforce surfaces (Agents, Teams, Performance) decomposed into individually-
 * pinnable widgets — the "insights everywhere" rollout for the workforce pages
 * that previously showed only ONLINE/OFFLINE pills, member counts, and DORA tiles
 * as text.
 *
 * Every card reads its surface's EXISTING data client through the shared, deduped
 * source ({@link useSharedSource}), renders ONLY its body via the shared chart
 * primitives / the canonical {@link InsightStat}, and drills back to the relevant
 * /workforce tab. The Performance cards carry the member scorecard + DORA rollup
 * (a manager surface), so they self-gate behind the workforce-metrics capability
 * exactly like the /workforce Performance tab. Mirrors coreWidgets.tsx.
 */

import { useTranslations } from 'next-intl';
import {
  agentHosts,
  membersApi,
  type AgentHost,
  type MemberScorecard,
  type DoraRollup,
  type DisciplineRollup,
} from '@/lib/builderforceApi';
import { listMyAgents } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { listTeams, type TeamSummary } from '@/lib/teams';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { formatRecency } from '@/components/dashboard/metricFormat';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { colorAt } from '@/components/charts/chartColors';
import { int, score2 } from '@/components/insights/format';

/** Performance cards read the manager-only member scorecard + DORA rollup, which
 *  the API enforces at MANAGER+; gate the widgets with the DORA/engineering
 *  capability so non-managers see "Requires … role" instead of an empty card. */
const METRICS_CAP = 'insights.engineering' as const;

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────

interface AgentsData {
  hosts: AgentHost[];
  cloud: PublishedAgent[];
}
function useAgents() {
  return useSharedSource<AgentsData>('wf:agents', async () => {
    const [hosts, cloud] = await Promise.all([
      agentHosts.list().catch(() => [] as AgentHost[]),
      listMyAgents().catch(() => [] as PublishedAgent[]),
    ]);
    return { hosts: Array.isArray(hosts) ? hosts : [], cloud: Array.isArray(cloud) ? cloud : [] };
  });
}
function useTeams() {
  return useSharedSource<TeamSummary[]>('wf:teams', () => listTeams());
}
interface PerfData {
  members: MemberScorecard[];
  byDiscipline: DisciplineRollup[];
  dora: DoraRollup;
}
function usePerformance() {
  return useSharedSource<PerfData>('wf:performance', async () => {
    const [metrics, dora] = await Promise.all([
      membersApi.metrics(30),
      membersApi.dora(30),
    ]);
    return { members: metrics.members, byDiscipline: metrics.byDiscipline, dora };
  });
}

/** Top-N descending bars over a value accessor, dropping zero/empty values. */
function topBars<T>(items: T[], value: (t: T) => number, label: (t: T) => string, key: (t: T) => string, n = 8): BarDatum[] {
  return items
    .filter((it) => value(it) > 0)
    .sort((a, b) => value(b) - value(a))
    .slice(0, n)
    .map((it, i) => ({ key: key(it), label: label(it), value: value(it), color: colorAt(i) }));
}

// ── Workforce Agents (`/workforce`, group: 'wfAgents') ─────────────────────────

/** Online vs offline hosts + total agents — agent utilization at a glance. */
function AgentsOnlineCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useAgents();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const online = data.hosts.filter((h) => h.online).length;
  const offline = data.hosts.length - online;
  const cloud = data.cloud.length;
  const segments = [
    { key: 'online', label: t('wf.online'), value: online, color: 'rgba(34,197,94,0.9)' },
    { key: 'offline', label: t('wf.offline'), value: offline, color: colorAt(4) },
    { key: 'cloud', label: t('wf.cloud'), value: cloud, color: colorAt(1) },
  ].filter((s) => s.value > 0);
  if (segments.length === 0) return <Muted>{t('wf.noAgents')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={int(online + cloud)}
      centerLabel={t('wf.active')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.wfAgentsOnline')}
    />
  );
}

// ── Workforce Teams (`/workforce?tab=teams`, group: 'wfTeams') ─────────────────

/** Team sizes — team-shape clarity + the most-recent-touch recency badge. */
function TeamsSizeCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useTeams();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('wf.noTeams')}</Muted>;
  const bars = topBars(data, (tm) => tm.memberCount, (tm) => tm.name, (tm) => String(tm.id));
  let latest = -Infinity;
  for (const tm of data) { const ms = Date.parse(tm.updatedAt); if (Number.isFinite(ms) && ms > latest) latest = ms; }
  const recency = formatRecency(latest === -Infinity ? null : latest, dt);
  if (!bars.length) {
    return (
      <InsightStat
        label={t('title.wfTeamsSize')}
        value={int(data.length)}
        sub={t('wf.teamsEmptySub')}
        recencyLabel={recency}
        href="/workforce?tab=teams"
      />
    );
  }
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.wfTeamsSize')} />;
}

// ── Workforce Performance (`/workforce?tab=performance`, group: 'wfPerformance') ─

/** DORA deploy frequency gauge (manager surface). */
function DoraDeployFreqCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePerformance();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const per = data.dora.deploymentFrequencyPerDay;
  return (
    <GaugeChart
      value={per}
      min={0}
      max={Math.max(2, Math.ceil(per))}
      color={colorAt(0)}
      centerValue={`${score2(per)}`}
      centerLabel={t('wf.perDay')}
      ariaLabel={t('title.wfDoraDeployFreq')}
    />
  );
}

/** Average effectiveness by discipline — trend direction across the team. */
function PerformanceByDisciplineCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePerformance();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = data.byDiscipline
    .filter((d) => d.avgEffectiveness != null)
    .sort((a, b) => (b.avgEffectiveness ?? 0) - (a.avgEffectiveness ?? 0))
    .map((d, i) => ({ key: d.discipline, label: d.discipline, value: Math.round((d.avgEffectiveness ?? 0) * 100), color: colorAt(i) }));
  if (!bars.length) return <Muted>{t('wf.noPerformance')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => `${v}`} ariaLabel={t('title.wfPerformanceByDiscipline')} />;
}

/** Top members by completed work over the window. */
function PerformanceTopMembersCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePerformance();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data.members, (m) => m.completedCount, (m) => m.memberName, (m) => `${m.memberKind}:${m.memberRef}`);
  if (!bars.length) return <Muted>{t('wf.noPerformance')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.wfPerformanceTopMembers')} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const AGENTS_DRILL: WidgetDrill = { kind: 'route', href: '/workforce' };
const TEAMS_DRILL: WidgetDrill = { kind: 'route', href: '/workforce?tab=teams' };
const PERF_DRILL: WidgetDrill = { kind: 'route', href: '/workforce?tab=performance' };

export const WORKFORCE_WIDGETS: WidgetDef[] = [
  // ── Agents (`/workforce`) ──
  { id: 'wf.agents-online', group: 'wfAgents', titleKey: 'wfAgentsOnline', size: 'md', Card: AgentsOnlineCard, drill: AGENTS_DRILL },

  // ── Teams (`/workforce?tab=teams`) ──
  { id: 'wf.teams-size', group: 'wfTeams', titleKey: 'wfTeamsSize', size: 'md', Card: TeamsSizeCard, drill: TEAMS_DRILL },

  // ── Performance (`/workforce?tab=performance`) — manager-gated ──
  { id: 'wf.dora-deploy-freq', group: 'wfPerformance', titleKey: 'wfDoraDeployFreq', capability: METRICS_CAP, size: 'sm', Card: DoraDeployFreqCard, drill: PERF_DRILL },
  { id: 'wf.performance-by-discipline', group: 'wfPerformance', titleKey: 'wfPerformanceByDiscipline', capability: METRICS_CAP, size: 'md', Card: PerformanceByDisciplineCard, drill: PERF_DRILL },
  { id: 'wf.performance-top-members', group: 'wfPerformance', titleKey: 'wfPerformanceTopMembers', capability: METRICS_CAP, size: 'md', Card: PerformanceTopMembersCard, drill: PERF_DRILL },
];
