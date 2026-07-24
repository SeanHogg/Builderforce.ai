/**
 * Per-seat AI spend caps — the owner-configured dollar ceiling on each Teams seat's
 * month-to-date AI spend, and the budget/spend notifications that ride it.
 *
 * WHY: a Teams tenant that does NOT bring its own key (BYO) runs paid models on
 * Builderforce's OpenRouter account, so every non-BYO call is metered at the
 * OpenRouter rate into `llm_usage_log.cost_usd_millicents` (BYO rows are forced to
 * 0 — see usageLedger.recordUsageRow). This module lets the account OWNER put a
 * per-user monthly $ cap on that spend, pauses NEW paid spend for a seat once it
 * reaches the cap, and notifies as the seat crosses 50/80/100% of its budget.
 *
 * SINGLE SOURCE: the effective-cap rule ({@link resolveMemberSpendCapMillicents})
 * and the month-to-date spend sum are defined once here; the gateway spend gate
 * (llmRoutes.enforceTokenCaps), the owner overview endpoint (tenantRoutes), and the
 * notifications all consume them — "shown == enforced", exactly like the token
 * meter (tokenUsage.ts). Teams-only: gated on PlanLimits.seatCostControls, which is
 * true for Teams and false for Free/Pro. Superadmin operators are never capped.
 */

import { and, eq, gte, sql as dsql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog, tenantMembers, tenants, users } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { utcMonthStart, utcNextMonthStart } from '../llm/tokenUsage';
import { notify } from '../notifications/notify';

/** Millicents per US dollar — the unit `llm_usage_log.cost_usd_millicents` is
 *  stamped in (1 millicent = 1/100000 USD). Amounts are stored as millicents and
 *  surfaced to the UI as dollars. */
export const MILLICENTS_PER_USD = 100_000;
export function usdToMillicents(usd: number): number { return Math.round(usd * MILLICENTS_PER_USD); }
export function millicentsToUsd(mc: number): number { return mc / MILLICENTS_PER_USD; }

/** Notification thresholds (% of cap) — the owner + seat are pinged once as each is
 *  first crossed in a billing month. 100 = cap reached (paid spend paused). */
const NOTIFY_LEVELS = [50, 80, 100] as const;

/** Map the string effectivePlan the gateway carries to the TenantPlan enum. */
function toPlanEnum(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'teams') return TenantPlan.TEAMS;
  if (ep === 'pro') return TenantPlan.PRO;
  return TenantPlan.FREE;
}

/**
 * Resolve a seat's EFFECTIVE monthly spend cap (millicents) from its per-seat
 * override + the tenant's team-wide default. Mirrors the override convention used
 * everywhere else (e.g. resolveImageCreditsDailyLimit):
 *   • member === -1          → unlimited (null)  — a seat explicitly exempted from a team default
 *   • member >= 0            → that explicit cap (0 = no paid spend allowed)
 *   • member null            → fall through to the tenant default:
 *       • default null / < 0 → unlimited (null)
 *       • default >= 0       → the team default
 * `null` means "no cap" (the gate is skipped). Defined ONCE so the gate, the owner
 * list, and the display can never disagree.
 */
export function resolveMemberSpendCapMillicents(
  memberCap: number | null | undefined,
  tenantDefault: number | null | undefined,
): number | null {
  if (memberCap === -1) return null;
  if (memberCap != null && memberCap >= 0) return memberCap;
  if (tenantDefault == null || tenantDefault < 0) return null;
  return tenantDefault;
}

/** True when the plan includes per-seat cost controls (Teams). One check so the
 *  gate and the owner UI agree on who the feature is available to. */
export function seatCostControlsEnabled(effectivePlan: 'free' | 'pro' | 'teams'): boolean {
  return getLimits(toPlanEnum(effectivePlan)).seatCostControls;
}

