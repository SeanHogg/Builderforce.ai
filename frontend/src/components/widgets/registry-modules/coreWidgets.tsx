'use client';

/**
 * Core (non-insights) surfaces, decomposed into individually-pinnable widgets —
 * the proof that the app-wide widget registry is NOT insights-only.
 *
 * Two surfaces that previously rendered their metrics as plain text badges are
 * converted here into pinnable {@link WidgetDef}s that draw a CHART/STAT via the
 * shared `@/components/charts/*` primitives:
 *
 *   • Dashboard home (`/dashboard`) — the four stat cards (Projects, Tasks,
 *     Agents online, Pending requests) backed by `fetchProjects`, `tasksApi`,
 *     `agentHosts`, and `approvalsApi`. One shared, deduped read of all four.
 *   • LLM Usage (`/workforce?tab=llm`) — token totals + by-model split from
 *     `llmApi.usage()`, and the cost-bearing by-source breakdown from
 *     `dashboardApi.usage()` (manager-gated, mirroring the page's "manager
 *     surface" note).
 *
 * Mirrors aiImpactWidgets.tsx exactly: a `useSharedSource` hook per data source
 * so every card on a dashboard dedupes onto ONE fetch; each Card renders ONLY its
 * body (inline Stat/Muted helpers); the WidgetCard chrome owns frame/title/pin.
 * These are non-insights surfaces, so the `drill` is a plain route navigation.
 */

import { useTranslations } from 'next-intl';
import {
  fetchProjects,
} from '@/lib/api';
import {
  tasksApi,
  agentHosts,
  approvalsApi,
  llmApi,
  dashboardApi,
  type Task,
  type AgentHost,
  type Approval,
  type LlmUsageStats,
  type DashboardUsage,
} from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import { usd, int } from '@/components/insights/format';

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

/** LLM provider usage totals + per-model split (`/llm/v1/usage`). */
function useLlmUsage() {
  return useSharedSource<LlmUsageStats>('core:llm-usage', () => llmApi.usage());
}

/** Token + estimated-cost usage split by source — cloud/on-prem/web (`/api/dashboard/usage`). */
function useLlmBySource() {
  return useSharedSource<DashboardUsage>('core:llm-by-source:week', () => dashboardApi.usage('week'));
}

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

function Stat({ value, sub }: { value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{children}</span>;
}

/** Wrap an overview card body: handles loading / error so each widget needn't repeat it. */
function useOverviewBody() {
  const t = useTranslations('widgets');
  const { data, error } = useOverview();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

function useLlmUsageBody() {
  const t = useTranslations('widgets');
  const { data, error } = useLlmUsage();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

function useLlmBySourceBody() {
  const t = useTranslations('widgets');
  const { data, error } = useLlmBySource();
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

// ── LLM-usage widget bodies (group: 'llmUsage') ────────────────────────────────

function LlmTokensCard(_props: WidgetCardProps) {
  const { data, state, t } = useLlmUsageBody();
  if (!data) return state;
  return (
    <div>
      <Stat value={int(data.totalTokens)} sub={t('llmUsage.tokensSub')} />
      <div style={{ marginTop: 12 }}>
        <BarChart
          data={[
            { key: 'prompt', label: t('llmUsage.prompt'), value: data.promptTokens, color: colorAt(0) },
            { key: 'completion', label: t('llmUsage.completion'), value: data.completionTokens, color: colorAt(1) },
          ]}
          formatValue={(v) => int(v)}
          ariaLabel={t('llmUsage.tokenSplit')}
        />
      </div>
    </div>
  );
}

function LlmRequestsCard(_props: WidgetCardProps) {
  const { data, state, t } = useLlmUsageBody();
  if (!data) return state;
  return <Stat value={int(data.totalRequests)} sub={t('llmUsage.requestsSub')} />;
}

function LlmByModelCard(_props: WidgetCardProps) {
  const { data, state, t } = useLlmUsageBody();
  if (!data) return state;
  const models = (data.byModel ?? []).filter((m) => m.tokens > 0);
  if (models.length === 0) return <Muted>{t('llmUsage.noModels')}</Muted>;
  const bars = models
    .slice()
    .sort((a, b) => b.tokens - a.tokens)
    .map((m, i) => ({ key: m.model, label: m.model, value: m.tokens, color: colorAt(i) }));
  return <BarChart data={bars} maxRows={6} formatValue={(v) => int(v)} ariaLabel={t('llmUsage.byModel')} />;
}

const SOURCE_LABEL: Record<DashboardUsage['byKind'][number]['kind'], string> = {
  cloud: 'Cloud',
  'on-prem': 'On-prem',
  web: 'Web / SDK',
};

function LlmBySourceCard(_props: WidgetCardProps) {
  const { data, state, t } = useLlmBySourceBody();
  if (!data) return state;
  const segments = data.byKind
    .filter((k) => k.estimatedCostUsd > 0)
    .map((k, i) => ({ key: k.kind, label: SOURCE_LABEL[k.kind], value: k.estimatedCostUsd, color: colorAt(i) }));
  if (segments.length === 0) return <Muted>{t('llmUsage.noSpend')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={usd(data.totals.estimatedCostUsd)}
      centerLabel={t('llmUsage.estCost')}
      formatValue={(v) => usd(v)}
      ariaLabel={t('llmUsage.bySource')}
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const DASHBOARD_DRILL: WidgetDrill = { kind: 'route', href: '/dashboard' };
const LLM_DRILL: WidgetDrill = { kind: 'route', href: '/workforce?tab=llm' };

/** by-source carries estimated SPEND — manager surface, gated like the finance lens. */
const FINANCE_CAP = 'insights.finance' as const;

export const CORE_WIDGETS: WidgetDef[] = [
  // ── Dashboard home (`/dashboard`) ──
  { id: 'core.projects', group: 'overview', titleKey: 'projects', size: 'sm', Card: ProjectsCard, drill: DASHBOARD_DRILL },
  { id: 'core.tasks', group: 'overview', titleKey: 'tasks', size: 'md', Card: TasksCard, drill: DASHBOARD_DRILL },
  { id: 'core.agents-online', group: 'overview', titleKey: 'agentsOnline', size: 'md', Card: AgentsOnlineCard, drill: DASHBOARD_DRILL },
  { id: 'core.pending-approvals', group: 'overview', titleKey: 'pendingApprovals', size: 'sm', Card: PendingApprovalsCard, drill: DASHBOARD_DRILL },

  // ── LLM Usage (`/workforce?tab=llm`) ──
  { id: 'core.llm-tokens', group: 'llmUsage', titleKey: 'llmTokens', size: 'md', Card: LlmTokensCard, drill: LLM_DRILL },
  { id: 'core.llm-requests', group: 'llmUsage', titleKey: 'llmRequests', size: 'sm', Card: LlmRequestsCard, drill: LLM_DRILL },
  { id: 'core.llm-by-model', group: 'llmUsage', titleKey: 'llmByModel', size: 'md', Card: LlmByModelCard, drill: LLM_DRILL },
  { id: 'core.llm-by-source', group: 'llmUsage', titleKey: 'llmBySource', capability: FINANCE_CAP, size: 'md', Card: LlmBySourceCard, drill: LLM_DRILL },
];
