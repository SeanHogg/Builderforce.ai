/**
 * Run the workspace's benchmark set and record the scores.
 *
 * Answers come from the metered gateway with the tenant's own plan applied, so a
 * benchmark pass costs what any other completion costs and is capped the same way.
 * That is deliberate: an evaluation harness with its own out-of-band model access
 * would be an unbilled, uncapped path to a model, which is the exact hole the
 * gateway exists to close.
 *
 * Bounded per pass and per tenant. A benchmark that ran every case for every
 * workspace on every tick would spend more than the work it measures.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentBenchmarkCases } from '../../infrastructure/database/schema';
import { llmProxyForPlan, readProxyChoice } from '../llm/LlmProxyService';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { gatewayJudge } from './gatewayJudge';
import { listCases, recordAttempt, scoreAnswer, type BenchmarkCase } from './agentBenchmark';
import type { Env } from '../../env';

/** Cases attempted per tenant per pass. The set is meant to be small and stable. */
export const CASES_PER_PASS = 10;

export interface BenchmarkSweepResult {
  tenants: number;
  attempts: number;
}

/** Ask the model one case's prompt and return its answer plus how long it took. */
async function answerCase(
  env: Env,
  plan: { effectivePlan: 'free' | 'pro' | 'teams'; premiumOverride: boolean },
  benchmarkCase: BenchmarkCase,
): Promise<{ answer: string; durationMs: number; model: string | null }> {
  const started = Date.now();
  const service = llmProxyForPlan(env, plan.effectivePlan, plan.premiumOverride);
  const result = await service.complete({
    messages: [{ role: 'user', content: benchmarkCase.prompt }],
    // Deterministic, so a score change means the model changed rather than the dice.
    temperature: 0,
    max_tokens: 800,
  } as never);
  const choice = await readProxyChoice(result);
  return { answer: choice.content, durationMs: Date.now() - started, model: result.resolvedModel ?? null };
}

/** Run one tenant's enabled cases and persist each attempt. Never throws. */
export async function runTenantBenchmark(env: Env, db: Db, tenantId: number): Promise<number> {
  try {
    const cases = (await listCases(db, tenantId, true)).slice(0, CASES_PER_PASS);
    if (cases.length === 0) return 0;
    const plan = await resolveTenantPlan(env, tenantId).catch(() => null);
    if (!plan) return 0;
    const judge = gatewayJudge(env, plan.effectivePlan, plan.premiumOverride);

    let attempts = 0;
    for (const benchmarkCase of cases) {
      try {
        const { answer, durationMs, model } = await answerCase(env, plan, benchmarkCase);
        const scored = await scoreAnswer(benchmarkCase, answer, { judge });
        await recordAttempt(db, tenantId, {
          caseId: benchmarkCase.id,
          answer,
          durationMs,
          model,
          ...scored,
        });
        attempts += 1;
      } catch (error) {
        // One failed case must not abandon the set — a partial pass is still a
        // comparable series for the cases that did run.
        reportCaughtError(error, {
          source: 'application/eval/agentBenchmarkSweep.ts',
          operation: 'runTenantBenchmark',
          level: 'warning',
          context: { details: { tenantId, caseSlug: benchmarkCase.slug } },
        });
      }
    }
    return attempts;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/eval/agentBenchmarkSweep.ts',
      operation: 'runTenantBenchmark',
      level: 'warning',
      context: { details: { tenantId } },
    });
    return 0;
  }
}

/**
 * The scheduled pass: every workspace that HAS a benchmark set gets one run, and
 * only those — a workspace opts in by authoring a case, so the sweep spends nothing
 * on the ones that have not.
 */
export async function runAgentBenchmarkSweep(env: Env, db: Db): Promise<BenchmarkSweepResult> {
  // Every workspace that HAS authored a case; the join is what keeps the sweep free
  // for the ones that have not opted in.
  const rows = await db
    .selectDistinct({ id: agentBenchmarkCases.tenantId })
    .from(agentBenchmarkCases)
    .where(eq(agentBenchmarkCases.enabled, true))
    .limit(500);
  let attempts = 0;
  let ran = 0;
  for (const row of rows) {
    const n = await runTenantBenchmark(env, db, row.id);
    if (n > 0) {
      ran += 1;
      attempts += n;
    }
  }
  return { tenants: ran, attempts };
}