// ── cache keys ──────────────────────────────────────────────────────────────
// Config (caps) changes rarely → cache 120s and invalidate the specific member's
// key on a per-seat write. A tenant-default change can't enumerate per-member keys,
// so it relies on the 120s TTL (acceptable lag for a config change) — the owner UI
// reads the fresh value from the mutation response regardless.
const configKey = (tenantId: number, userId: string) => `member-spend-config:v1:${tenantId}:${userId}`;
// Spend sum changes constantly → cache 60s (same freshness the consumption meter uses).
const spendKey = (tenantId: number, userId: string, monthKey: string) => `member-spend:v1:${tenantId}:${userId}:${monthKey}`;
// Owner overview (all seats) → cache 30s; invalidated on any spend-limit write.
const overviewKey = (tenantId: number, monthKey: string) => `team-spend-overview:v1:${tenantId}:${monthKey}`;

const monthKeyOf = (d: Date) => d.toISOString().slice(0, 7);

interface MemberSpendConfig { memberCap: number | null; tenantDefault: number | null; }

/** Load a seat's stored cap + the tenant default in one indexed join (cached). */
async function loadMemberSpendConfig(db: Db, env: Env | undefined, tenantId: number, userId: string): Promise<MemberSpendConfig> {
  const compute = async (): Promise<MemberSpendConfig> => {
    const [row] = await db
      .select({
        memberCap: tenantMembers.monthlySpendCapMillicents,
        tenantDefault: tenants.memberDefaultSpendCapMillicents,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    return { memberCap: row?.memberCap ?? null, tenantDefault: row?.tenantDefault ?? null };
  };
  if (!env) return compute();
  return getOrSetCached(env, configKey(tenantId, userId), compute, { kvTtlSeconds: 120, l1TtlMs: 60_000 });
}

/** Month-to-date non-BYO spend (millicents) for one seat (cached 60s). BYO rows
 *  record cost 0, so summing the cost column is exactly "OpenRouter-rate spend". */
async function sumMemberSpendMillicents(db: Db, env: Env | undefined, tenantId: number, userId: string, monthStart: Date): Promise<number> {
  const compute = async (): Promise<number> => {
    const [row] = await db
      .select({ spent: dsql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)` })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, tenantId),
        eq(llmUsageLog.userId, userId),
        gte(llmUsageLog.createdAt, monthStart),
      ));
    return Math.max(0, Math.round(Number(row?.spent ?? 0)));
  };
  if (!env) return compute();
  return getOrSetCached(env, spendKey(tenantId, userId, monthKeyOf(monthStart)), compute, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
}

export interface MemberSpendAvailability {
  /** True when the plan offers per-seat cost controls (Teams). */
  seatControlsEnabled: boolean;
  /** True when the seat may still spend on paid models (cap not reached / no cap). */
  hasBudget: boolean;
  /** Resolved cap in millicents; null = unlimited (no cap). */
  capMillicents: number | null;
  /** Month-to-date non-BYO spend in millicents. */
  spentMillicents: number;
  /** 0–100 (0 when unlimited). */
  percentUsed: number;
}

const UNGATED: MemberSpendAvailability = { seatControlsEnabled: false, hasBudget: true, capMillicents: null, spentMillicents: 0, percentUsed: 0 };

/**
 * THE per-seat spend gate. Answers "may this seat spend on a paid model right now?".
 * Short-circuits to unlimited when the plan has no seat controls, when the seat has
 * no cap, or when a superadmin operates the tenant — so uncapped seats pay for at
 * most one cheap cached config read. Best-effort by contract: the caller treats a
 * throw as "allow" (fail-open), so a transient scan failure never blocks a run.
 */
export async function getMemberSpendAvailability(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  userId: string,
  opts: { effectivePlan: 'free' | 'pro' | 'teams'; actingUserId?: string | null; actingIsSuperadmin?: boolean },
): Promise<MemberSpendAvailability> {
  if (!seatCostControlsEnabled(opts.effectivePlan)) return UNGATED;
  const cfg = await loadMemberSpendConfig(db, env, tenantId, userId);
  const cap = resolveMemberSpendCapMillicents(cfg.memberCap, cfg.tenantDefault);
  if (cap == null) return { ...UNGATED, seatControlsEnabled: true };
  // A superadmin operator is never capped (same rule the token gate uses).
  if (await resolveSuperadminUnlimited(db, tenantId, opts, env)) {
    return { seatControlsEnabled: true, hasBudget: true, capMillicents: cap, spentMillicents: 0, percentUsed: 0 };
  }
  const spent = await sumMemberSpendMillicents(db, env, tenantId, userId, utcMonthStart());
  const percentUsed = cap <= 0 ? 100 : Math.min(100, Math.round((spent / cap) * 100));
  return { seatControlsEnabled: true, hasBudget: spent < cap, capMillicents: cap, spentMillicents: spent, percentUsed };
}

/**
 * Fire the budget/spend notification when a seat first crosses a 50/80/100%
 * threshold this month. Deduped via `tenant_members.spend_notify_period/level` so
 * each threshold pings once. Notifies BOTH the affected seat (their own budget) and
 * every active owner (they set the budget). Best-effort — never throws; meant to be
 * scheduled off the hot path via `ctx.waitUntil`.
 */
export async function maybeEmitSpendNotification(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  availability: MemberSpendAvailability,
): Promise<void> {
  try {
    if (!availability.seatControlsEnabled || availability.capMillicents == null) return;
    const pct = availability.percentUsed;
    const level = pct >= 100 ? 100 : pct >= 80 ? 80 : pct >= 50 ? 50 : 0;
    if (level === 0) return;

    const monthKey = monthKeyOf(utcMonthStart());
    const [state] = await db
      .select({ period: tenantMembers.spendNotifyPeriod, notified: tenantMembers.spendNotifyLevel, name: users.displayName })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    const prevLevel = state?.period === monthKey ? (state?.notified ?? 0) : 0;
    if (level <= prevLevel) return; // already pinged at/above this threshold this month

    // Advance the dedupe state first, so a concurrent request can't double-send.
    await db.update(tenantMembers)
      .set({ spendNotifyPeriod: monthKey, spendNotifyLevel: level })
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));

    const sqlc = neon(env.NEON_DATABASE_URL);
    const capUsd = millicentsToUsd(availability.capMillicents).toFixed(2);
    const spentUsd = millicentsToUsd(availability.spentMillicents).toFixed(2);
    const memberName = state?.name || 'A team member';

    // The seat's own notification (addressed to them).
    const reached = level >= 100;
    await notify(sqlc, env, {
      userId,
      tenantId,
      kind: reached ? 'spend_cap_reached' : 'spend_cap_warning',
      title: reached
        ? `You've reached your monthly AI budget ($${capUsd})`
        : `You've used ${level}% of your monthly AI budget`,
      body: reached
        ? `Your AI spend has reached its $${capUsd} monthly cap ($${spentUsd} used). Paid model usage is paused until the cap resets or your workspace owner raises it. Connect your own model key to keep going at your own rate.`
        : `You've spent $${spentUsd} of your $${capUsd} monthly AI budget.`,
      ref: userId,
    });

    // Every active owner (they own the budget) — skip the seat if they ARE the owner.
    const owners = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, 'owner'), eq(tenantMembers.isActive, true)));
    for (const o of owners) {
      if (o.userId === userId) continue;
      await notify(sqlc, env, {
        userId: o.userId,
        tenantId,
        kind: reached ? 'spend_cap_reached' : 'spend_cap_warning',
        title: reached
          ? `${memberName} reached their AI budget ($${capUsd})`
          : `${memberName} is at ${level}% of their AI budget`,
        body: reached
          ? `${memberName} has reached their $${capUsd} monthly AI spend cap ($${spentUsd} used). Their paid model usage is paused until the cap resets or you raise it in Settings → Spend limits.`
          : `${memberName} has spent $${spentUsd} of their $${capUsd} monthly AI budget.`,
        ref: userId,
      });
    }
  } catch (err) {
    console.warn('[memberSpend] notify failed:', (err as Error)?.message);
  }
}

