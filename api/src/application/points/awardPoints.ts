/**
 * AWARD POINTS — the one door every "somebody did X" event goes through.
 *
 * ── THE CONTRACT CALLERS DEPEND ON ───────────────────────────────────────────
 * It is ALWAYS safe to call and it NEVER throws. Every refusal returns a typed
 * no-op, and callers are expected to ignore the result: a job application that
 * succeeded must not fail because the earner was suspended, or because the daily
 * ceiling was already reached. That is why the outcome is informational and why
 * `award` swallows its own faults rather than propagating them — the points
 * economy is a side effect of the platform working, never a precondition for it.
 *
 * ── ORDER OF THE GATES, AND WHY IT IS THIS ORDER ─────────────────────────────
 *   1. unknown action   — a typo must not silently pay
 *   2. suspended        — a suspended earner earns nothing, before any read costs
 *   3. facet            — does this rule pay somebody like them at all
 *   4. user-task gate   — the anti-farming rule
 *   5. daily cap        — a partial award is still an award
 *   6. the ledger write — idempotent at the unique index, not at a pre-read
 *   7. streak, badges, fraud
 *
 * Gates 4 and 5 still advance the STREAK. That is deliberate and it is the
 * behaviour a person expects: they showed up and did the thing, so the day
 * counts, even on a day the ceiling meant it paid nothing.
 *
 * ── WHY BLOCKED ATTEMPTS WRITE A ZERO ROW ────────────────────────────────────
 * A capped or gated attempt inserts an entry worth 0 points. Without it the
 * activity feed simply omits the action and the earner concludes the platform
 * did not notice — the most common complaint the source product logged against
 * this feature. The row is idempotent on the same reference as a paid one would
 * have been, so repeated blocked attempts on one event collapse to a single
 * audit row, and `pointsAwardCount` excludes zero rows so a blocked attempt can
 * never trip a badge threshold.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { awardBadge, heldBadgeKeys, tiersReached } from './badgeAwards';
import { facetsAllow, facetsFor, loadEarnerFacts, loadEarnerTimezone } from './earnerFacets';
import { evaluateFraud, recordFraudFlags } from './fraudSignals';
import {
  POINT_ACTIONS,
  USER_TASK_GATE_THRESHOLD,
  getPointsRule,
  ruleSource,
  type PointsRule,
} from './pointsCatalog';
import { pointsAwardCount, pointsEarnedForActionSince, writePointsEntry } from './pointsLedger';
import { readPointsProfile, writePointsProfile, type PointsProfile } from './pointsProfile';
import { localDay, rollStreak } from './streakEngine';

export type AwardSkipReason =
  | 'unknown_action' | 'suspended' | 'facet_mismatch'
  | 'user_task_gate_not_met' | 'daily_cap_hit' | 'duplicate' | 'error';

export type AwardOutcome =
  | { status: 'awarded'; points: number; badgesUnlocked: string[]; streak: number }
  | { status: 'skipped'; reason: AwardSkipReason };

export interface AwardInput {
  tenantId: number;
  userId: string;
  /** The caller's own event id — a task id, an application id, an order id.
   *  Two calls with the same one are the same event and pay once. Use a
   *  synthetic key (`daily:2026-08-22`) for at-most-once-per-day actions. */
  refId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const DAY_MS = 86_400_000;

/**
 * Record that `userId` did `action`. See the module note: never throws, and the
 * result is for telemetry and for the client's celebration, not for control flow.
 */
export async function awardPoints(
  db: Db, env: Env, action: string, input: AwardInput,
): Promise<AwardOutcome> {
  try {
    return await runAward(db, env, action, input);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/points/awardPoints.ts',
      operation: 'awardPoints',
      context: { action, tenantId: input.tenantId },
    });
    return { status: 'skipped', reason: 'error' };
  }
}

async function runAward(db: Db, env: Env, action: string, input: AwardInput): Promise<AwardOutcome> {
  const rule = getPointsRule(action);
  if (!rule) return { status: 'skipped', reason: 'unknown_action' };

  const { tenantId, userId } = input;
  const profile = await readPointsProfile(db, tenantId, userId);
  if (profile.suspended) return { status: 'skipped', reason: 'suspended' };

  const facts = await loadEarnerFacts(db, tenantId, userId);
  if (!facetsAllow(rule.facets, facetsFor(facts))) {
    return { status: 'skipped', reason: 'facet_mismatch' };
  }

  // ── Gate: user-authored tasks ────────────────────────────────────────────
  if (rule.requiresUserTaskGate && profile.userTaskCompletions < USER_TASK_GATE_THRESHOLD) {
    await recordBlocked(db, env, rule, input, {
      gateBlocked: true,
      gateThreshold: USER_TASK_GATE_THRESHOLD,
      gateCount: profile.userTaskCompletions,
    });
    await advanceStreak(db, env, rule, input, profile);
    return { status: 'skipped', reason: 'user_task_gate_not_met' };
  }

  // ── Gate: daily ceiling ──────────────────────────────────────────────────
  let points = rule.points;
  if (rule.dailyCapPoints != null) {
    const earned = await pointsEarnedForActionSince(
      db, tenantId, userId, rule.key, new Date(Date.now() - DAY_MS),
    );
    const remaining = Math.max(rule.dailyCapPoints - earned, 0);
    if (remaining <= 0) {
      await recordBlocked(db, env, rule, input, { dailyCapHit: true, dailyCapPoints: rule.dailyCapPoints });
      await advanceStreak(db, env, rule, input, profile);
      return { status: 'skipped', reason: 'daily_cap_hit' };
    }
    points = Math.min(points, remaining);
  }

  const written = await writePointsEntry(db, env, {
    tenantId, userId, amount: points, entryKind: 'grant',
    action: rule.key, source: ruleSource(rule),
    refId: input.refId, memo: rule.label, metadata: input.metadata ?? null,
  });
  if (!written) {
    // Already counted. The streak still advances — the duplicate signal is a
    // real signal that the person was here.
    await advanceStreak(db, env, rule, input, profile);
    return { status: 'skipped', reason: 'duplicate' };
  }

  // ── Counters, streak, badges, fraud ──────────────────────────────────────
  const counted = await bumpTaskCounter(db, tenantId, userId, rule, profile);
  const streak = await advanceStreak(db, env, rule, input, counted);
  const badgesUnlocked = await unlockBadges(db, env, rule, input, counted);

  if (rule.key === POINT_ACTIONS.TASK_COMPLETE_USER) {
    await runFraudCheck(db, env, tenantId, userId, counted);
  }

  return { status: 'awarded', points, badgesUnlocked, streak };
}

