/**
 * AWARDING A BADGE — the thresholds are read from the rule, never from a switch.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * The source product evaluated badges in a forty-arm `switch` keyed on the action,
 * sitting in a different file from the points catalog that defined the same
 * actions. Adding an earning action meant editing both, and the failure mode was
 * silent: the action earned points and unlocked nothing, because nobody added the
 * arm. Here a rule carries its own {@link BadgeTier} list, so the two cannot
 * disagree — and `pointsCatalog.test.ts` proves every slug a rule names exists.
 *
 * ── THE COUNT A THRESHOLD IS MEASURED AGAINST ────────────────────────────────
 * Three kinds, because the badges genuinely differ: most count qualifying awards
 * of THEIR OWN action ('action'); the century badge counts user-authored task
 * completions, which is the profile counter the earning gate also reads
 * ('user_tasks'); and the first-task badge counts both authorships together
 * ('all_tasks'), since a first task is a first task whoever wrote it.
 *
 * ── AWARDING IS IDEMPOTENT AT THE DATABASE ───────────────────────────────────
 * `uq_user_badges_badge (tenant, user_ref, badge_key)` means a second award is a
 * conflict, not a duplicate. The insert takes `onConflictDoNothing` and the bonus
 * is paid only when a row was actually created — so a replayed event cannot pay
 * the bonus twice even if two requests evaluate the same threshold at once.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { userBadges } from '../../infrastructure/database/schema';
import { builtInBadge } from './badgeCatalog';
import type { BadgeTier, PointsRule } from './pointsCatalog';
import { POINT_ACTIONS } from './pointsCatalog';
import { writePointsEntry } from './pointsLedger';

export interface BadgeCounts {
  /** Qualifying lifetime awards of the rule's own action. */
  action: number;
  userTasks: number;
  allTasks: number;
}

/** Which of this rule's tiers the counts have reached. Pure. */
export function tiersReached(rule: PointsRule, counts: BadgeCounts): BadgeTier[] {
  return (rule.badges ?? []).filter((tier) => countFor(tier, counts) >= tier.threshold);
}

function countFor(tier: BadgeTier, counts: BadgeCounts): number {
  switch (tier.countOf ?? 'action') {
    case 'user_tasks': return counts.userTasks;
    case 'all_tasks': return counts.allTasks;
    default: return counts.action;
  }
}

/**
 * Grant `badgeKey` if the person does not already hold it, paying the badge's
 * bonus when one is defined. Returns true when the badge was newly awarded, so
 * the caller can tell the client what to celebrate.
 *
 * `evidence` records WHY, because a badge with no provenance is unarguable when
 * somebody asks how they got it — or claims they should have.
 */
export async function awardBadge(
  db: Db, env: Env,
  input: { tenantId: number; userId: string; badgeKey: string; evidence?: Record<string, unknown> },
): Promise<boolean> {
  const created = await db.insert(userBadges).values({
    tenantId: input.tenantId,
    userRef: input.userId,
    badgeKey: input.badgeKey,
    awardedBy: 'system',
    evidence: input.evidence ?? null,
  }).onConflictDoNothing().returning({ id: userBadges.id });

  if (created.length === 0) return false;

  const bonus = builtInBadge(input.badgeKey)?.bonusPoints ?? 0;
  if (bonus > 0) {
    await writePointsEntry(db, env, {
      tenantId: input.tenantId,
      userId: input.userId,
      amount: bonus,
      entryKind: 'grant',
      action: POINT_ACTIONS.BADGE_UNLOCKED,
      source: 'badge',
      refId: input.badgeKey,
      memo: `Badge unlocked — ${builtInBadge(input.badgeKey)?.name ?? input.badgeKey}`,
      metadata: { badgeKey: input.badgeKey },
    });
  }
  return true;
}

/** Which of these badge keys the person already holds — one query, so the award
 *  path does not issue an insert per tier just to have it conflict. */
export async function heldBadgeKeys(
  db: Db, tenantId: number, userId: string, keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.select({ badgeKey: userBadges.badgeKey })
    .from(userBadges)
    .where(and(
      eq(userBadges.tenantId, tenantId),
      eq(userBadges.userRef, userId),
      inArray(userBadges.badgeKey, [...keys]),
    ));
  return new Set(rows.map((row) => row.badgeKey));
}
