/**
 * tenantTokenAvailability — context-free answer to "does this tenant have token
 * budget left right now, and if not, why". THE single check the autonomous
 * execution cron gates cloud runs on (a tenant that is out of tokens must not
 * keep burning our pool), reusing the EXACT same limit resolver
 * ({@link resolveTokenLimits}) + usage accountant ({@link sumTenantTextTokensDayAndMonth})
 * the request-path gate (`enforceTokenCaps` in llmRoutes) and the consumption
 * meter use — so "out of tokens" here means the same thing the user sees on the
 * meter and the same thing the gateway enforces.
 *
 * Unlike `enforceTokenCaps`, this takes no Hono `Context`: it resolves the
 * tenant's plan snapshot straight from the `tenants` row so a cron (which has
 * only `db`) can call it per tenant.
 *
 * THE single source of the "superadmin ⇒ unlimited" rule for every caller. It is
 * granted from BOTH the acting user (when present) AND the tenant's OWN active
 * membership ({@link tenantHasSuperadminMember}), so an account OWNED/operated by a
 * superadmin is never gated — including on the cron sweeps, which pass no acting
 * user. Every gate (cron manager sweep, autonomous executor, interactive Run-now,
 * gateway) flows through here, so this one function is the only place to change it.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenants, tenantMembers, users } from '../../infrastructure/database/schema';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveTokenLimits } from '../../domain/tenant/PlanLimits';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { sumTenantTextTokensDayAndMonth, utcDayStart, utcMonthStart } from './tokenUsage';

export type TokenExhaustionReason = 'daily_exhausted' | 'monthly_exhausted';

export interface TenantTokenAvailability {
  /** True when the tenant may spend on our pool (neither daily nor monthly cap hit). */
  hasTokens: boolean;
  /** Why the tenant is blocked, or null when it has budget. */
  reason: TokenExhaustionReason | null;
  /** Resolved daily cap (-1 = unlimited). */
  dailyLimit: number;
  /** Resolved monthly cap (-1 = unlimited). */
  monthlyLimit: number;
  /** Cache-discounted text tokens used so far today / this month. */
  usageToday: number;
  usageMonth: number;
  /** The plan the tenant is currently entitled to (drives the upgrade copy). */
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** Map a TenantPlan enum back to the string form used in user-facing copy. */
function planString(plan: TenantPlan): 'free' | 'pro' | 'teams' {
  if (plan === TenantPlan.TEAMS) return 'teams';
  if (plan === TenantPlan.PRO) return 'pro';
  return 'free';
}

/** Map an effective-plan string (as the gateway carries it) to the TenantPlan enum. */
function toTenantPlanEnum(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'teams') return TenantPlan.TEAMS;
  if (ep === 'pro') return TenantPlan.PRO;
  return TenantPlan.FREE;
}

/**
 * Resolve a tenant's live token availability. THE single entry every cap path calls
 * (cron sweeps, interactive Run-now, and the LLM gateway's `enforceTokenCaps`), so
 * "out of tokens" and the superadmin bypass are defined exactly once.
 *
 * Unlimited callers short-circuit to `hasTokens: true` without a usage scan: a tenant
 * on a plan with no cap (or a `tokenDailyLimitOverride` of -1), OR a superadmin. The
 * superadmin verdict is granted from — in order — (1) `opts.actingIsSuperadmin` when
 * the caller already resolved its principal (the gateway passes `access.isSuperadmin`,
 * covering `bfk_*` key-creators with no user row); (2) `opts.actingUserId` resolved
 * against `users.isSuperadmin` (interactive paths that only have a user id); and
 * (3) the tenant's OWN active membership ({@link tenantHasSuperadminMember}) — so an
 * account OWNED/operated by a superadmin is unlimited even on the cron sweeps, which
 * pass no principal. `users.isSuperadmin` is the sole, revocation-safe source of truth.
 * The superadmin lookups run ONLY for an already-capped tenant, so unlimited tenants
 * pay nothing. Pass `env` to serve the (stable) tenant-owner lookup through the
 * read-through cache on hot paths.
 *
 * Best-effort by contract: the caller (cron) treats a throw as "unknown" and skips
 * rather than blocks — see the sweep.
 */
