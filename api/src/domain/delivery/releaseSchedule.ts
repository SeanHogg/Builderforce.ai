/**
 * Release schedule — a product release's dates as PLAN vs ACTUAL (migration 1266).
 *
 *   target_date  the planned ship date (what the release plan commits to)
 *   released_at  when it actually shipped; set by the transition to `released`,
 *                cleared when a release moves back to planned / in_progress, and
 *                KEPT when a shipped release is cancelled (rolled back — it did ship)
 *
 * The old single `release_date` column meant either, depending on who wrote it, so
 * no rollup could tell a plan from an outcome. These pure rules are the one place
 * that decides how a write moves `released_at` and how a set of releases grades
 * against its plan; `ProductReleaseService` maps the plan onto SQL and the delivery
 * lens / `/api/releases` read the rollup.
 */
import { DAY_MS } from '../shared/time';

export const RELEASE_STATUSES = ['planned', 'in_progress', 'released', 'cancelled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASED_STATUS: ReleaseStatus = 'released';
export const CANCELLED_STATUS: ReleaseStatus = 'cancelled';

export function isReleaseStatus(value: unknown): value is ReleaseStatus {
  return RELEASE_STATUSES.includes(value as ReleaseStatus);
}

// ── released_at on a write ──────────────────────────────────────────────────────

/**
 * How one write moves `released_at`.
 *
 *   keep     nothing about the release's shipped state changes — including a move to
 *            `cancelled`, which keeps the ship date of a rolled-back release (and a
 *            never-shipped one simply has none)
 *   clear    the write moves the release back into plan (planned / in_progress)
 *   stamp    the write (re)affirms `released`: an existing actual date wins, else `at`
 *   set      the write marks it released WITH an explicit actual date (back-dating)
 *   correct  an explicit actual date with no status in the write: it applies only
 *            when the row is already released, so it can never contradict status
 */
export type ReleasedAtPlan =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'stamp'; at: Date }
  | { kind: 'set'; at: Date }
  | { kind: 'correct'; at: Date };

export interface ReleasedAtWrite {
  /** The status the write carries, already validated; undefined = status untouched. */
  status?: ReleaseStatus;
  /** The caller's explicit actual date, already parsed; null/undefined = none given. */
  releasedAt?: Date | null;
}

export function planReleasedAt(write: ReleasedAtWrite, now: Date): ReleasedAtPlan {
  const explicit = write.releasedAt ?? null;
  if (write.status === RELEASED_STATUS) return explicit ? { kind: 'set', at: explicit } : { kind: 'stamp', at: now };
  if (write.status === CANCELLED_STATUS) return { kind: 'keep' };
  if (write.status !== undefined) return { kind: 'clear' };
  return explicit ? { kind: 'correct', at: explicit } : { kind: 'keep' };
}

/**
 * The value `released_at` ends up with once `plan` is applied to `current` (null =
 * a row being created). `ProductReleaseService.update` expresses the same rules in
 * SQL so a concurrent status change cannot slip between a read and the write.
 */
export function applyReleasedAtPlan(
  plan: ReleasedAtPlan,
  current: { status: string; releasedAt: Date | null } | null,
): Date | null {
  switch (plan.kind) {
    case 'keep': return current?.releasedAt ?? null;
    case 'clear': return null;
    case 'stamp': return current?.releasedAt ?? plan.at;
    case 'set': return plan.at;
    case 'correct': return current?.status === RELEASED_STATUS ? plan.at : (current?.releasedAt ?? null);
  }
}

// ── Deprecated input alias ──────────────────────────────────────────────────────

/**
 * `releaseDate` was the release-planning tracker's single "Date" field. It is still
 * accepted on input for one release (deployed embeds and the legacy
 * `/api/product/release-planning` callers send it) and folded onto the new pair:
 * on a write that marks the release released it was the ship date, so it becomes
 * `releasedAt`; otherwise it was the plan, so it becomes `targetDate`. An explicit
 * `targetDate` / `releasedAt` in the same write always wins over the alias.
 *
 * @deprecated remove with the alias once the embeds have moved to `targetDate`.
 */
