/**
 * EMP-20 — Export helpers for the member metrics.
 *
 * A tiny, dependency-free CSV builder (RFC-4180-ish: every value quoted + escaped,
 * so embedded commas/quotes/newlines are safe and Excel opens the file directly)
 * plus the member-scorecard serializer. {@link toCsv} generalises the one-off CSV
 * builder in complianceInsights (evidencePackToCsv) so future exports reuse it
 * instead of re-implementing the escaping.
 */
import type { MemberScorecard } from './workforceMetrics';

/** Serialise a header + value matrix to a CSV string (values quoted + escaped). */
export function toCsv(header: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => r.map(esc).join(','));
  return [header.map(esc).join(','), ...lines].join('\n');
}

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
  return toCsv(header, rows);
}