export async function getTenantTokenAvailability(
  db: Db,
  tenantId: number,
  opts?: {
    actingUserId?: string | null;
    actingIsSuperadmin?: boolean;
    /** A caller that ALREADY resolved the tenant's plan snapshot (the gateway holds
     *  it on `access`) passes it here so this skips the tenant-row read — no redundant
     *  query on the hot path. The DECISION still lives here; only the input is reused. */
    planSnapshot?: { effectivePlan: 'free' | 'pro' | 'teams'; tokenDailyLimitOverride: number | null };
  },
  env?: Env,
): Promise<TenantTokenAvailability> {
  let effectivePlanEnum: TenantPlan;
  let tokenDailyLimitOverride: number | null;
  if (opts?.planSnapshot) {
    effectivePlanEnum = toTenantPlanEnum(opts.planSnapshot.effectivePlan);
    tokenDailyLimitOverride = opts.planSnapshot.tokenDailyLimitOverride;
  } else {
    const [row] = await db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    effectivePlanEnum = resolveEffectivePlan({
      plan: (row?.plan as TenantPlan) ?? TenantPlan.FREE,
      billingStatus: (row?.billingStatus ?? 'none') as TenantBillingStatus,
      trialEndsAt: row?.trialEndsAt ?? null,
    });
    tokenDailyLimitOverride = row?.tokenDailyLimitOverride ?? null;
  }
  const effectivePlan = planString(effectivePlanEnum);

  // Resolve the plan/override caps WITHOUT any superadmin lift first. A tenant that is
  // already unlimited by plan (Teams / -1 override) is done here — no superadmin
  // lookup and no usage scan.
  const planLimits = resolveTokenLimits({
    effectivePlan: effectivePlanEnum,
    tokenDailyLimitOverride,
    isSuperadmin: false,
  });
  if (planLimits.dailyLimit <= 0 && planLimits.monthlyLimit <= 0) {
    return { hasTokens: true, reason: null, dailyLimit: planLimits.dailyLimit, monthlyLimit: planLimits.monthlyLimit, usageToday: 0, usageMonth: 0, effectivePlan };
  }

  // The tenant IS capped by plan — but a superadmin OPERATOR is unlimited EVERYWHERE.
  // Superadmin is resolved from BOTH sources so the bypass holds on every path:
  //   (a) the acting user, when present (interactive Run-now / gateway), AND
  //   (b) the tenant's OWN active membership — so an account OWNED/operated by a
  //       superadmin is never frozen even on the cron sweeps, which call this with
  //       `db` only (no acting user). This is THE single place the "superadmin ⇒
  //       unlimited" rule lives; every caller (cron + interactive) inherits it.
  // `users.isSuperadmin` is the sole, revocation-safe source of truth (fresh per
  // call). Only consulted for a capped tenant, so unlimited tenants pay nothing.
  const isSuperadmin = await resolveSuperadminUnlimited(db, tenantId, opts, env);
  if (isSuperadmin) {
    const superLimits = resolveTokenLimits({
      effectivePlan: effectivePlanEnum,
      tokenDailyLimitOverride,
      isSuperadmin: true,
    });
    return { hasTokens: true, reason: null, dailyLimit: superLimits.dailyLimit, monthlyLimit: superLimits.monthlyLimit, usageToday: 0, usageMonth: 0, effectivePlan };
  }

  const { dailyLimit, monthlyLimit } = planLimits;
  const dailyCapped = dailyLimit > 0;
  const monthlyCapped = monthlyLimit > 0;

  const usage = await sumTenantTextTokensDayAndMonth(db, tenantId, utcDayStart(), utcMonthStart());

  const dailyExhausted = dailyCapped && usage.day >= dailyLimit;
  const monthlyExhausted = monthlyCapped && usage.month >= monthlyLimit;
  const reason: TokenExhaustionReason | null = dailyExhausted ? 'daily_exhausted' : monthlyExhausted ? 'monthly_exhausted' : null;

  return {
    hasTokens: reason === null,
    reason,
    dailyLimit,
    monthlyLimit,
    usageToday: usage.day,
    usageMonth: usage.month,
    effectivePlan,
  };
}

/**
 * THE "superadmin ⇒ unlimited" rule. A superadmin operator is never capped, and
 * that is resolved from THREE sources so the bypass holds on every path:
 *   (a) `actingIsSuperadmin` — a flag the caller already resolved (the gateway
 *       hands us `access.isSuperadmin`, so we skip a query);
 *   (b) `actingUserId` → `users.isSuperadmin` — the interactive principal, which
 *       covers a superadmin operating a tenant they are not a member of;
 *   (c) the tenant's OWN active superadmin membership — so an account owned by a
 *       superadmin is never frozen even on cron sweeps, which have no acting user.
 *
 * Exported because it is the SINGLE definition: the enforcement gate above and the
 * consumption METER both call it. They diverged once — the meter resolved only (c)
 * and showed a superadmin their plain free-plan caps against real usage while every
 * turn sailed through the gate — so any surface that answers "is this tenant
 * capped?" must come through here rather than re-deriving it.
 *
 * `users.isSuperadmin` is the sole, revocation-safe source of truth (fresh per
 * call); (c) is cached 5 min. Call this only for a plan-capped tenant so unlimited
 * tenants pay nothing.
 */