export interface DeprecatedReleaseDateInput {
  status?: string;
  targetDate?: string | null;
  releasedAt?: string | null;
  releaseDate?: string | null;
}

export function foldDeprecatedReleaseDate<T extends DeprecatedReleaseDateInput>(input: T): Omit<T, 'releaseDate'> {
  if (!('releaseDate' in input)) return input;
  const { releaseDate, ...rest }: DeprecatedReleaseDateInput = input;
  let folded: DeprecatedReleaseDateInput = rest;
  if (rest.status === RELEASED_STATUS) {
    if (!('releasedAt' in rest)) folded = { ...rest, releasedAt: releaseDate };
  } else if (!('targetDate' in rest)) {
    folded = { ...rest, targetDate: releaseDate };
  }
  // `folded` is `input` minus `releaseDate`, plus at most one of T's own date keys.
  return folded as Omit<T, 'releaseDate'>;
}

// ── Plan vs actual rollup ───────────────────────────────────────────────────────

/** The fields a schedule grade reads; dates may arrive as Date or ISO string. */
export interface ReleaseDates {
  status: string;
  targetDate: Date | string | null;
  releasedAt: Date | string | null;
}

function utcDay(value: Date | string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

/**
 * Calendar days the actual date landed after the planned one (UTC days; negative =
 * early, 0 = on the day). A target is a calendar date, so shipping at 18:00 on the
 * target day is on time, not "0.75 days late". Null when either date is missing.
 */
export function calendarDaySlip(actual: Date | string | null, target: Date | string | null): number | null {
  if (actual == null || target == null) return null;
  const a = utcDay(actual), t = utcDay(target);
  return a == null || t == null ? null : a - t;
}

/** On time = shipped on or before the target date. Null when it cannot be graded
 *  (not released, or no plan to grade against). */
export function isReleasedOnTime(r: ReleaseDates): boolean | null {
  if (r.status !== RELEASED_STATUS) return null;
  const slip = calendarDaySlip(r.releasedAt, r.targetDate);
  return slip == null ? null : slip <= 0;
}

export interface ReleaseScheduleSummary {
  /** Releases in the released state. */
  released: number;
  /** Released releases that had a target to grade against (the rate's denominator). */
  measured: number;
  onTime: number;
  late: number;
  /** onTime / measured × 100, or null when nothing is measurable yet. */
  onTimeRatePct: number | null;
  /** Mean calendar-day slip of the late releases only, or null when none were late. */
  avgDaysLate: number | null;
  /** Not released, not cancelled, and the target date is already in the past. */
  overdue: number;
  /** Not released, not cancelled, target date today or later. */
  upcoming: number;
}

export function summarizeReleaseSchedule(rows: readonly ReleaseDates[], now: Date): ReleaseScheduleSummary {
  const today = Math.floor(now.getTime() / DAY_MS);
  let released = 0, onTime = 0, late = 0, lateDays = 0, overdue = 0, upcoming = 0;
  for (const r of rows) {
    if (r.status === RELEASED_STATUS) {
      released += 1;
      const slip = calendarDaySlip(r.releasedAt, r.targetDate);
      if (slip == null) continue;
      if (slip <= 0) onTime += 1;
      else { late += 1; lateDays += slip; }
    } else if (r.status !== CANCELLED_STATUS && r.targetDate != null) {
      const target = utcDay(r.targetDate);
      if (target == null) continue;
      if (target < today) overdue += 1;
      else upcoming += 1;
    }
  }
  const measured = onTime + late;
  return {
    released,
    measured,
    onTime,
    late,
    onTimeRatePct: measured > 0 ? (onTime / measured) * 100 : null,
    avgDaysLate: late > 0 ? lateDays / late : null,
    overdue,
    upcoming,
  };
}
