/**
 * Cost forecast routes — /api/cost-forecast
 *
 * Estimates token usage and cost before an execution starts.
 * Called from the CoderClaw portal "Run" confirmation dialog and the TUI before
 * dispatching a workflow, so users know the expected budget impact before committing.
 *
 * POST /api/cost-forecast
 *   Accepts: context strings (task title, description, system prompt, file snippets, etc.)
 *   Returns: estimated tokens, estimated cost, daily budget remaining, plan recommendation.
 */

import { Hono } from 'hono';
import { and, eq, gte, sum } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { llmUsageLog, tenants } from '../../infrastructure/database/schema';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

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
    case TenantPlan.FREE:  return FREE_MODEL_COST_PER_1M / 1_000_000;
    case TenantPlan.PRO:   return PRO_BLENDED_COST_PER_1M / 1_000_000;
    case TenantPlan.TEAMS: return TEAMS_BLENDED_COST_PER_1M / 1_000_000;
    default:               return FREE_MODEL_COST_PER_1M / 1_000_000;
  }
}

/**
 * Estimate token count from text using the "4 chars per token" rule of thumb.
 * Accurate to within ~15% for typical English/code content.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
    const body = await c.req.json<{
      context: string[];
      workflowSteps?: number;
    }>();

    if (!Array.isArray(body.context) || body.context.length === 0) {
      return c.json({ error: 'context array is required' }, 400);
    }

    const steps = Math.max(1, Math.min(body.workflowSteps ?? 1, 20));
    const fullContext = body.context.join('\n\n');

    // Estimate tokens
    const promptTokens = estimateTokens(fullContext);
    const completionTokens = estimateCompletionTokens(promptTokens);
    const totalTokensPerStep = promptTokens + completionTokens;
    const totalTokens = totalTokensPerStep * steps;

    // Fetch tenant plan
    const [tenantRow] = await db
      .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const rawPlan = (tenantRow?.plan ?? 'free') as TenantPlan;
    const billingStatus = tenantRow?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan =
      billingStatus === 'active' ? rawPlan : TenantPlan.FREE;

    const limits = getLimits(effectivePlan);

    // Fetch today's token usage for this tenant
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [usageRow] = await db
      .select({ used: sum(llmUsageLog.totalTokens) })
      .from(llmUsageLog)
      .where(
        and(
          eq(llmUsageLog.tenantId, tenantId),
          gte(llmUsageLog.createdAt, todayStart),
        ),
      );

    const tokensUsedToday = Number(usageRow?.used ?? 0);
    const dailyLimit = limits.tokenDailyLimit;
    const remainingBudget = Math.max(0, dailyLimit - tokensUsedToday);
    const fitsInBudget = totalTokens <= remainingBudget;

    // Estimate cost
    const costPerToken = estimateCostPerToken(effectivePlan);
    const estimatedCostUsd = parseFloat((totalTokens * costPerToken).toFixed(6));

    // Advice
    let advice: string | null = null;
    if (!fitsInBudget && effectivePlan === TenantPlan.FREE) {
      advice = `This request (~${totalTokens.toLocaleString()} tokens) exceeds your free daily budget (${remainingBudget.toLocaleString()} remaining). Upgrade to Pro for a 1M token/day limit.`;
    } else if (!fitsInBudget) {
      advice = `This request (~${totalTokens.toLocaleString()} tokens) exceeds your remaining daily budget (${remainingBudget.toLocaleString()} tokens). It will be rejected. Upgrade to Teams for a 5M token/day limit.`;
    } else if (remainingBudget - totalTokens < totalTokens) {
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
