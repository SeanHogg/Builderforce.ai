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
import type { AllocationHistory, AllocationInsights } from '../insights/allocationInsights';

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

/**
 * The capitalization report → CSV: one row per month of history, then one row per
 * epic in the current window.
 *
 * WHY THE FILE CARRIES BOTH. The report is what a finance team hands to an
 * auditor, and the two halves only mean something together: the monthly series is
 * the claim, and the epic table is the evidence for the most recent slice of it.
 * Exporting them separately would leave the recipient joining two files by hand.
 *
 * `labor_usd` and `logged_hours` are on every row on purpose. A capitalization
 * figure built from timesheets and salary bands and one built from cycle-time
 * estimates print identically; these two columns are what let a reader tell them
 * apart, which is the whole reason this report is worth exporting rather than
 * screenshotting. `ai_cost_usd` stays a separate column from `labor_usd` — one is
 * compute, the other is people, and summing them is the auditor's call, not ours.
 */
export function capitalizationToCsv(history: AllocationHistory, current: AllocationInsights): string {
  const header = [
    'section', 'key', 'status', 'capitalized_fte_months', 'total_fte_months',
    'capitalized_usd', 'not_capitalized_usd', 'uncategorized_usd', 'total_ai_cost_usd',
    'labor_usd', 'effort_hours', 'logged_hours', 'task_count', 'project',
  ];

  const monthRows = history.months.map((m) => [
    'month', m.month, m.status,
    num(m.capitalizedFteMonths, 2), num(m.totalFteMonths, 2),
    num(m.capitalizedUsd, 2), num(m.notCapitalizedUsd, 2), num(m.uncategorizedUsd, 2), num(m.totalUsd, 2),
    // The monthly series carries cost, not the labour split — those live on the
    // epic rows below rather than being fabricated here at month grain.
    '', '', '', m.taskCount, '',
  ]);

  const epicRows = current.epics.map((e) => [
    'epic', e.title, e.status,
    num(e.fteMonths, 2), '',
    '', '', '', num(e.costUsd, 2),
    num(e.laborUsd, 2), num(e.hours, 1), num(e.loggedHours, 1), e.taskCount, e.projectName ?? '',
  ]);

  return toCsv(header, [...monthRows, ...epicRows]);
}
