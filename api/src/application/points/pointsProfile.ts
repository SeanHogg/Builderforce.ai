/**
 * THE EARNER'S NON-LEDGER STATE — streak, counters, suspension.
 *
 * ── WHY THIS IS A `settings` ROW AND NOT THREE TABLES ────────────────────────
 * The source product carried `points_streaks`, `points_task_streaks` and
 * `points_activity_counters` — three tables, one row each per user, all read
 * together on every award and never queried across users. The kernel already has
 * the shape for exactly that: a singleton per (tenant, scope, scopeRef, feature),
 * with a unique index proving there is only one.
 *
 * The boundary `settings` states for itself is "if a query needs to filter or
 * aggregate on it, it is not a setting", and this state passes that test on its
 * own terms rather than by assertion:
 *
 *   • The leaderboard ranks by POINTS, which is a ledger sum, not a streak.
 *   • The fraud review queue lists FLAGS, and each flag names its own subject —
 *     nothing ever asks "which users are suspended" as a filtered scan.
 *   • The streak and the counters are read for ONE person, on that person's own
 *     award path, and written in the same breath.
 *
 * One row rather than three also makes the award path atomic in the way that
 * matters: a streak roll that advances the day and pays a milestone updates one
 * JSON value, so a crash between two of the three writes cannot leave a streak
 * that advanced without recording that it had already paid its bonus.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 * The BALANCE. It is a ledger sum (`pointsLedger.ts`) and putting a copy of it
 * beside the streak would be the stored total the ledger exists to avoid.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { settings } from '../../infrastructure/database/schema';

/** The feature key this singleton is filed under. */
const FEATURE = 'points';

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  /** YYYY-MM-DD in the earner's own timezone, or UTC when unknown. */
  lastActivityDate: string | null;
  /** Highest milestone DAY already paid in the CURRENT streak instance. Reset
   *  when the streak breaks, which is what makes a rebuilt streak pay again. */
  lastBonusMilestone: number;
}

export interface PointsProfile {
  streak: StreakState;
  /** Task completions, split by who authored the task. The user-authored count
   *  is the anti-farming gate's input. */
  userTaskCompletions: number;
  systemTaskCompletions: number;
  /** Earning is halted — set by the fraud path, cleared by an operator. */
  suspended: boolean;
  suspendedReason: string | null;
}

export const EMPTY_PROFILE: PointsProfile = {
  streak: { currentStreak: 0, longestStreak: 0, lastActivityDate: null, lastBonusMilestone: 0 },
  userTaskCompletions: 0,
  systemTaskCompletions: 0,
  suspended: false,
  suspendedReason: null,
};

/** Widen whatever JSON is stored into the current shape. A row written by an
 *  older build is missing keys rather than wrong, so it is filled, not rejected. */
function hydrate(value: unknown): PointsProfile {
  const raw = (value ?? {}) as Partial<PointsProfile> & { streak?: Partial<StreakState> };
  return {
    streak: {
      currentStreak: Number(raw.streak?.currentStreak ?? 0),
      longestStreak: Number(raw.streak?.longestStreak ?? 0),
      lastActivityDate: raw.streak?.lastActivityDate ?? null,
      lastBonusMilestone: Number(raw.streak?.lastBonusMilestone ?? 0),
    },
    userTaskCompletions: Number(raw.userTaskCompletions ?? 0),
    systemTaskCompletions: Number(raw.systemTaskCompletions ?? 0),
    suspended: raw.suspended === true,
    suspendedReason: raw.suspendedReason ?? null,
  };
}

/** Deliberately UNCACHED. It is read on the write path immediately before the
 *  decision it gates (suspension, the task gate, the streak day), and a cached
 *  answer here is a suspended account that keeps earning for the TTL. */
export async function readPointsProfile(db: Db, tenantId: number, userId: string): Promise<PointsProfile> {
  const [row] = await db.select({ value: settings.value })
    .from(settings)
    .where(and(
      eq(settings.tenantId, tenantId),
      eq(settings.scope, 'user'),
      eq(settings.scopeRef, userId),
      eq(settings.feature, FEATURE),
    ))
    .limit(1);
  return hydrate(row?.value);
}

/** Upsert the whole singleton. One writer, one shape — callers mutate a value
 *  they just read rather than patching fields from several places. */
export async function writePointsProfile(
  db: Db, tenantId: number, userId: string, profile: PointsProfile,
): Promise<void> {
  await db.insert(settings).values({
    tenantId,
    scope: 'user',
    scopeRef: userId,
    feature: FEATURE,
    value: profile as unknown as Record<string, unknown>,
    updatedBy: userId,
  }).onConflictDoUpdate({
    target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
    set: { value: profile as unknown as Record<string, unknown>, updatedAt: sql`now()` },
  });
}
