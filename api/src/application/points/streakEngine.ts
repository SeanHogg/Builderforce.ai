/**
 * THE STREAK — a pure state machine over "this person did something on day X".
 *
 * No database, no clock of its own, no points. It takes the stored streak and a
 * day, and returns the next streak plus any milestone that just became payable.
 * The award path does the writing; keeping the rule pure is what lets the
 * boundary cases — a leap day, a timezone move, a milestone crossed on the same
 * day it is re-triggered — be tested against literals.
 *
 * ── THE DAY IS THE EARNER'S, NOT THE SERVER'S ────────────────────────────────
 * A streak that breaks at UTC midnight punishes half the planet for being awake.
 * {@link localDay} resolves the day in the earner's own IANA zone, falling back
 * to UTC when it is unknown — and the stored shape is identical either way, so a
 * person who sets their timezone later does not lose the streak they had.
 *
 * ── WHY THE MILESTONE COUNTER RESETS ─────────────────────────────────────────
 * `lastBonusMilestone` is per streak INSTANCE. Breaking a 30-day run and building
 * another one pays the 7-day bonus again, which is the entire point of a streak:
 * it rewards the rebuild. What it must not do is pay twice inside one run, and
 * that is the only thing the counter prevents.
 */

import { STREAK_MILESTONES } from './pointsCatalog';
import type { StreakState } from './pointsProfile';

export interface StreakRoll {
  next: StreakState;
  /** The milestone that became payable on THIS roll, or null. */
  milestone: { day: number; bonus: number; badgeSlug: string } | null;
  /** True when this roll moved the streak to a new day — the signal the caller
   *  uses to decide whether anything needs writing at all. */
  advanced: boolean;
}

/** The calendar day `at` falls on, in `timeZone` (IANA) or UTC. `YYYY-MM-DD`. */
export function localDay(at: Date, timeZone?: string | null): string {
  if (!timeZone) return at.toISOString().slice(0, 10);
  try {
    // en-CA renders ISO-ordered dates, so no re-assembly from parts is needed.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  } catch {
    // An unknown or malformed zone must not break earning. UTC is the same
    // fallback a missing zone takes, so the two failure modes behave alike.
    return at.toISOString().slice(0, 10);
  }
}

/** Whole days between two `YYYY-MM-DD` strings. Both are parsed at UTC midnight,
 *  so the arithmetic is immune to the DST shifts that make local-time
 *  subtraction return 23- and 25-hour "days". */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Roll the streak forward onto `day`.
 *
 *   • no prior activity  → the streak starts at 1
 *   • same day as last   → unchanged, nothing to write
 *   • the very next day  → +1, and a milestone may become payable
 *   • any larger gap     → back to 1, milestone counter cleared
 *
 * A day BEFORE the last recorded one (a replayed event, a clock correction) is
 * treated as "already counted" rather than as a gap: it must never shorten a
 * streak the earner legitimately holds.
 */
export function rollStreak(current: StreakState, day: string): StreakRoll {
  const last = current.lastActivityDate;

  if (!last) {
    const next: StreakState = {
      currentStreak: 1,
      longestStreak: Math.max(current.longestStreak, 1),
      lastActivityDate: day,
      lastBonusMilestone: 0,
    };
    return { next, milestone: milestoneFor(1, 0), advanced: true };
  }

  const gap = daysBetween(last, day);
  if (gap <= 0) return { next: current, milestone: null, advanced: false };

  const streak = gap === 1 ? current.currentStreak + 1 : 1;
  const paidUpTo = gap === 1 ? current.lastBonusMilestone : 0;
  const milestone = milestoneFor(streak, paidUpTo);

  const next: StreakState = {
    currentStreak: streak,
    longestStreak: Math.max(current.longestStreak, streak),
    lastActivityDate: day,
    lastBonusMilestone: milestone ? milestone.day : paidUpTo,
  };
  return { next, milestone, advanced: true };
}

/** The highest milestone this streak length has reached that has not been paid
 *  in this instance. Highest, not lowest: a streak restored from a backfill can
 *  jump several milestones at once and should pay the one it actually reached. */
function milestoneFor(streak: number, paidUpTo: number): { day: number; bonus: number; badgeSlug: string } | null {
  let found: { day: number; bonus: number; badgeSlug: string } | null = null;
  for (const milestone of STREAK_MILESTONES) {
    if (milestone.day <= streak && milestone.day > paidUpTo) found = milestone;
  }
  return found;
}
