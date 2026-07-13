'use client';

/**
 * Core (non-insights) surfaces, decomposed into individually-pinnable widgets —
 * the proof that the app-wide widget registry is NOT insights-only.
 *
 * Dashboard home (`/dashboard`) previously rendered its metrics as plain text
 * badges; they are converted here into pinnable {@link WidgetDef}s that draw a
 * CHART/STAT via the shared `@/components/charts/*` primitives — the four stat
 * cards (Projects, Tasks, Agents online, Pending requests) backed by
 * `fetchProjects`, `tasksApi`, `agentHosts`, and `approvalsApi`, all from one
 * shared, deduped read.
 *
 * (LLM-usage widgets used to live here too; they now ride the AI Insights hub —
 * see components/insights/widgets/llmUsageWidgets.tsx.)
 *
 * Mirrors aiImpactWidgets.tsx exactly: a `useSharedSource` hook per data source
 * so every card on a dashboard dedupes onto ONE fetch; each Card renders ONLY its
 * body (inline Stat/Muted helpers); the WidgetCard chrome owns frame/title/pin.
 * This is a non-insights surface, so the `drill` is a plain route navigation.
 */

import { useTranslations } from 'next-intl';
import {
  fetchProjects,
  listIdeProjects,
} from '@/lib/api';
import {
  tasksApi,
  agentHosts,
  approvalsApi,
  type Task,
  type AgentHost,
  type Approval,
} from '@/lib/builderforceApi';
import type { Project, IdeProject } from '@/lib/types';
import { MODALITIES, getModality } from '@/lib/modality';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { formatRecency } from '@/components/dashboard/metricFormat';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import { int } from '@/components/insights/format';

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────

/** Dashboard-home bundle: projects + tasks + hosts + pending approvals in one read. */
interface OverviewData {
  projects: Project[];
  tasks: Task[];
  hosts: AgentHost[];
  pendingApprovals: number;
}
function useOverview() {
  return useSharedSource<OverviewData>('core:overview', async () => {
    const [projects, tasks, hosts, approvals] = await Promise.all([
      fetchProjects().catch(() => [] as Project[]),
      tasksApi.list().catch(() => [] as Task[]),
      agentHosts.list().catch(() => [] as AgentHost[]),
      approvalsApi.list({ status: 'pending' }).catch(() => [] as Approval[]),
    ]);
    return {
      projects: Array.isArray(projects) ? projects : [],
      tasks: Array.isArray(tasks) ? tasks : [],
      hosts: Array.isArray(hosts) ? hosts : [],
      pendingApprovals: Array.isArray(approvals) ? approvals.length : 0,
    };
  });
}

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

/** Wrap an overview card body: handles loading / error so each widget needn't repeat it. */
function useOverviewBody() {
  const t = useTranslations('widgets');
  const { data, error } = useOverview();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── Dashboard-home widget bodies (group: 'overview') ───────────────────────────

function ProjectsCard(_props: WidgetCardProps) {
  const { data, state, t } = useOverviewBody();
  if (!data) return state;
  const active = data.projects.filter((p) => p.status === 'active').length;
  return <Stat value={int(data.projects.length)} sub={t('overview.activeOfTotal', { active })} />;
}

const TASK_DONE = 'done';
const TASK_IN_PROGRESS = 'in_progress';

function TasksCard(_props: WidgetCardProps) {
  const { data, state, t } = useOverviewBody();
  if (!data) return state;
  const total = data.tasks.length;
  const done = data.tasks.filter((x) => x.status === TASK_DONE).length;
  const inProgress = data.tasks.filter((x) => x.status === TASK_IN_PROGRESS).length;
  const other = Math.max(0, total - done - inProgress);
  const segments = [
    { key: 'done', label: t('overview.done'), value: done, color: colorAt(0) },
    { key: 'inProgress', label: t('overview.inProgress'), value: inProgress, color: colorAt(1) },
    { key: 'other', label: t('overview.other'), value: other, color: colorAt(2) },
  ].filter((s) => s.value > 0);
  if (total === 0 || segments.length === 0) return <Muted>{t('overview.noTasks')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={int(total)}
      centerLabel={t('overview.tasks')}
      formatValue={(v) => int(v)}
      ariaLabel={t('overview.taskBreakdown')}
    />
  );
}

function AgentsOnlineCard(_props: WidgetCardProps) {
  const { data, state, t } = useOverviewBody();
  if (!data) return state;
  const online = data.hosts.filter((h) => h.online).length;
  const total = data.hosts.length;
  if (total === 0) return <Muted>{t('overview.noHosts')}</Muted>;
  const bars = [
    { key: 'online', label: t('overview.online'), value: online, secondary: total, color: 'rgba(34,197,94,0.9)' },
  ];
  return (
    <div>
      <Stat value={int(online)} sub={t('overview.registeredCount', { total })} />
      <div style={{ marginTop: 12 }}>
        <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('overview.agentsOnline')} />
      </div>
    </div>
  );
}

