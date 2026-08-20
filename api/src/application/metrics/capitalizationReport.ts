/**
 * The capitalization report as a DOWNLOADABLE artefact — one definition of its
 * tables, rendered to CSV or to a real .xlsx workbook.
 *
 * WHY IT LIVES IN ONE MODULE. The report is what a finance team hands an
 * auditor, and its two halves only mean something together: the monthly series
 * is the claim, and the epic table is the evidence for the most recent slice of
 * it. Exporting them separately would leave the recipient joining two files by
 * hand. Two formats of the same report defined in two places is the same problem
 * one step later — the moment a column is added to one, the workbook and the CSV
 * describe different reports and a reviewer cannot tell which is authoritative.
 * So {@link capitalizationTables} is the single shape, and each format is a
 * rendering of it.
 *
 * WHY BOTH FORMATS EXIST. CSV is the interchange format — it imports anywhere and
 * carries no types. XLSX is the one a finance reviewer actually works in: the two
 * tables land on their own sheets instead of being stacked behind a `section`
 * column, numbers arrive as numbers rather than as text that needs re-parsing,
 * and the header freezes and filters. A capitalization schedule is read, sorted
 * and totalled by hand; CSV made every one of those a re-import.
 *
 * `labor_usd` and `logged_hours` appear on every row on purpose. A capitalization
 * figure built from timesheets and salary bands and one built from cycle-time
 * estimates print identically; these are what let a reader tell them apart, which
 * is the whole reason this report is worth exporting rather than screenshotting.
 * `ai_cost_usd` stays a separate column from `labor_usd` — one is compute, the
 * other is people, and summing them is the auditor's call, not ours.
 */

import type { AllocationHistory, AllocationInsights } from '../insights/allocationInsights';
import { sheetsToXlsx, type XlsxCell, type XlsxSheet } from '../office/xlsxWriter';
import { toCsv } from './metricsCsv';

/** Round a nullable number to `dp` decimals, or null for null. Kept NUMERIC (not
 *  pre-formatted text) so the workbook writes real numbers and only the CSV
 *  stringifies — a cell of `"12.5"` is what forces a reviewer to re-parse a
 *  column before they can sum it. */
function round(value: number | null | undefined, dp = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10 ** dp) / 10 ** dp;
}

/** One table of the report: a title (the sheet name) and its grid. */
export interface ReportTable {
  title: string;
  columns: string[];
  rows: XlsxCell[][];
}

/**
 * The report's two tables. THE definition — every export format renders these.
 *
 * The monthly table carries `effort_hours` / `logged_hours` / `measured_effort_pct`
 * per row now that the history computes them. It could not before: the monthly
 * series was a pure cycle-time estimate while the on-screen donut above it used
 * real logged time, so the export could not state a measured share without
 * inventing one. Both halves now read the same effort rule, and the month a team
 * started logging time is visible as the month the percentage moves.
 */
export function capitalizationTables(history: AllocationHistory, current: AllocationInsights): ReportTable[] {
  const months: ReportTable = {
    title: 'Historical months',
    columns: [
      'month', 'status', 'capitalized_fte_months', 'total_fte_months',
      'capitalized_usd', 'not_capitalized_usd', 'uncategorized_usd', 'total_ai_cost_usd',
      'effort_hours', 'logged_hours', 'measured_effort_pct', 'task_count',
    ],
    rows: history.months.map((m) => [
      m.month, m.status,
      round(m.capitalizedFteMonths, 2), round(m.totalFteMonths, 2),
      round(m.capitalizedUsd, 2), round(m.notCapitalizedUsd, 2), round(m.uncategorizedUsd, 2), round(m.totalUsd, 2),
      round(m.hours, 1), round(m.loggedHours, 1), round(m.measuredEffortPct, 1), m.taskCount,
    ]),
  };

  const epics: ReportTable = {
    title: 'Work capitalization',
    columns: [
      'epic', 'status', 'fte_months', 'ai_cost_usd', 'labor_usd',
      'effort_hours', 'logged_hours', 'task_count', 'project',
    ],
    rows: current.epics.map((e) => [
      e.title, e.status,
      round(e.fteMonths, 2), round(e.costUsd, 2), round(e.laborUsd, 2),
      round(e.hours, 1), round(e.loggedHours, 1), e.taskCount, e.projectName ?? null,
    ]),
  };

  return [months, epics];
}

/**
 * The report → CSV: one flat grid, `section` naming which table a row came from.
 *
 * A CSV has one header, so the two tables are unioned and each row leaves the
 * other table's columns empty. That is the format's limitation and the reason the
 * workbook below exists — but the CSV stays because it is what imports into
 * everything, and a reader who only ever had this file must not lose it.
 */
export function capitalizationToCsv(history: AllocationHistory, current: AllocationInsights): string {
  const [months, epics] = capitalizationTables(history, current) as [ReportTable, ReportTable];

  // The union header, months' columns first. `key` is the row's identity in its
  // own table (the month, or the epic title) so a reader can join the two halves.
  const epicOnly = epics.columns.filter((c) => c !== 'epic' && c !== 'status' && !months.columns.includes(c));
  const header = ['section', 'key', ...months.columns.slice(1), ...epicOnly];

  const pad = (section: string, key: XlsxCell, own: string[], values: XlsxCell[]): XlsxCell[] => {
    const byColumn = new Map(own.map((c, i) => [c, values[i] ?? null]));
    return [section, key, ...header.slice(2).map((c) => byColumn.get(c) ?? '')];
  };

  const rows = [
    ...months.rows.map((r) => pad('month', r[0] ?? '', months.columns, r)),
    ...epics.rows.map((r) => pad('epic', r[0] ?? '', epics.columns, r)),
  ];
  return toCsv(header, rows);
}

/** The report → a two-sheet .xlsx workbook. */
export function capitalizationToXlsx(history: AllocationHistory, current: AllocationInsights): Uint8Array {
  const sheets: XlsxSheet[] = capitalizationTables(history, current).map((table) => ({
    title: table.title,
    columns: table.columns,
    rows: table.rows,
  }));
  return sheetsToXlsx(sheets);
}
