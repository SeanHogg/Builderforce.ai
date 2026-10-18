/**
 * Cost forecast routes — /api/cost-forecast
 *
 * Estimates token usage and cost before an execution starts.
 * Called from the BuilderForce Agents portal "Run" confirmation dialog and the TUI before
 * dispatching a workflow, so users know the expected budget impact before committing.
 *
 * POST /api/cost-forecast
 *   Accepts: context strings (task title, description, system prompt, file snippets, etc.)
 *   Returns: estimated tokens, estimated cost, daily budget remaining, plan recommendation.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { effectivePlanOf, loadTenantPlanRow } from '../../application/tenant/tenantPlanSnapshot';
import { TenantPlan } from '../../domain/shared/types';
import { perMillionToPerToken } from '@builderforce/model-catalog';
import { estimateTokensFromText, sumTenantTextTokens, utcDayStart } from '../../application/llm/tokenUsage';
import { resolveTenantTokenLimits } from '../../application/llm/tenantTokenAvailability';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { parseBody, z } from './requestBody';

/** The handler answers its own "context array is required" and clamps the steps. */
const CostForecastBody = z.object({
  context: z.array(z.string()).optional(),
  workflowSteps: z.number().nullish(),
});

// ---------------------------------------------------------------------------
// Model cost estimates ($ per 1M tokens, blended prompt+completion)
// These are conservative estimates for planning purposes, not billing.
// Free models cost $0; paid models use approximate public pricing.
// ---------------------------------------------------------------------------

const FREE_MODEL_COST_PER_1M = 0;           // free tier
const PRO_BLENDED_COST_PER_1M = 0.40;       // blended free+paid fallback (Claude/GPT-4o weighted)
const TEAMS_BLENDED_COST_PER_1M = 0.40;     // same as Pro

function estimateCostPerToken(plan: TenantPlan): number {
  switch (plan) {
    case TenantPlan.FREE:  return perMillionToPerToken(FREE_MODEL_COST_PER_1M);
    case TenantPlan.PRO:   return perMillionToPerToken(PRO_BLENDED_COST_PER_1M);
    case TenantPlan.TEAMS: return perMillionToPerToken(TEAMS_BLENDED_COST_PER_1M);
    default:               return perMillionToPerToken(FREE_MODEL_COST_PER_1M);
  }
}

/**
 * Estimate completion tokens for a coding task.
 * Coding tasks generate roughly 0.8x the input tokens (condensed output).
 */
function estimateCompletionTokens(promptTokens: number): number {
  return Math.ceil(promptTokens * 0.8);
}

export function createCostForecastRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * POST /api/cost-forecast
   *
   * Body: {
   *   context: string[]   // array of text blocks (task description, file snippets, system prompt, etc.)
   *   workflowSteps?: number  // number of parallel agent steps (default: 1)
   * }
   *
   * Returns: token estimate, cost estimate, daily budget status, plan advice.
   */
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CostForecastBody);

    if (!Array.isArray(body.context) || body.context.length === 0) {
      return c.json({ error: 'context array is required' }, 400);
    }

    const steps = Math.max(1, Math.min(body.workflowSteps ?? 1, 20));
    const fullContext = body.context.join('\n\n');

    // Estimate tokens
    const promptTokens = estimateTokensFromText(fullContext);
    const completionTokens = estimateCompletionTokens(promptTokens);
    const totalTokensPerStep = promptTokens + completionTokens;
    const totalTokens = totalTokensPerStep * steps;

    // Tenant plan — the cached snapshot, one shared resolver
    const tenantRow = await loadTenantPlanRow(c.env, tenantId, db);
    const billingStatus = tenantRow?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan = effectivePlanOf(tenantRow);

    // The daily cap the gateway ENFORCES — override, credits and the superadmin
    // bypass applied (getLimits(plan) alone ignores all three). -1 = unlimited.
    const { dailyLimit } = await resolveTenantTokenLimits(db, tenantId, { actingUserId: c.get('userId') ?? null }, c.env as Env);
    const unlimited = dailyLimit <= 0;

    // Today's usage from THE plan-allowance counter — the same cache-weighted,
    // billable-only sum the gateway's daily gate enforces — so "fits in budget" /
    // "will be rejected" predicts the gate instead of a raw token total that counts
    // rows (images, own-machine BYO) the gate exempts.
    const tokensUsedToday = await sumTenantTextTokens(db, tenantId, utcDayStart());
    // -1 mirrors the limit's own "unlimited" sentinel.
    const remainingBudget = unlimited ? -1 : Math.max(0, dailyLimit - tokensUsedToday);
    const fitsInBudget = unlimited || totalTokens <= remainingBudget;

    // Estimate cost
    const costPerToken = estimateCostPerToken(effectivePlan);
    const estimatedCostUsd = parseFloat((totalTokens * costPerToken).toFixed(6));

    // Advice
    let advice: string | null = null;
    if (!fitsInBudget && effectivePlan === TenantPlan.FREE) {
      advice = `This request (~${totalTokens.toLocaleString()} tokens) exceeds your free daily budget (${remainingBudget.toLocaleString()} remaining). Upgrade to Pro for a 1M token/day limit.`;
    } else if (!fitsInBudget) {
      advice = `This request (~${totalTokens.toLocaleString()} tokens) exceeds your remaining daily budget (${remainingBudget.toLocaleString()} tokens). It will be rejected. Upgrade to Teams for a 5M token/day limit.`;
    } else if (!unlimited && remainingBudget - totalTokens < totalTokens) {
      advice = `You have ${remainingBudget.toLocaleString()} tokens remaining today. This request will use about ${Math.round((totalTokens / remainingBudget) * 100)}% of your remaining budget.`;
    }

    return c.json({
      estimate: {
        promptTokens,
        completionTokens,
        totalTokensPerStep,
        workflowSteps: steps,
        totalTokens,
        estimatedCostUsd,
        currency: 'USD',
      },
      budget: {
        dailyLimit,
        unlimited,
        tokensUsedToday,
        remainingBudget,
        fitsInBudget,
      },
      plan: {
        effective: effectivePlan,
        billingStatus,
      },
      advice,
    });
  });

  return router;
}
