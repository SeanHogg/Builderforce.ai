import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { RoiRollup } from '@/lib/builderforceApi';

/**
 * Collection descriptors for the PM → ROI tables (By project · Top spend by task ·
 * Tracked features). All READ-ONLY (`entity: null`): they are derived rollup rows
 * with no bulk API. Headers are passed in already translated, per the descriptor
 * contract; `money` is the caller's `useFormat().money`.
 */

export type RoiProjectRow = RoiRollup['byProject'][number];
export type RoiTaskRow = RoiRollup['byTask'][number];
export type RoiFeatureRow = RoiRollup['roi'][number];

const card = (lines: Array<[string, string]>) => (
  <div style={{ padding: '36px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
    {lines.map(([k, v], i) => (
      <div key={k} style={i === 0 ? { color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' } : { color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
        {i === 0 ? v : `${k}: ${v}`}
      </div>
    ))}
  </div>
);

export function roiProjectsDescriptor(
  h: { project: string; completed: string; spend: string },
  money: (n: number) => string,
): CollectionDescriptor<RoiProjectRow> {
  return {
    entity: null,
    surfaceKey: 'pm.roi.byProject',
    rowId: (r) => String(r.projectId),
    label: (r) => r.projectName,
    defaultSort: { key: 'spend', dir: 'desc' },
    emptyKey: 'emptyRoi',
    card: (r) => card([[h.project, r.projectName], [h.completed, String(r.completedCount)], [h.spend, money(r.agentLlmCostUsd)]]),
    columns: [
      { key: 'project', header: h.project, sortKey: 'project', compare: (a, b) => a.projectName.localeCompare(b.projectName), cell: (r) => r.projectName },
      { key: 'completed', header: h.completed, sortKey: 'completed', compare: (a, b) => a.completedCount - b.completedCount, cell: (r) => r.completedCount },
      { key: 'spend', header: h.spend, sortKey: 'spend', compare: (a, b) => a.agentLlmCostUsd - b.agentLlmCostUsd, cell: (r) => money(r.agentLlmCostUsd) },
    ],
  };
}

export function roiTasksDescriptor(
  h: { task: string; spend: string },
  money: (n: number) => string,
): CollectionDescriptor<RoiTaskRow> {
  const title = (r: RoiTaskRow) => `${r.taskKey ? `${r.taskKey} · ` : ''}${r.title}`;
  return {
    entity: null,
    surfaceKey: 'pm.roi.byTask',
    rowId: (r) => String(r.taskId),
    label: title,
    defaultSort: { key: 'spend', dir: 'desc' },
    emptyKey: 'emptyRoi',
    card: (r) => card([[h.task, title(r)], [h.spend, money(r.agentLlmCostUsd)]]),
    columns: [
      { key: 'task', header: h.task, sortKey: 'task', compare: (a, b) => title(a).localeCompare(title(b)), cell: title },
      { key: 'spend', header: h.spend, sortKey: 'spend', compare: (a, b) => a.agentLlmCostUsd - b.agentLlmCostUsd, cell: (r) => money(r.agentLlmCostUsd) },
    ],
  };
}

export function roiFeaturesDescriptor(
  h: { feature: string; type: string; status: string },
): CollectionDescriptor<RoiFeatureRow> {
  const name = (r: RoiFeatureRow) => String(r.featureName ?? '');
  const type = (r: RoiFeatureRow) => String(r.featureType ?? '—');
  const status = (r: RoiFeatureRow) => String(r.status ?? '—');
  return {
    entity: null,
    surfaceKey: 'pm.roi.features',
    rowId: (r) => String(r.id),
    label: name,
    defaultSort: { key: 'feature', dir: 'asc' },
    emptyKey: 'emptyRoi',
    card: (r) => card([[h.feature, name(r)], [h.type, type(r)], [h.status, status(r)]]),
    columns: [
      { key: 'feature', header: h.feature, sortKey: 'feature', compare: (a, b) => name(a).localeCompare(name(b)), cell: name },
      { key: 'type', header: h.type, sortKey: 'type', compare: (a, b) => type(a).localeCompare(type(b)), cell: type },
      { key: 'status', header: h.status, sortKey: 'status', compare: (a, b) => status(a).localeCompare(status(b)), cell: status },
    ],
  };
}
