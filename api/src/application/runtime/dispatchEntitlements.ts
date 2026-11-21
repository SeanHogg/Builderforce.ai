/**
 * MK-09-E6 / MK-09-B1 — pre-flight refusals that are billing entitlements, not
 * backpressure. A human click cannot override them (see `ENTITLEMENT_REFUSALS`).
 *
 * E6: an unentitled premium model is refused before the run starts.
 * B1: a cloud agent's own spend ceiling is independent of the tenant plan and the per-run cap.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { siblingDatabase } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { isPremiumModelSelection } from '../llm/proxyPlanRouting';
import { resolveCloudRouting } from './cloudAgent/routing';
import { parseModel } from './cloudDispatch';

export const MODEL_NOT_ENTITLED = 'model_not_entitled' as const;
export const AGENT_BUDGET_EXHAUSTED = 'agent_budget_exhausted' as const;

/** $200 in `llm_usage_log.cost_usd_millicents` (USD × 100_000). Override with CLOUD_AGENT_BUDGET_MILLICENTS. */
export const DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS = 20_000_000;

export function agentBudgetCeiling(env: object): number {
  const raw = (env as { CLOUD_AGENT_BUDGET_MILLICENTS?: string }).CLOUD_AGENT_BUDGET_MILLICENTS;
  if (raw == null || raw === '') return DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS;
}

export function modelEntitlementRefusal(input: {
  model: string | null | undefined;
  isPremium: boolean;
  premiumEntitled: boolean;
}): { reason: typeof MODEL_NOT_ENTITLED; message: string } | null {
  if (!input.model || !input.isPremium || input.premiumEntitled) return null;
  return {
    reason: MODEL_NOT_ENTITLED,
    message: `Model "${input.model}" is not entitled for this workspace. Add billing details and a validated card, or pick a plan model.`,
  };
}

export function agentBudgetRefusal(
  spentMillicents: number,
  ceilingMillicents: number,
): { reason: typeof AGENT_BUDGET_EXHAUSTED; message: string } | null {
  if (!(ceilingMillicents > 0) || spentMillicents < ceilingMillicents) return null;
  return {
    reason: AGENT_BUDGET_EXHAUSTED,
    message: `Cloud agent budget ceiling spent (${spentMillicents}/${ceilingMillicents} millicents). This ceiling is per agent, not the tenant plan or the per-run cap.`,
  };
}

/** null when the spend table cannot be read — metering fails open, same as the cloud-run cap. */
export async function cloudAgentSpentMillicents(
  env: Env,
  db: Db,
  tenantId: number,
  cloudAgentRef: string,
): Promise<number | null> {
  try {
    const op = siblingDatabase(env, db, 'operational');
    const [row] = await op
      .select({ spent: sql<number>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)` })
      .from(llmUsageLog)
      .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.cloudAgentRef, cloudAgentRef)))
      .limit(1);
    const n = Number(row?.spent ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}

export async function preflightDispatchEntitlements(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    submittedBy?: string | null;
    payload?: string | null;
    cloudAgentRef?: string | null;
  },
): Promise<{ reason: typeof MODEL_NOT_ENTITLED | typeof AGENT_BUDGET_EXHAUSTED; message: string } | null> {
  const model = parseModel(args.payload ?? undefined);
  if (model) {
    const routing = await resolveCloudRouting(env, args.tenantId, args.submittedBy);
    const refusal = modelEntitlementRefusal({
      model,
      isPremium: isPremiumModelSelection(model, routing.effectivePlan, routing.premiumOverride),
      premiumEntitled: routing.premiumEntitled,
    });
    if (refusal) return refusal;
  }
  if (args.cloudAgentRef) {
    const spent = await cloudAgentSpentMillicents(env, db, args.tenantId, args.cloudAgentRef);
    if (spent != null) {
      const refusal = agentBudgetRefusal(spent, agentBudgetCeiling(env));
      if (refusal) return refusal;
    }
  }
  return null;
}
