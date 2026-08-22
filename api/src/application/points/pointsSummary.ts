/**
 * THE ONE READ EVERY POINTS SURFACE USES.
 *
 * Balance, streak, badges, the activity feed and the leaderboard, assembled once
 * on the server. A widget, a profile panel and the canvas all show pieces of this
 * and none of them assembles its own — which is the rule that stops "how many
 * points do I have" being answered three ways in one product.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * The summary is a fan-out of five reads and is cached 60s per (tenant, user);
 * `invalidatePointsCaches` orphans it from every writer in this module family, so
 * the TTL is a backstop rather than the mechanism. The leaderboard is cached
 * SEPARATELY and per tenant, because it is the same answer for everybody in the
 * workspace and keying it per user would multiply one scan by the headcount.
 *
 * ── THE BADGE LIST IS A JOIN AGAINST DATA, NOT A TABLE ───────────────────────
 * Awards live in `user_badges`; the definitions are `badgeCatalog`'s built-ins
 * unioned with the tenant's own `badges` rows, tenant winning on a key collision.
 * An award whose key matches neither still renders — under its raw key, rather
 * than vanishing — because a badge somebody holds must never disappear from their
 * profile just because its definition was renamed.
 */

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { badges, ledgerEntries, userBadges } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { POINTS } from '../kernel/denominations';
import { BUILT_IN_BADGES, builtInBadge } from './badgeCatalog';
import { POINTS_CATALOG } from './pointsCatalog';
import { pointsBalance, recentPointsEntries, type PointsEntry } from './pointsLedger';
import { readPointsProfile } from './pointsProfile';
import { catalogWithAvailability } from './redemptionCatalog';

export interface HeldBadge {
  key: string;
  name: string;
  description: string;
  iconKey: string;
  awardedAt: string;
}

export interface LeaderboardRow {
  userRef: string;
  points: number;
  rank: number;
}

export interface PointsSummary {
  balance: number;
  streak: { current: number; longest: number; lastActivityDate: string | null };
  suspended: boolean;
  badges: HeldBadge[];
  /** Badges this platform offers that the person has not earned yet — the "what
   *  is there to aim at" half, without which a badge list is only a trophy case. */
  available: Array<{ key: string; name: string; description: string; iconKey: string }>;
  activity: PointsEntry[];
  rewards: ReturnType<typeof catalogWithAvailability>;
  /** Every earning rule, so a surface can show HOW to earn rather than only what
   *  was earned. Static data — it costs nothing to include and its absence is why
   *  the source product's points page could not answer "how do I get more". */
  earnRules: Array<{ key: string; label: string; points: number; dailyCapPoints: number | null }>;
}

export async function pointsSummary(
  db: Db, env: Env, tenantId: number, userId: string,
): Promise<PointsSummary> {
  return getOrSetCached(env, `points:summary:t:${tenantId}:u:${userId}`, async () => {
    const [balance, profile, held, activity] = await Promise.all([
      pointsBalance(db, env, tenantId, userId),
      readPointsProfile(db, tenantId, userId),
      heldBadges(db, tenantId, userId),
      recentPointsEntries(db, tenantId, userId, 25),
    ]);

    const heldKeys = new Set(held.map((badge) => badge.key));
    return {
      balance,
      streak: {
        current: profile.streak.currentStreak,
        longest: profile.streak.longestStreak,
        lastActivityDate: profile.streak.lastActivityDate,
      },
      suspended: profile.suspended,
      badges: held,
      available: BUILT_IN_BADGES
        .filter((badge) => !heldKeys.has(badge.key))
        .map(({ key, name, description, iconKey }) => ({ key, name, description, iconKey })),
      activity,
      rewards: catalogWithAvailability(),
      earnRules: POINTS_CATALOG
        .filter((rule) => rule.points > 0)
        .map((rule) => ({
          key: rule.key,
          label: rule.label,
          points: rule.points,
          dailyCapPoints: rule.dailyCapPoints ?? null,
        })),
    };
  }, { kvTtlSeconds: 60 });
}

/** Awards joined to their definitions. Two reads, unioned in memory: the tenant's
 *  own badge rows are few, and a SQL union against an in-code catalog is not
 *  expressible without materialising the catalog into the database — which is the
 *  thing `badgeCatalog` exists to avoid. */
async function heldBadges(db: Db, tenantId: number, userId: string): Promise<HeldBadge[]> {
  const [awards, tenantDefs] = await Promise.all([
    db.select({ badgeKey: userBadges.badgeKey, awardedAt: userBadges.awardedAt })
      .from(userBadges)
      .where(and(
        eq(userBadges.tenantId, tenantId),
        eq(userBadges.userRef, userId),
        isNull(userBadges.revokedAt),
      ))
      .orderBy(desc(userBadges.awardedAt)),
    db.select({ key: badges.key, name: badges.name, description: badges.description, iconKey: badges.iconKey })
      .from(badges)
      .where(or(eq(badges.tenantId, tenantId), isNull(badges.tenantId))),
  ]);

  const byKey = new Map(tenantDefs.map((def) => [def.key, def]));
  return awards.map((award) => {
    const tenantDef = byKey.get(award.badgeKey);
    const builtIn = builtInBadge(award.badgeKey);
    return {
      key: award.badgeKey,
      name: tenantDef?.name ?? builtIn?.name ?? award.badgeKey,
      description: tenantDef?.description ?? builtIn?.description ?? '',
      iconKey: tenantDef?.iconKey ?? builtIn?.iconKey ?? 'badge',
      awardedAt: (award.awardedAt instanceof Date ? award.awardedAt : new Date(award.awardedAt)).toISOString(),
    };
  });
}

/**
 * The workspace leaderboard — lifetime points, highest first.
 *
 * Cached per tenant for five minutes rather than sixty seconds: it is the most
 * expensive read here (a grouped scan over every points row in the workspace) and
 * it is the one whose staleness nobody can perceive. Every points write still
 * orphans it, so the five minutes only ever applies to a workspace where nothing
 * has happened.
 */
export async function pointsLeaderboard(
  db: Db, env: Env, tenantId: number, limit = 20,
): Promise<LeaderboardRow[]> {
  return getOrSetCached(env, `points:leaderboard:t:${tenantId}`, async () => {
    const rows = await db
      .select({
        userRef: ledgerEntries.accountRef,
        points: sql<string>`sum(${ledgerEntries.amount})`,
      })
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.tenantId, tenantId),
        eq(ledgerEntries.accountKind, 'user'),
        eq(ledgerEntries.denomination, POINTS),
      ))
      .groupBy(ledgerEntries.accountRef)
      .orderBy(desc(sql`sum(${ledgerEntries.amount})`))
      .limit(Math.min(Math.max(limit, 1), 100));

    return rows.map((row, index) => ({
      userRef: row.userRef,
      points: Math.round(Number(row.points)),
      rank: index + 1,
    }));
  }, { kvTtlSeconds: 300 });
}
