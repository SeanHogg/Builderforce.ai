/**
 * EMP-20 — the member-scorecard export source.
 *
 * This module chooses the COLUMNS. Serialising (CSV/JSON) and answering the
 * download are `export/exportSource`'s — this file used to be `metricsCsv`, with
 * its own call into the CSV writer and its route building its own headers.
 *
 * The export honours the SAME project scope as the page it was clicked from, or a
 * manager downloads a workspace file believing it is the project they were
 * looking at; the filename says which, for the same reason.
 */
import { TenantRole } from '../../domain/shared/types';
import { daysParam, positiveIntParam } from '../../domain/shared/boundedInt';
import type { ExportTable, TenantExportSource } from '../export/exportSource';
import { exportStamp } from '../export/exportSource';
import { computeMemberMetrics, type MemberScorecard } from './workforceMetrics';

/** Round a nullable number to `dp` decimals, or '' for null (keeps cells numeric). */
const num = (v: number | null | undefined, dp = 1): string =>
  v == null ? '' : (Math.round(v * 10 ** dp) / 10 ** dp).toString();

/** Member effectiveness/engagement scorecards → one row per member. */
export function memberMetricsTable(members: MemberScorecard[]): ExportTable {
  return {
    columns: [
      'member', 'kind', 'discipline', 'assigned', 'completed', 'redo', 'reopen',
      'avg_cycle_h', 'avg_pickup_h', 'avg_idle_after_done_h', 'board_hygiene', 'engagement', 'effectiveness',
    ],
    rows: members.map((m) => [
      m.memberName, m.memberKind, m.discipline ?? '', m.assignedCount, m.completedCount, m.redoCount, m.reopenCount,
      num(m.avgCycleTimeHours), num(m.avgPickupLatencyHours), num(m.avgIdleAfterDoneHours),
      num(m.boardHygieneScore, 0), num(m.engagementScore, 0), num(m.effectivenessScore, 0),
    ]),
  };
}

/** `GET /api/members/metrics/export` · `GET /api/exports/sources/members.metrics`. */
export const memberMetricsExportSource: TenantExportSource = {
  id: 'members.metrics',
  label: 'Member metrics',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  formats: ['csv', 'json', 'xlsx'],
  async load(ctx) {
    const days = daysParam(ctx.param('days'), 30, 180);
    const projectId = positiveIntParam(ctx.param('projectId'));
    const members = await computeMemberMetrics(ctx.db, ctx.tenantId, days, projectId);
    const scopeTag = projectId == null ? '' : `-project-${projectId}`;
    return {
      filename: `member-metrics-${days}d${scopeTag}-${exportStamp(ctx.now)}`,
      title: 'Member metrics',
      table: memberMetricsTable(members),
      json: { generatedAt: new Date(ctx.now).toISOString(), windowDays: days, projectId: projectId ?? null, members },
    };
  },
};