export async function resolveSuperadminUnlimited(
  db: Db,
  tenantId: number,
  opts?: { actingUserId?: string | null; actingIsSuperadmin?: boolean },
  env?: Env,
): Promise<boolean> {
  if (opts?.actingIsSuperadmin === true) return true;
  if (opts?.actingIsSuperadmin === undefined && opts?.actingUserId) {
    try {
      const [u] = await db
        .select({ isSuperadmin: users.isSuperadmin })
        .from(users)
        .where(eq(users.id, opts.actingUserId))
        .limit(1);
      if (u?.isSuperadmin === true) return true;
    } catch {
      /* fall through to the tenant-membership check */
    }
  }
  return tenantHasSuperadminMember(db, tenantId, env);
}

/**
 * Does this tenant have an ACTIVE member who is a platform superadmin? An account
 * OWNED/operated by a superadmin is unlimited everywhere (the operator is never
 * gated), so this grants the cron sweeps — which have no acting user — the SAME
 * bypass the interactive paths grant via `actingUserId`. Single indexed join on
 * `tenant_members(tenant_id)` → `users.is_superadmin`; only ever called for an
 * already-capped tenant (so it adds no cost to unlimited tenants and, when true,
 * short-circuits the heavier usage scan).
 *
 * The result is tenant-stable, so pass `env` to serve it through the read-through
 * cache (5-min TTL — the same freshness window the gateway's membership cache uses;
 * a superadmin grant/revoke is rare and tolerates that lag). Callers without `env`
 * (unit tests) get the raw query. Best-effort: false on any error so a lookup
 * failure falls back to the normal plan gate rather than accidentally granting bypass.
 */
export async function tenantHasSuperadminMember(db: Db, tenantId: number, env?: Env): Promise<boolean> {
  const compute = async (): Promise<boolean> => {
    try {
      const [row] = await db
        .select({ isSuperadmin: users.isSuperadmin })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.isActive, true),
          eq(users.isSuperadmin, true),
        ))
        .limit(1);
      return !!row;
    } catch {
      return false;
    }
  };
  if (!env) return compute();
  return getOrSetCached(env, `tenant:superadmin-member:${tenantId}`, compute, { kvTtlSeconds: 300 });
}

/** The 429 body an interactive run path returns when the tenant is out of tokens.
 *  Codes mirror the LLM gateway's `enforceTokenCaps` so a client that already
 *  handles the gateway's 429 handles these identically. */
export interface TokenGateBlock {
  error: string;
  code: 'plan_token_limit_exceeded' | 'plan_monthly_token_limit_exceeded';
  reason: TokenExhaustionReason;
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** Plan-tailored upgrade hint appended to a cap-exceeded message. THE single source
 *  of this copy — the LLM gateway's `enforceTokenCaps` imports it too, so every
 *  daily/monthly cap message reads identically. */
export function tokenGateUpgradeHint(effectivePlan: 'free' | 'pro' | 'teams', window: 'daily' | 'monthly'): string {
  if (effectivePlan === 'free') {
    return window === 'monthly'
      ? ' Upgrade to Pro at builderforce.ai/pricing for a higher monthly allowance.'
      : ' Upgrade to Pro at builderforce.ai/pricing.';
  }
  if (effectivePlan === 'pro') {
    return window === 'monthly'
      ? ' Upgrade to Teams for an unlimited monthly allowance.'
      : ' Upgrade to Teams for a 5× higher daily budget.';
  }
  return '';
}

/**
 * THE single token gate for the interactive run paths (Run-now, submit execution):
 * returns a 429 block when the tenant is out of budget, or null to proceed. Shared
 * so "no budget → no run" is defined once for every manual dispatch surface (and
 * matches the autonomous cron's gate + the gateway's spend gate). Fails OPEN on any
 * error — a transient usage-scan failure must not block a human clicking Run.
 *
 * Pass `opts.actingUserId` (the request's `userId`) so a superadmin operator is
 * never gated — the interactive surfaces always have one; the cron does not.
 */
export async function checkTenantTokenGate(
  db: Db,
  tenantId: number,
  opts?: { actingUserId?: string | null; actingIsSuperadmin?: boolean },
  env?: Env,
): Promise<TokenGateBlock | null> {
  let availability: TenantTokenAvailability;
  try {
    availability = await getTenantTokenAvailability(db, tenantId, opts, env);
  } catch {
    return null; // fail open
  }
  if (availability.hasTokens || !availability.reason) return null;

  const window = availability.reason === 'monthly_exhausted' ? 'monthly' : 'daily';
  const cap = window === 'monthly' ? availability.monthlyLimit : availability.dailyLimit;
  const base = window === 'monthly'
    ? `Plan monthly token allowance reached (${cap.toLocaleString()} tokens).`
    : `Plan daily token limit reached (${cap.toLocaleString()} tokens).`;
  return {
    error: `${base}${tokenGateUpgradeHint(availability.effectivePlan, window)}`,
    code: window === 'monthly' ? 'plan_monthly_token_limit_exceeded' : 'plan_token_limit_exceeded',
    reason: availability.reason,
    effectivePlan: availability.effectivePlan,
  };
}
