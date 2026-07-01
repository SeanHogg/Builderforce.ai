'use client';

/**
 * Operational / delivery surfaces (Tasks board, Workflows list, Brainstorm/Brain
 * chats) decomposed into individually-pinnable widgets — the "insights everywhere"
 * rollout for the surfaces that previously showed their run/recency signal only as
 * text.
 *
 * Every card reads its surface's EXISTING data client through the shared, deduped
 * source ({@link useSharedSource} → one request per surface regardless of how many
 * of its widgets are pinned), renders ONLY its body via the shared chart
 * primitives / the canonical {@link InsightStat}, and drills back to its source
 * route. No new backend endpoint — the signal is already fetched by these pages.
 * Mirrors coreWidgets.tsx / catalogWidgets.tsx exactly.
 */

import { useTranslations } from 'next-intl';
import {
  tasksApi,
  workflowDefinitions,
  brain,
  type Task,
  type WorkflowDefinitionSummary,
  type BrainChat,
} from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { formatRecency } from '@/components/dashboard/metricFormat';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import { int } from '@/components/insights/format';

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────

function useTasks() {
  return useSharedSource<Task[]>('op:tasks', () => tasksApi.list());
}
function useWorkflows() {
  return useSharedSource<WorkflowDefinitionSummary[]>('op:workflows', () => workflowDefinitions.list());
}
function useBrainChats() {
  return useSharedSource<BrainChat[]>('op:brain-chats', () => brain.listChats({ limit: 200 }));
}

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

/** Top-N descending bars over a value accessor, dropping zero/empty values. */
function topBars<T>(items: T[], value: (t: T) => number, label: (t: T) => string, key: (t: T) => string, n = 8): BarDatum[] {
  return items
    .filter((it) => value(it) > 0)
    .sort((a, b) => value(b) - value(a))
    .slice(0, n)
    .map((it, i) => ({ key: key(it), label: label(it), value: value(it), color: colorAt(i) }));
}

// ── Tasks board (`/tasks`, group: 'tasks') ─────────────────────────────────────

const DONE_KEYS = new Set(['done', 'completed', 'closed']);
const IN_PROGRESS_KEYS = new Set(['in_progress', 'in-progress', 'doing']);

function TasksByStatusCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useTasks();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const live = data.filter((x) => !x.archived);
  if (live.length === 0) return <Muted>{t('op.noTasks')}</Muted>;
  const done = live.filter((x) => DONE_KEYS.has(x.status)).length;
  const inProgress = live.filter((x) => IN_PROGRESS_KEYS.has(x.status)).length;
  const other = Math.max(0, live.length - done - inProgress);
  const segments = [
    { key: 'done', label: t('op.done'), value: done, color: colorAt(0) },
    { key: 'inProgress', label: t('op.inProgress'), value: inProgress, color: colorAt(1) },
    { key: 'backlog', label: t('op.backlog'), value: other, color: colorAt(2) },
  ].filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(live.length)}
      centerLabel={t('op.tasks')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.opTasksByStatus')}
    />
  );
}

/** WIP (in-progress count) with the board's most-recent-update recency badge. */
function TasksWipCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useTasks();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const live = data.filter((x) => !x.archived);
  const wip = live.filter((x) => IN_PROGRESS_KEYS.has(x.status)).length;
  const recency = formatRecency(latestTs(live.map((x) => x.updatedAt)), dt);
  return (
    <InsightStat
      label={t('title.opTasksWip')}
      value={int(wip)}
      sub={t('op.wipSub', { total: live.length })}
      recencyLabel={recency}
      href="/tasks"
    />
  );
}

// ── Workflows (`/workflows`, group: 'workflows') ───────────────────────────────

/** Which workflows have run the most — surfaces the busy vs dormant automations. */
function WorkflowRunsCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useWorkflows();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (w) => w.runCount ?? 0, (w) => w.name, (w) => w.id);
  if (!bars.length) return <Muted>{t('op.noRuns')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.opWorkflowRuns')} />;
}

/** Last-run outcome mix across all workflows — spot the failing/stale ones. */
function WorkflowHealthCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useWorkflows();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('op.noWorkflows')}</Muted>;
  let ok = 0, failed = 0, never = 0;
  for (const w of data) {
    const s = (w.lastRunStatus ?? '').toLowerCase();
    if (!s) never += 1;
    else if (s === 'failed' || s === 'error' || s === 'needs_attention') failed += 1;
    else ok += 1;
  }
  const segments = [
    { key: 'ok', label: t('op.healthy'), value: ok, color: 'rgba(34,197,94,0.9)' },
    { key: 'failed', label: t('op.failing'), value: failed, color: 'rgba(239,68,68,0.9)' },
    { key: 'never', label: t('op.neverRun'), value: never, color: colorAt(4) },
  ].filter((s) => s.value > 0);
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('op.workflows')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.opWorkflowHealth')}
    />
  );
}

// ── Brainstorm / Brain chats (`/brainstorm`, group: 'brain') ───────────────────

/** Chats grouped by where they were created (brainstorm / ide / project). */
function BrainChatsByOriginCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useBrainChats();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('op.noChats')}</Muted>;
  const counts = new Map<string, number>();
  for (const c of data) {
    const o = c.origin || t('op.originOther');
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const segments = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ key: k, label: k, value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('op.chats')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.opBrainByOrigin')}
    />
  );
}

/** Total active threads with the most-recent-activity recency badge. */
function BrainActivityCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const dt = useTranslations('dashboard');
  const { data, error } = useBrainChats();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const recency = formatRecency(latestTs(data.map((c) => c.updatedAt)), dt);
  const scoped = data.filter((c) => c.projectId != null).length;
  return (
    <InsightStat
      label={t('title.opBrainActivity')}
      value={int(data.length)}
      sub={t('op.chatsScopedSub', { scoped })}
      recencyLabel={recency}
      href="/brainstorm"
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const TASKS_DRILL: WidgetDrill = { kind: 'route', href: '/tasks' };
const WORKFLOWS_DRILL: WidgetDrill = { kind: 'route', href: '/workflows' };
const BRAIN_DRILL: WidgetDrill = { kind: 'route', href: '/brainstorm' };

export const OPERATIONAL_WIDGETS: WidgetDef[] = [
  // ── Tasks board (`/tasks`) ──
  { id: 'op.tasks-by-status', group: 'tasks', titleKey: 'opTasksByStatus', size: 'md', Card: TasksByStatusCard, drill: TASKS_DRILL },
  { id: 'op.tasks-wip', group: 'tasks', titleKey: 'opTasksWip', size: 'sm', Card: TasksWipCard, drill: TASKS_DRILL },

  // ── Workflows (`/workflows`) ──
  { id: 'op.workflow-runs', group: 'workflows', titleKey: 'opWorkflowRuns', size: 'md', Card: WorkflowRunsCard, drill: WORKFLOWS_DRILL },
  { id: 'op.workflow-health', group: 'workflows', titleKey: 'opWorkflowHealth', size: 'md', Card: WorkflowHealthCard, drill: WORKFLOWS_DRILL },

  // ── Brainstorm / Brain chats (`/brainstorm`) ──
  { id: 'op.brain-by-origin', group: 'brain', titleKey: 'opBrainByOrigin', size: 'md', Card: BrainChatsByOriginCard, drill: BRAIN_DRILL },
  { id: 'op.brain-activity', group: 'brain', titleKey: 'opBrainActivity', size: 'sm', Card: BrainActivityCard, drill: BRAIN_DRILL },
];
