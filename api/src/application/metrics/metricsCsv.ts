/**
 * EMP-20 — Export helpers for the member metrics.
 *
 * The member-scorecard serialiser. It chooses the COLUMNS; the escaping is
 * `csvMatrix` in `application/export/tabularExport`, which is the api's one CSV
 * writer — this module used to carry its own copy of it, and so did two report
 * modules besides.
 *
 * The capitalization report's export lives in `capitalizationReport.ts` instead
 * of here: it renders to a workbook as well as to CSV, and a module named
 * `metricsCsv` owning the XLSX half of a report would be a lie about where to
 * look. It calls the same primitive.
 */
import type { MemberScorecard } from './workforceMetrics';
import { csvMatrix } from '../export/tabularExport';

/** Round a nullable number to `dp` decimals, or '' for null (keeps cells numeric). */
const num = (v: number | null | undefined, dp = 1): string =>
  v == null ? '' : (Math.round(v * 10 ** dp) / 10 ** dp).toString();

/** Member effectiveness/engagement scorecards → CSV (one row per member). */
export function memberMetricsToCsv(members: MemberScorecard[]): string {
  const header = [
    'member', 'kind', 'discipline', 'assigned', 'completed', 'redo', 'reopen',
    'avg_cycle_h', 'avg_pickup_h', 'avg_idle_after_done_h', 'board_hygiene', 'engagement', 'effectiveness',
  ];
  const rows = members.map((m) => [
    m.memberName, m.memberKind, m.discipline ?? '', m.assignedCount, m.completedCount, m.redoCount, m.reopenCount,
    num(m.avgCycleTimeHours), num(m.avgPickupLatencyHours), num(m.avgIdleAfterDoneHours),
    num(m.boardHygieneScore, 0), num(m.engagementScore, 0), num(m.effectivenessScore, 0),
  ]);
  return csvMatrix(header, rows);
}
