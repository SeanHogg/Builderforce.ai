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
} from '@/lib/api';
import {
  tasksApi,
  agentHosts,
  approvalsApi,
  type Task,
  type AgentHost,
  type Approval,
} from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
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

// ── Registry ─────────────────────────────────────────────────────────────────

const DASHBOARD_DRILL: WidgetDrill = { kind: 'route', href: '/dashboard' };

export const CORE_WIDGETS: WidgetDef[] = [
  // ── Dashboard home (`/dashboard`) ──
  { id: 'core.projects', group: 'overview', titleKey: 'projects', size: 'sm', Card: ProjectsCard, drill: DASHBOARD_DRILL },
  { id: 'core.tasks', group: 'overview', titleKey: 'tasks', size: 'md', Card: TasksCard, drill: DASHBOARD_DRILL },
  { id: 'core.agents-online', group: 'overview', titleKey: 'agentsOnline', size: 'md', Card: AgentsOnlineCard, drill: DASHBOARD_DRILL },
  { id: 'core.pending-approvals', group: 'overview', titleKey: 'pendingApprovals', size: 'sm', Card: PendingApprovalsCard, drill: DASHBOARD_DRILL },
];