function PendingApprovalsCard(_props: WidgetCardProps) {
  const { data, state, t } = useOverviewBody();
  if (!data) return state;
  const n = data.pendingApprovals;
  return <Stat value={int(n)} sub={n > 0 ? t('overview.requiresReview') : t('overview.allClear')} />;
}

// ── IDE dashboard (`/ide/dashboard`, group: 'ide') ─────────────────────────────

/** IDE projects split by modality — the IDE-portfolio composition view. */
function IdeByModalityCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const modalityCopy = useModalityCopy();
  const { data, error } = useSharedSource<IdeProject[]>('core:ide-projects', () => listIdeProjects());
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('ide.noProjects')}</Muted>;
  // Keep modality order stable per MODALITIES; label comes from the shared,
  // localized modality copy (single source, aliases legacy `llm` -> evermind).
  const counts = new Map<string, number>();
  for (const p of data) counts.set(getModality(p.modality).id, (counts.get(getModality(p.modality).id) ?? 0) + 1);
  const segments = MODALITIES
    .filter((m) => (counts.get(m.id) ?? 0) > 0)
    .map((m, i) => ({ key: m.id, label: modalityCopy(m.id).label, value: counts.get(m.id) ?? 0, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('ide.builds')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.ideByModality')}
    />
  );
}

/** IDE build count with the most-recently-touched recency badge (staleness signal). */
function IdeRecencyCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useSharedSource<IdeProject[]>('core:ide-projects', () => listIdeProjects());
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  let latest = -Infinity;
  for (const p of data) { const ms = Date.parse(p.updatedAt); if (Number.isFinite(ms) && ms > latest) latest = ms; }
  const recency = formatRecency(latest === -Infinity ? null : latest, dt);
  return (
    <InsightStat
      label={t('title.ideRecency')}
      value={int(data.length)}
      sub={t('ide.buildsSub')}
      recencyLabel={recency}
      href="/ide/dashboard"
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const DASHBOARD_DRILL: WidgetDrill = { kind: 'route', href: '/dashboard' };
const IDE_DRILL: WidgetDrill = { kind: 'route', href: '/ide/dashboard' };

export const CORE_WIDGETS: WidgetDef[] = [
  // ── Dashboard home (`/dashboard`) ──
  { id: 'core.projects', group: 'overview', titleKey: 'projects', size: 'sm', Card: ProjectsCard, drill: DASHBOARD_DRILL },
  { id: 'core.tasks', group: 'overview', titleKey: 'tasks', size: 'md', Card: TasksCard, drill: DASHBOARD_DRILL },
  { id: 'core.agents-online', group: 'overview', titleKey: 'agentsOnline', size: 'md', Card: AgentsOnlineCard, drill: DASHBOARD_DRILL },
  { id: 'core.pending-approvals', group: 'overview', titleKey: 'pendingApprovals', size: 'sm', Card: PendingApprovalsCard, drill: DASHBOARD_DRILL },

  // ── IDE dashboard (`/ide/dashboard`) ──
  { id: 'core.ide-by-modality', group: 'ide', titleKey: 'ideByModality', size: 'md', Card: IdeByModalityCard, drill: IDE_DRILL },
  { id: 'core.ide-recency', group: 'ide', titleKey: 'ideRecency', size: 'sm', Card: IdeRecencyCard, drill: IDE_DRILL },
];