// ── Owner overview (all seats) ───────────────────────────────────────────────

export interface SeatSpend {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  /** Stored per-seat value: null = inherit default, -1 = unlimited, >= 0 = explicit (millicents). */
  capMillicents: number | null;
  /** Resolved effective cap (millicents); null = unlimited. */
  effectiveCapMillicents: number | null;
  /** Month-to-date non-BYO spend (millicents). */
  spentMillicents: number;
  /** 0–100 (0 when unlimited). */
  percentUsed: number;
}

export interface TeamSpendOverview {
  seatControlsEnabled: boolean;
  effectivePlan: 'free' | 'pro' | 'teams';
  /** Team-wide default per-seat cap (millicents); null = no default. */
  defaultCapMillicents: number | null;
  periodStart: string;
  periodResetsAt: string;
  seats: SeatSpend[];
}

/**
 * Build the owner's spend overview for a tenant: every active seat with its cap +
 * month-to-date spend. Three scans (tenant row, members+users, per-user spend
 * GROUP BY) — never per-seat N+1. Cached 30s per tenant/month; invalidated on any
 * spend-limit write via {@link invalidateTeamSpendCaches}.
 */
export async function getTeamSpendOverview(db: Db, env: Env | undefined, tenantId: number): Promise<TeamSpendOverview> {
  const monthStart = utcMonthStart();
  const monthKey = monthKeyOf(monthStart);
  const compute = async (): Promise<TeamSpendOverview> => {
    const [tenantRow] = await db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        defaultCap: tenants.memberDefaultSpendCapMillicents,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const effectivePlan = resolveEffectivePlan({
      plan: (tenantRow?.plan ?? 'free') as TenantPlan,
      billingStatus: (tenantRow?.billingStatus ?? 'none') as TenantBillingStatus,
      trialEndsAt: tenantRow?.trialEndsAt ?? null,
    });
    const planString = effectivePlan === TenantPlan.TEAMS ? 'teams' : effectivePlan === TenantPlan.PRO ? 'pro' : 'free';
    const defaultCap = tenantRow?.defaultCap ?? null;

    const [members, spendRows] = await Promise.all([
      db
        .select({
          userId: tenantMembers.userId,
          name: users.displayName,
          email: users.email,
          role: tenantMembers.role,
          cap: tenantMembers.monthlySpendCapMillicents,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true))),
      db
        .select({ userId: llmUsageLog.userId, spent: dsql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)` })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, monthStart)))
        .groupBy(llmUsageLog.userId),
    ]);

    const spentByUser = new Map<string, number>();
    for (const r of spendRows) {
      if (r.userId) spentByUser.set(r.userId, Math.max(0, Math.round(Number(r.spent ?? 0))));
    }

    const seats: SeatSpend[] = members.map((m) => {
      const effectiveCap = resolveMemberSpendCapMillicents(m.cap ?? null, defaultCap);
      const spent = spentByUser.get(m.userId) ?? 0;
      const percentUsed = effectiveCap == null ? 0 : effectiveCap <= 0 ? 100 : Math.min(100, Math.round((spent / effectiveCap) * 100));
      return {
        userId: m.userId,
        name: m.name ?? null,
        email: m.email ?? null,
        role: m.role,
        capMillicents: m.cap ?? null,
        effectiveCapMillicents: effectiveCap,
        spentMillicents: spent,
        percentUsed,
      };
    });
    // Highest spenders first — the seats an owner cares about.
    seats.sort((a, b) => b.spentMillicents - a.spentMillicents);

    return {
      seatControlsEnabled: getLimits(effectivePlan).seatCostControls,
      effectivePlan: planString,
      defaultCapMillicents: defaultCap,
      periodStart: monthStart.toISOString(),
      periodResetsAt: utcNextMonthStart().toISOString(),
      seats,
    };
  };
  if (!env) return compute();
  return getOrSetCached(env, overviewKey(tenantId, monthKey), compute, { kvTtlSeconds: 30, l1TtlMs: 15_000 });
}

/** Invalidate the cached config + overview after an owner changes a spend limit, so
 *  the next gate check + owner read reflect it immediately (rather than at TTL). Pass
 *  `userId` to also drop that seat's config entry. Best-effort. */
export async function invalidateTeamSpendCaches(env: Env | undefined, tenantId: number, userId?: string): Promise<void> {
  if (!env) return;
  const monthKey = monthKeyOf(utcMonthStart());
  await Promise.all([
    invalidateCached(env, overviewKey(tenantId, monthKey)),
    userId ? invalidateCached(env, configKey(tenantId, userId)) : Promise.resolve(),
  ]);
}
