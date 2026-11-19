import { roiApi, type RoiRollup } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { useMemo } from 'react';
import { LocalCollection } from './LocalCollection';
import { roiProjectsDescriptor, roiTasksDescriptor, roiFeaturesDescriptor } from './roiDescriptors';
import { PmCard, PmEmpty, PmError, StatCard } from './pmShared';
import { useFormat } from "@/i18n/useFormat";

/**
 * ROI dashboard — "$ spent → time & cost". Composes the live rollup
 * (/api/roi/rollup): time metrics from the task lifecycle, spend from sprint
 * budgets + per-project LLM cost + the cost model. In portfolio scope it adds a
 * per-project breakdown.
 */

export function RoiDashboard() {
  const fmt = useFormat();
  const { projectId, isPortfolio } = usePmScope();
  const { data, error } = usePmData<RoiRollup>(
    () => roiApi.rollup(projectId ?? undefined),
    [projectId],
  );

  const projectsDesc = useMemo(() => roiProjectsDescriptor({ project: 'Project', completed: 'Completed', spend: 'Agent LLM spend' }, fmt.money), [fmt]);
  const tasksDesc = useMemo(() => roiTasksDescriptor({ task: 'Task', spend: 'Agent LLM spend' }, fmt.money), [fmt]);
  const featuresDesc = useMemo(() => roiFeaturesDescriptor({ feature: 'Feature', type: 'Type', status: 'Status' }), []);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message="Loading ROI…" />;

  const totalSpend = data.spend.sprintActualBurn + data.spend.agentLlmCostUsd;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <StatCard label="Completed" value={String(data.time.completedCount)} sub="tasks done" />
        <StatCard label="Avg cycle time" value={`${data.time.avgCycleTimeHours.toFixed(1)}h`} sub="start → done" />
        <StatCard label="Throughput" value={`${data.time.throughputPerWeek}/wk`} sub="completed last 7 days" />
        <StatCard label="Agent LLM spend" value={fmt.money(data.spend.agentLlmCostUsd)} sub="attributed to scope" />
        <StatCard label="Sprint burn" value={fmt.money(data.spend.sprintActualBurn)} sub={`of ${fmt.money(data.spend.sprintRunwayBudget)} budget`} />
        <StatCard label="Cost model" value={fmt.money(data.spend.costModelTotal)} sub="segment total" />
      </div>

      <PmCard title="Spend summary">
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Total tracked spend in scope: <strong style={{ color: 'var(--text-primary)' }}>{fmt.money(totalSpend)}</strong>{' '}
          ({fmt.money(data.spend.agentLlmCostUsd)} agent LLM + {fmt.money(data.spend.sprintActualBurn)} sprint burn).
        </div>
      </PmCard>

      {isPortfolio && data.byProject.length > 0 && (
        <PmCard title="By project">
          <LocalCollection descriptor={projectsDesc} rows={data.byProject} searchText={(p) => p.projectName} />
        </PmCard>
      )}

      {data.byTask.length > 0 && (
        <PmCard title="Top spend by task">
          <LocalCollection descriptor={tasksDesc} rows={data.byTask} searchText={(r) => (r.taskKey ?? '') + ' ' + r.title} />
        </PmCard>
      )}

      {data.roi.length > 0 && (
        <PmCard title="Tracked features">
          <LocalCollection descriptor={featuresDesc} rows={data.roi} searchText={(r) => String(r.featureName ?? '')} />
        </PmCard>
      )}
    </div>
  );
}