/** The zero-value audit row a blocked attempt leaves. */
async function recordBlocked(
  db: Db, env: Env, rule: PointsRule, input: AwardInput, why: Record<string, unknown>,
): Promise<void> {
  await writePointsEntry(db, env, {
    tenantId: input.tenantId, userId: input.userId, amount: 0, entryKind: 'grant',
    action: rule.key, source: ruleSource(rule), refId: input.refId, memo: rule.label,
    metadata: { ...(input.metadata ?? {}), ...why },
  });
}

/** Task completions are counted on the PROFILE, because the gate and the century
 *  badge both need a lifetime total and neither wants to scan the ledger. */
async function bumpTaskCounter(
  db: Db, tenantId: number, userId: string, rule: PointsRule, profile: PointsProfile,
): Promise<PointsProfile> {
  if (rule.key === POINT_ACTIONS.TASK_COMPLETE_USER) {
    const next = { ...profile, userTaskCompletions: profile.userTaskCompletions + 1 };
    await writePointsProfile(db, tenantId, userId, next);
    return next;
  }
  if (rule.key === POINT_ACTIONS.TASK_COMPLETE_SYSTEM) {
    const next = { ...profile, systemTaskCompletions: profile.systemTaskCompletions + 1 };
    await writePointsProfile(db, tenantId, userId, next);
    return next;
  }
  return profile;
}

/** Roll the streak and pay any milestone. Returns the streak length now. */
async function advanceStreak(
  db: Db, env: Env, rule: PointsRule, input: AwardInput, profile: PointsProfile,
): Promise<number> {
  if (!rule.streakSignal) return profile.streak.currentStreak;

  const zone = await loadEarnerTimezone(db, input.tenantId, input.userId);
  const rolled = rollStreak(profile.streak, localDay(new Date(), zone));
  if (!rolled.advanced) return profile.streak.currentStreak;

  await writePointsProfile(db, input.tenantId, input.userId, { ...profile, streak: rolled.next });

  if (rolled.milestone) {
    await writePointsEntry(db, env, {
      tenantId: input.tenantId, userId: input.userId,
      amount: rolled.milestone.bonus, entryKind: 'grant',
      action: POINT_ACTIONS.STREAK_BONUS, source: 'streak',
      refId: `${rolled.next.lastActivityDate}:${rolled.milestone.day}`,
      memo: `${rolled.milestone.day}-day streak`,
      metadata: { milestoneDay: rolled.milestone.day },
    });
    await awardBadge(db, env, {
      tenantId: input.tenantId, userId: input.userId, badgeKey: rolled.milestone.badgeSlug,
      evidence: { streakDays: rolled.milestone.day, on: rolled.next.lastActivityDate },
    });
  }
  return rolled.next.currentStreak;
}

/** Evaluate this rule's badge tiers and grant the ones newly reached. */
async function unlockBadges(
  db: Db, env: Env, rule: PointsRule, input: AwardInput, profile: PointsProfile,
): Promise<string[]> {
  const tiers = rule.badges ?? [];
  if (tiers.length === 0) return [];

  const needsActionCount = tiers.some((tier) => (tier.countOf ?? 'action') === 'action');
  const actionCount = needsActionCount
    ? await pointsAwardCount(db, input.tenantId, input.userId, rule.key)
    : 0;

  const reached = tiersReached(rule, {
    action: actionCount,
    userTasks: profile.userTaskCompletions,
    allTasks: profile.userTaskCompletions + profile.systemTaskCompletions,
  });
  if (reached.length === 0) return [];

  const held = await heldBadgeKeys(db, input.tenantId, input.userId, reached.map((tier) => tier.slug));
  const unlocked: string[] = [];
  for (const tier of reached) {
    if (held.has(tier.slug)) continue;
    const granted = await awardBadge(db, env, {
      tenantId: input.tenantId, userId: input.userId, badgeKey: tier.slug,
      evidence: { action: rule.key, threshold: tier.threshold, countOf: tier.countOf ?? 'action' },
    });
    if (granted) unlocked.push(tier.slug);
  }
  return unlocked;
}

/** Bulk-close detection. Only user-authored task completions reach here — the
 *  pattern the gate exists for is "author a hundred tasks and close them all". */
async function runFraudCheck(
  db: Db, env: Env, tenantId: number, userId: string, profile: PointsProfile,
): Promise<void> {
  const flags = await evaluateFraud(db, tenantId, userId);
  if (flags.length === 0) return;
  await recordFraudFlags(db, env, { tenantId, userId, flags, profile });
}
