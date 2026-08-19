/**
 * THE effort rule: how many hours of work a task represents.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * There were TWO functions named `taskEffortHours`, in `metrics/laborCost.ts` and
 * `insights/allocationInsights.ts`, and they disagreed about the thing that
 * matters most:
 *
 *   · laborCost's preferred REAL LOGGED TIME (`time_entries`, migration 0245) and
 *     fell back to a cycle-time estimate only when nothing was logged.
 *   · allocationInsights' was cycle time and nothing else. It never looked at
 *     `time_entries` at all.
 *
 * Everything downstream of the second one therefore ignored the timesheets the
 * tenant had actually filled in: the investment-allocation mix, the
 * capitalization report's FTE-months, and the R&D tax-credit QRE base — the three
 * numbers most likely to end up in front of an accountant. A team could log every
 * hour against its research tickets and the R&D report would still be built from
 * "when was the ticket created, when was it closed".
 *
 * One rule, one place. The two callers differ in ways that are REAL, so those are
 * parameters rather than forks:
 *
 *   · `capHours` — labour attribution caps a single task at one work-day (a task
 *     open for a week was not worked for a week); the allocation mix caps at 30
 *     days, because there its job is to stop one stale ticket dominating a
 *     percentage split, not to price it.
 *   · `includeInFlight` — the allocation MIX counts work in progress (it is a
 *     picture of where effort is going right now); labour attribution prices only
 *     what finished.
 *
 * A logged-time answer ignores both: minutes someone recorded are not an estimate
 * to be clamped, and work in progress with time against it is worked time.
 */

const HOUR_MS = 3_600_000;

export interface EffortInput {
  /** Real minutes recorded against the task in the window (0 when none). */
  loggedMinutes: number;
  createdAt: Date;
  completedAt: Date | null;
  /** Last touch — the end anchor for in-flight work. */
  updatedAt?: Date | null;
}

export interface EffortOptions {
  /** Upper bound on the ESTIMATE. Logged time is never clamped. */
  capHours: number;
  /** Count a task that has not completed, using `updatedAt`/now as the end anchor. */
  includeInFlight: boolean;
  /** Clock, injected so every branch is testable without a real one. */
  now: number;
}

/** Where a task's effort number came from — reported so an estimate is never
 *  presented as a timesheet. */
export type EffortBasis = 'logged' | 'estimated' | 'none';

export function taskEffort(input: EffortInput, opts: EffortOptions): { hours: number; basis: EffortBasis } {
  // REAL time wins, always and unclamped. This is the whole point of the rule:
  // the moment a person records what they actually spent, no estimate may
  // override, cap or dilute it.
  if (input.loggedMinutes > 0) return { hours: input.loggedMinutes / 60, basis: 'logged' };

  const end = input.completedAt
    ? input.completedAt.getTime()
    : opts.includeInFlight
      ? Math.min(opts.now, (input.updatedAt ?? input.createdAt).getTime())
      : null;
  if (end == null) return { hours: 0, basis: 'none' };

  const hrs = (end - input.createdAt.getTime()) / HOUR_MS;
  const clamped = Math.max(0, Math.min(opts.capHours, hrs));
  return { hours: clamped, basis: clamped > 0 ? 'estimated' : 'none' };
}

/** Convenience for callers that only want the number. */
export function taskEffortHours(input: EffortInput, opts: EffortOptions): number {
  return taskEffort(input, opts).hours;
}
