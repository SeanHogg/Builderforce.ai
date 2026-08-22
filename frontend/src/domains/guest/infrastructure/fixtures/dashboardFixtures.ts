/**
 * Wire adapters for the DASHBOARD reads — the metric catalogue and the saved
 * layouts `/insights` opens on.
 *
 * The catalogue matters more than it looks: it is the list a visitor picks from
 * when they build their first dashboard, so an empty one makes the product's
 * headline surface read as unfinished. Every entry here is a metric the sample
 * workspace can actually answer, which is the rule that stops this file becoming
 * an aspirational menu.
 */

import { sampleDailySeries, SAMPLE_PROJECTS, sampleTasks, isSampleTaskCompleted } from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture } from '../../domain/guestFixture';

/** `key` matches the server catalogue's naming so a widget pinned as a guest
 *  resolves to the same metric once the workspace is real. */
const METRICS = [
  { key: 'delivery.throughput', label: 'Throughput', unit: 'tasks/week', description: 'Tasks moved to done each week.', goodWhenUp: true },
  { key: 'delivery.cycleTime', label: 'Cycle time', unit: 'hours', description: 'Ready to done, median.', goodWhenUp: false },
  { key: 'delivery.wip', label: 'Work in progress', unit: 'tasks', description: 'Tasks started and not finished.', goodWhenUp: false },
  { key: 'delivery.blocked', label: 'Blocked', unit: 'tasks', description: 'Tasks waiting on something outside the team.', goodWhenUp: false },
  { key: 'ai.runs', label: 'Agent runs', unit: 'runs', description: 'Model calls made by the workforce.', goodWhenUp: null },
  { key: 'ai.mergedRate', label: 'Merge rate', unit: '%', description: 'Agent pull requests merged without rework.', goodWhenUp: true },
  { key: 'finance.spend', label: 'Model spend', unit: 'USD', description: 'Platform model spend over the window.', goodWhenUp: false },
  { key: 'finance.costPerTask', label: 'Cost per task', unit: 'USD', description: 'Model spend divided by tasks completed.', goodWhenUp: false },
];

/** The one saved layout a guest opens on — the Executive preset, materialised so
 *  the visitor meets a built dashboard rather than an empty-state invitation to
 *  build one. */
function executiveDashboard(now: number) {
  return {
    id: 1,
    name: 'Executive',
    isDefault: true,
    createdBy: null,
    createdAt: dayOffsetToIso(now, -21),
    updatedAt: dayOffsetToIso(now, -1),
    widgets: METRICS.slice(0, 6).map((metric, index) => ({
      id: index + 1,
      dashboardId: 1,
      metricKey: metric.key,
      widgetId: null,
      viz: index < 4 ? 'stat' : 'line',
      title: metric.label,
      position: index,
    })),
  };
}

/** Current value + trailing series for one metric key, from the same rows the
 *  boards and the lenses read. */
function metricValue(key: string, now: number) {
  const rows = sampleDailySeries(30);
  const tasks = sampleTasks();
  const open = tasks.filter((t) => !isSampleTaskCompleted(t.status));
  const totalRuns = rows.reduce((total, row) => total + row.runs, 0);
  const totalMerged = rows.reduce((total, row) => total + row.merged, 0);
  const totalSpend = rows.reduce((total, row) => total + row.spendCents, 0) / 100;
  const completed = tasks.filter((t) => isSampleTaskCompleted(t.status)).length;

  const value =
    key === 'delivery.throughput' ? Math.round((completed / 30) * 7 * 10) / 10
    : key === 'delivery.cycleTime' ? 46.2
    : key === 'delivery.wip' ? open.filter((t) => t.status === 'in_progress' || t.status === 'in_review').length
    : key === 'delivery.blocked' ? open.filter((t) => t.status === 'blocked').length
    : key === 'ai.runs' ? totalRuns
    : key === 'ai.mergedRate' ? (totalRuns === 0 ? 0 : Math.round((totalMerged / totalRuns) * 100))
    : key === 'finance.spend' ? Math.round(totalSpend * 100) / 100
    : key === 'finance.costPerTask' ? (completed === 0 ? 0 : Math.round((totalSpend / completed) * 100) / 100)
    : 0;

  return {
    metricKey: key,
    value,
    series: rows.map((row) => ({
      at: dayOffsetToIso(now, row.dayOffset),
      value:
        key === 'ai.runs' ? row.runs
        : key === 'finance.spend' ? Math.round(row.spendCents) / 100
        : key === 'delivery.throughput' ? row.completed
        : row.merged,
    })),
  };
}

export const dashboardFixtures: GuestFixture[] = [
  {
    id: 'dashboards.metrics',
    match: exact('/api/dashboards/metrics'),
    respond: () => ({ metrics: METRICS }),
  },
  {
    id: 'dashboards.list',
    match: exact('/api/dashboards/dashboards'),
    respond: ({ now }) => ({ dashboards: [executiveDashboard(now)] }),
  },
  {
    id: 'dashboards.data',
    match: exact('/api/dashboards/dashboards/1/data'),
    respond: ({ now }) => ({
      dashboard: executiveDashboard(now),
      values: executiveDashboard(now).widgets.map((widget) => ({
        widgetId: widget.id,
        ...metricValue(widget.metricKey, now),
      })),
    }),
  },
  {
    id: 'dashboards.projectsSummary',
    match: exact('/api/dashboards/summary'),
    respond: ({ now }) => ({
      projects: SAMPLE_PROJECTS.length,
      tasks: sampleTasks().length,
      completed: sampleTasks().filter((t) => isSampleTaskCompleted(t.status)).length,
      updatedAt: dayOffsetToIso(now, 0),
    }),
  },
];
