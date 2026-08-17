'use client';

/**
 * WorkflowRunHistoryPanel — the execution history + insights surface for ONE
 * workflow definition: a usage summary (runs/cost over the last N days, the
 * Make.com-parity "credits / data transfer" sidebar this was built to match),
 * the run list, and a per-run detail drill-down (tasks + dependency graph).
 *
 * Self-contained so it can mount in two places: `WorkflowsContent.tsx`'s
 * "view runs" flow (a full-page context) and `WorkflowBuilder.tsx`'s toolbar
 * "History" button (a `SlideOutPanel` docked beside the live canvas, so a
 * builder can see a definition's run history without leaving the editor).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  workflows,
  workflowDefinitions,
  type Workflow,
  type WorkflowTask,
  type WorkflowGraph,
  type WorkflowUsageSummary,
} from '@/lib/builderforceApi';
import { WorkflowDagView } from './WorkflowDagView';
import { TrendChart } from './charts/TrendChart';
import { StatusPill, STATUS_COLORS, cardStyle, subtleBtn } from './WorkflowsContent';

interface Props {
  definitionId: string;
  definitionName: string;
  /** Jump straight into this run's detail on mount (e.g. right after starting
   *  a run) instead of showing the list first. */
  initialRunId?: string | null;
}

function WorkflowTaskRow({ task }: { task: WorkflowTask }) {
  const color = STATUS_COLORS[task.status] ?? 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {task.agentRole}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>{task.description}</span>
        </div>
        {task.output && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.output}
          </div>
        )}
        {task.error && <div style={{ fontSize: 11, color: 'var(--coral-bright)', marginTop: 4 }}>{task.error}</div>}
      </div>
      <StatusPill status={task.status} />
    </div>
  );
}

/** Usage summary — total runs + cost over the window, plus a daily run-count
 *  trend (Make's "0 credits / 0 B data transfer" + 7-day sparkline). */
function UsageSummary({ usage, loading }: { usage: WorkflowUsageSummary | null; loading: boolean }) {
  const t = useTranslations('workflowsContent');
  if (loading) return <div style={{ ...cardStyle, fontSize: 12, color: 'var(--text-muted)' }}>{t('loadingUsage')}</div>;
  if (!usage) return null;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{usage.totalRuns}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('usageRunsLast7', { days: usage.days.length })}</div>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>${usage.totalCostUsd.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('usageCostLast7', { days: usage.days.length })}</div>
        </div>
      </div>
      {usage.totalRuns > 0 && (
        <TrendChart
          ariaLabel={t('usageChartLabel')}
          height={140}
          labels={usage.days.map((d) => d.date.slice(5))}
          series={[{ key: 'runs', label: t('usageRunsSeries'), values: usage.days.map((d) => d.runCount), color: 'var(--coral-bright)' }]}
        />
      )}
    </div>
  );
}

export function WorkflowRunHistoryPanel({ definitionId, definitionName, initialRunId = null }: Props) {
  const t = useTranslations('workflowsContent');

  const [usage, setUsage] = useState<WorkflowUsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);

  const [runs, setRuns] = useState<Workflow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const [selectedDetail, setSelectedDetail] = useState<Workflow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'tasks' | 'graph'>('tasks');
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  useEffect(() => {
    setLoadingUsage(true);
    workflowDefinitions.usage(definitionId, 7).then(setUsage).catch(() => setUsage(null)).finally(() => setLoadingUsage(false));
  }, [definitionId]);

  useEffect(() => {
    setLoadingRuns(true);
    workflowDefinitions.runs(definitionId).then(setRuns).catch(() => setRuns([])).finally(() => setLoadingRuns(false));
  }, [definitionId]);

  const openDetail = useCallback(async (wf: Workflow) => {
    setSelectedDetail(wf);
    setDetailTab('tasks');
    setGraph(null);
    if (wf.tasks) return;
    setLoadingDetail(true);
    try {
      setSelectedDetail(await workflows.get(wf.id));
    } catch {
      setSelectedDetail(wf);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Jump straight to the just-started run's detail (e.g. right after firing a
  // run from the builder toolbar) — fetches the full record first so the
  // detail view never renders a bare id with undefined status/description.
  useEffect(() => {
    if (!initialRunId) return;
    setLoadingDetail(true);
    workflows.get(initialRunId)
      .then((wf) => { setSelectedDetail(wf); setDetailTab('tasks'); setGraph(null); })
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
    // Fires once per mount for a given initialRunId — re-running on every
    // `openDetail` identity change (a stable useCallback) would be a no-op
    // anyway, but omitting it keeps this effect's intent to "the one initial id".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRunId]);

  const loadGraph = useCallback(async (workflowId: string) => {
    setLoadingGraph(true);
    try {
      setGraph(await workflows.getGraph(workflowId));
    } catch {
      setGraph(null);
    } finally {
      setLoadingGraph(false);
    }
  }, []);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-subtle)',
    background: active ? 'var(--surface-interactive)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer',
  });

  if (selectedDetail) {
    const tasks = selectedDetail.tasks ?? [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setSelectedDetail(null)} style={subtleBtn}>← {t('back')}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {selectedDetail.description ?? t('runLabel', { id: selectedDetail.id.slice(0, 8) })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {selectedDetail.workflowType} · {selectedDetail.status}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" style={tabBtnStyle(detailTab === 'tasks')} onClick={() => setDetailTab('tasks')}>{t('tasks')}</button>
            <button
              type="button"
              style={tabBtnStyle(detailTab === 'graph')}
              onClick={() => { setDetailTab('graph'); if (!graph && !loadingGraph) void loadGraph(selectedDetail.id); }}
            >
              {t('graph')}
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          {detailTab === 'tasks' ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{t('tasksCount', { count: tasks.length })}</div>
              {loadingDetail ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loadingTasks')}</div>
              ) : tasks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noTasksYet')}</div>
              ) : (
                tasks.map((task) => <WorkflowTaskRow key={task.id} task={task} />)
              )}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{t('dependencyGraph')}</div>
              {loadingGraph ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loadingGraph')}</div>
              ) : graph ? (
                <WorkflowDagView nodes={graph.nodes} edges={graph.edges} />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noGraphData')}</div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{definitionName} · {t('runs')}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{t('executionHistory')}</div>
      </div>

      <UsageSummary usage={usage} loading={loadingUsage} />

      {loadingRuns ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loadingRuns')}</div>
      ) : runs.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 12, color: 'var(--text-muted)' }}>{t('noRunsPeriod')}</div>
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void openDetail(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer' }}
            >
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.description ?? t('runLabel', { id: r.id.slice(0, 8) })}
              </span>
              <StatusPill status={r.status} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
