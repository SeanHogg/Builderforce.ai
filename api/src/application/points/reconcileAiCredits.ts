/**
 * THE SWEEP THAT MAKES REDEEMED CREDITS DEPLETE.
 *
 * ── WHY THIS IS NOT OPTIONAL ─────────────────────────────────────────────────
 * `aiCredits.ts` grants credits and the token gate honours them by lifting both
 * caps. Nothing in that loop ever takes a credit AWAY. Without this sweep the
 * balance is permanent, the lift is permanent, and five hundred earned points buy
 * unlimited inference forever — the failure would be silent and would look like
 * the feature working.
 *
 * So: once a month has ENDED, whatever of its overage the credits covered is
 * debited. Current months are never settled — their usage is still growing, and
 * debiting mid-month would lower a tenant's ceiling underneath them.
 *
 * ── WHY IT SETTLES EVERY UNSETTLED MONTH, NOT JUST LAST ONE ──────────────────
 * A sweep that only ever looks at the previous month forgives every month it
 * missed. Cron is not a guarantee — a Worker outage, a disabled sweep, a deploy
 * gap — so the work list is "months since this tenant's first grant that carry no
 * reconcile row", and the per-month reference makes re-running it a no-op.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Only tenants that have ever been granted credits. Almost none have, so the
 * sweep's cost is proportional to the feature's use rather than to the size of
 * the platform — the same rule every other sweep on a Neon Free budget follows.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries, tenants } from '../../infrastructure/database/schema';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveTokenLimits } from '../../domain/tenant/PlanLimits';
import { AI_CREDITS } from '../kernel/denominations';
import { sumTenantTextTokensDayAndMonth } from '../llm/tokenUsage';
import { aiCreditReconcileReference, reconcileAiCreditMonth, unsettledMonthsSince } from './aiCredits';
import { acrossTenants } from '../../infrastructure/database/tenantScope';

export interface CreditReconcileResult {
  tenantsChecked: number;
  monthsSettled: number;
  tokensDebited: number;
}

/** The credit-account predicate WITHOUT a tenant: the sweep's reads are grouped
 *  over every tenant at once and declared as such. */
function creditLedger() {
  return and(
    eq(ledgerEntries.accountKind, 'tenant'),
    eq(ledgerEntries.denomination, AI_CREDITS),
  );
}

/** Every tenant holding a credit grant, with when its first grant landed — the
 *  sweep's entire universe in ONE grouped read (it was a DISTINCT followed by a
 *  per-tenant `min()`). */
async function firstGrantByTenant(db: Db): Promise<Map<number, string>> {
  const rows = await db
    .select({ tenantId: ledgerEntries.tenantId, firstAt: sql<string>`min(${ledgerEntries.occurredAt})` })
    .from(ledgerEntries)
    .where(acrossTenants(ledgerEntries, 'scheduled_sweep', creditLedger(), eq(ledgerEntries.entryKind, 'grant')))
    .groupBy(ledgerEntries.tenantId);
  return new Map(rows.map((row) => [row.tenantId, row.firstAt]));
}

/** Every month already settled, platform-wide. The reconcile reference embeds the
 *  tenant id, so one Set answers "is (tenant, month) done" for every tenant. */
async function settledReferences(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ reference: ledgerEntries.reference })
    .from(ledgerEntries)
    .where(acrossTenants(ledgerEntries, 'scheduled_sweep', creditLedger(), eq(ledgerEntries.entryKind, 'spend')));
  return new Set(rows.map((row) => row.reference ?? ''));
}

export async function runAiCreditReconcileSweep(db: Db, env: Env): Promise<CreditReconcileResult> {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const result: CreditReconcileResult = { tenantsChecked: 0, monthsSettled: 0, tokensDebited: 0 };

  // Three reads for the whole platform, then work only where a month is owed.
  const [firstGrants, settled] = await Promise.all([firstGrantByTenant(db), settledReferences(db)]);
  result.tenantsChecked = firstGrants.size;

  const owed = new Map<number, string[]>();
  for (const [tenantId, firstAt] of firstGrants) {
    const months = unsettledMonthsSince(firstAt, thisMonth)
      .filter((key) => !settled.has(aiCreditReconcileReference(tenantId, key)));
    if (months.length) owed.set(tenantId, months);
  }
  if (owed.size === 0) return result;

  const planRows = await db
    .select({
      id: tenants.id,
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
      tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
    })
    .from(tenants)
    // `tenants` is the root of tenancy, not a tenant-owned table — the id list IS the scope.
    .where(inArray(tenants.id, [...owed.keys()]));
  const planById = new Map(planRows.map((row) => [row.id, row]));

  for (const [tenantId, months] of owed) {
    const row = planById.get(tenantId);
    if (!row) continue;

    // The PLAN limit, with no credit lift — the ceiling the overage is measured
    // against. Passing `bonusTokens` here would compare usage to a ceiling that
    // already includes the credits and find no overage at all, which is the one
    // mistake that would make this sweep quietly do nothing.
    const { monthlyLimit } = resolveTokenLimits({
      effectivePlan: resolveEffectivePlan({
        plan: (row.plan as TenantPlan) ?? TenantPlan.FREE,
        billingStatus: (row.billingStatus ?? 'none') as TenantBillingStatus,
        trialEndsAt: row.trialEndsAt ?? null,
      }),
      tokenDailyLimitOverride: row.tokenDailyLimitOverride ?? null,
      isSuperadmin: false,
    });

    for (const monthKey of months) {
      const monthUsage = await monthlyTokenUsage(db, tenantId, monthKey);
      const debited = await reconcileAiCreditMonth(db, env, {
        tenantId, monthKey, monthUsage, planMonthlyLimit: monthlyLimit,
      });
      if (debited > 0) {
        result.monthsSettled += 1;
        result.tokensDebited += debited;
      }
    }
  }

  return result;
}

/** Text tokens a tenant spent inside one calendar month. Reuses the accountant
 *  the gate and the meter already share, so the number the sweep settles against
 *  is the number the gate enforced. */
async function monthlyTokenUsage(db: Db, tenantId: number, monthKey: string): Promise<number> {
  const start = new Date(`${monthKey}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const usage = await sumTenantTextTokensDayAndMonth(db, tenantId, end, start, end);
  return usage.month;
}

/** Exported for the sweep registration's log line. */
export function describeCreditReconcile(result: CreditReconcileResult): string | null {
  if (result.monthsSettled === 0) return null;
  return `tenants=${result.tenantsChecked} months=${result.monthsSettled} tokens=${result.tokensDebited}`;
}
