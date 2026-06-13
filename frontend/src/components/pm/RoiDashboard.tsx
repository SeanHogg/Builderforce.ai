'use client';

import { roiApi, type RoiRollup } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { PmCard, PmEmpty, PmError, StatCard } from './pmShared';

/**
 * ROI dashboard — "$ spent → time & cost". Composes the live rollup
 * (/api/roi/rollup): time metrics from the task lifecycle, spend from sprint
 * budgets + per-project LLM cost + the cost model. In portfolio scope it adds a
 * per-project breakdown.
 */
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function RoiDashboard() {
  const { projectId, isPortfolio } = usePmScope();
  const { data, error } = usePmData<RoiRollup>(
    () => roiApi.rollup(projectId ?? undefined),
    [projectId],
  );

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message="Loading ROI…" />;

  const totalSpend = data.spend.sprintActualBurn + data.spend.agentLlmCostUsd;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <StatCard label="Completed" value={String(data.time.completedCount)} sub="tasks done" />
        <StatCard label="Avg cycle time" value={`${data.time.avgCycleTimeHours.toFixed(1)}h`} sub="start → done" />
        <StatCard label="Throughput" value={`${data.time.throughputPerWeek}/wk`} sub="completed last 7 days" />
        <StatCard label="Agent LLM spend" value={usd(data.spend.agentLlmCostUsd)} sub="attributed to scope" />
        <StatCard label="Sprint burn" value={usd(data.spend.sprintActualBurn)} sub={`of ${usd(data.spend.sprintRunwayBudget)} budget`} />
        <StatCard label="Cost model" value={usd(data.spend.costModelTotal)} sub="segment total" />
      </div>

      <PmCard title="Spend summary">
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Total tracked spend in scope: <strong style={{ color: 'var(--text-primary)' }}>{usd(totalSpend)}</strong>{' '}
          ({usd(data.spend.agentLlmCostUsd)} agent LLM + {usd(data.spend.sprintActualBurn)} sprint burn).
        </div>
      </PmCard>

      {isPortfolio && data.byProject.length > 0 && (
        <PmCard title="By project">
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Completed</th>
                  <th style={thStyle}>Agent LLM spend</th>
                </tr>
              </thead>
              <tbody>
                {data.byProject.map((p) => (
                  <tr key={p.projectId} style={trStyle}>
                    <td style={tdStyle}>{p.projectName}</td>
                    <td style={tdMutedStyle}>{p.completedCount}</td>
                    <td style={tdMutedStyle}>{usd(p.agentLlmCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PmCard>
      )}

      {data.roi.length > 0 && (
        <PmCard title="Tracked features">
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Feature</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.roi.map((r) => (
                  <tr key={String(r.id)} style={trStyle}>
                    <td style={tdStyle}>{String(r.featureName ?? '')}</td>
                    <td style={tdMutedStyle}>{String(r.featureType ?? '—')}</td>
                    <td style={tdMutedStyle}>{String(r.status ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PmCard>
      )}
    </div>
  );
}
