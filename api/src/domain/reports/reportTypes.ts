/**
 * The report vocabulary — the ONE list of what a schedule / subscription can send,
 * and how often.
 *
 * Lives in the domain so every layer reads the same values: the Postgres enums
 * (`reportTypeEnum` / `reportScheduleEnum` in `infrastructure/database/schema/kernel.ts`)
 * are built FROM these lists, and the schedule decision
 * (`application/reports/schedulePatch.ts`) admits exactly these, so a request can
 * never carry a type the column would refuse (which used to surface as a 500 from
 * the insert).
 */
export const REPORT_TYPES = [
  'standup',
  'code_review',
  'project_status',
  'executive_summary',
  'portfolio_rollup',
  /** A canvas frame, rendered and delivered on a cadence (mig 0461). The first
   *  report type that is ABOUT something — see `report_schedules.subject_ref`. */
  'board_pack',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_CADENCES = ['daily', 'weekly', 'monthly'] as const;

export type ReportCadence = (typeof REPORT_CADENCES)[number];

const KNOWN_TYPES = new Set<string>(REPORT_TYPES);
const KNOWN_CADENCES = new Set<string>(REPORT_CADENCES);

export function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && KNOWN_TYPES.has(value);
}

export function isReportCadence(value: unknown): value is ReportCadence {
  return typeof value === 'string' && KNOWN_CADENCES.has(value);
}
