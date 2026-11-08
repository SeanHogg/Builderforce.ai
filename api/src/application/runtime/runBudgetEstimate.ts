/**
 * Pre-dispatch budget estimate (PRD 09 B3).
 *
 * `checkTenantTokenGate` refuses a tenant whose allowance is EXHAUSTED. This refuses
 * the one just short of it: a tenant with 40 tokens left would be handed a run that is
 * certain to die on its first model call, after an execution row, a lane transition
 * and a container were spent on it. The same refusal, one step earlier and explainable.
 *
 * The estimate reuses the existing pieces and adds no accounting of its own:
 *   - remaining allowance  = `getTenantTokenAvailability` (daily / monthly caps, credits,
 *     the superadmin bypass: an unlimited tenant has no capped window and always passes);
 *   - minimum viable spend = the smaller of {@link MIN_VIABLE_RUN_TOKENS} and the plan's
 *     per-run token cap (`resolveRunTokenCap`), so a plan whose whole run is smaller than
 *     the floor is never held to more than a run can spend.
 * Fails OPEN on any error: a usage-scan hiccup must not block a human clicking Run.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveRunTokenCap } from '../../domain/containment/runLimits';
import { getTenantTokenAvailability, type TenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Fewest tokens in which an agent run can plausibly plan, act and report. */
export const MIN_VIABLE_RUN_TOKENS = 5_000;

export interface InsufficientRunBudget {
  error: string;
  code: 'insufficient_run_budget';
  remainingTokens: number;
  minimumTokens: number;
  window: 'daily' | 'monthly';
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** The tokens left in the TIGHTEST capped window, and which window that is; null = uncapped. */
export function remainingAllowance(a: TenantTokenAvailability): { tokens: number; window: 'daily' | 'monthly' } | null {
  const windows: Array<{ tokens: number; window: 'daily' | 'monthly' }> = [];
  if (a.dailyLimit > 0) windows.push({ tokens: a.dailyLimit - a.usageToday, window: 'daily' });
  if (a.monthlyLimit > 0) windows.push({ tokens: a.monthlyLimit - a.usageMonth, window: 'monthly' });
  if (windows.length === 0) return null;
  return windows.reduce((tight, w) => (w.tokens < tight.tokens ? w : tight));
}

/** Pure decision, split out so the threshold is testable without a database. */
export function evaluateRunBudget(a: TenantTokenAvailability): InsufficientRunBudget | null {
  const remaining = remainingAllowance(a);
  if (!remaining) return null;
  const minimumTokens = Math.min(MIN_VIABLE_RUN_TOKENS, resolveRunTokenCap(a.effectivePlan));
  if (remaining.tokens >= minimumTokens) return null;
  const left = Math.max(0, remaining.tokens);
  return {
    error: `Only ${left.toLocaleString()} tokens remain in your ${remaining.window} allowance, below the ${minimumTokens.toLocaleString()} a run needs to do useful work. `
      + 'Wait for the allowance to reset, upgrade your plan, or connect your own model key.',
    code: 'insufficient_run_budget',
    remainingTokens: left,
    minimumTokens,
    window: remaining.window,
    effectivePlan: a.effectivePlan,
  };
}

export async function checkRunBudgetViable(
  db: Db,
  tenantId: number,
  opts: { actingUserId?: string | null },
  env?: Env,
): Promise<InsufficientRunBudget | null> {
  try {
    return evaluateRunBudget(await getTenantTokenAvailability(db, tenantId, opts, env));
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/runBudgetEstimate.ts', operation: 'checkRunBudgetViable' });
    return null;
  }
}
