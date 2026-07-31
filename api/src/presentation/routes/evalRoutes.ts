/**
 * Evaluation route — /api/eval
 *
 * The on-demand counterpart to the inline, zero-cost lexical eval that runs on
 * every cloud run (scoreRunOutcome). This surface scores an arbitrary
 * {question, context, answer} triple with the full RAG-eval rubric — faithfulness,
 * answer-relevance, context-relevance, hallucination-rate — so RAG pipelines and
 * CI can gate on answer quality, not just HTTP 200.
 *
 *   • POST /api/eval        — score one triple (LLM-as-judge, lexical fallback).
 *   • GET  /api/eval/drift  — per-(action_type, model) quality-drift report.
 *
 * The judge runs through the SAME metered gateway every other LLM call uses
 * (llmProxyForPlan), so a judge call is billed/capped like any completion — no
 * out-of-band model access.
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { evaluateResponse, type EvalJudge } from '../../application/eval/semanticEval';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { detectGroupDrift, type ScoredSample } from '../../application/eval/driftMonitor';
import { evaluateVariant } from '../../application/eval/variantEval';
import { resolveTenantPlan } from './llmRoutes';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

export function createEvalRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── POST /api/eval ──────────────────────────────────────────────────────
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question : '';
    const answer = typeof body?.answer === 'string' ? body.answer : '';
    const context = typeof body?.context === 'string' ? body.context : undefined;
    // Opt out of the judge for a pure, free, deterministic lexical score.
    const useJudge = body?.judge !== false;

    if (!question || !answer) {
      return c.json({ error: 'question and answer are required' }, 400);
    }

    let judge: EvalJudge | undefined;
    if (useJudge) {
      const plan = await resolveTenantPlan(c.env as Env, tenantId).catch(() => null);
      if (plan) judge = gatewayJudge(c.env as Env, plan.effectivePlan, plan.premiumOverride);
    }

    const scores = await evaluateResponse({ question, answer, context }, { judge });
    return c.json(scores);
  });

  // ── GET /api/eval/drift ─────────────────────────────────────────────────
  // Quality-drift report: per (action_type, model), compares an older baseline
  // window of eval scores to the recent window and flags regressions. Cached 5m
  // (a scan over the append-only outcomes ledger that needn't be to-the-second).
  router.get('/drift', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const report = await getOrSetCached(
      c.env as Env,
      `eval-drift:v1:${tenantId}`,
      () => buildTenantDriftReport(db, tenantId),
      { kvTtlSeconds: 300, l1TtlMs: 60_000 },
    );
    return c.json(report);
  });

  // ── GET /api/eval/variant-compare ─────────────────────────────────────────
  // Fine-tune-vs-base A/B: compares two models' outcome scores for an action
  // type and returns the comparison + the promote/hold decision. The gate the
  // Evermind auto-routing promotion needs. Cached on the outcomes version token.
  router.get('/variant-compare', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const baseModel = c.req.query('base');
    const candidateModel = c.req.query('candidate');
    if (!baseModel || !candidateModel) {
      return c.json({ error: 'base and candidate model query params are required' }, 400);
    }
    const actionType = c.req.query('actionType') || undefined;
    const windowDays = Number(c.req.query('windowDays')) || 60;
    const result = await evaluateVariant(c.env as Env, db, { tenantId, baseModel, candidateModel, actionType, windowDays });
    return c.json(result);
  });

  return router;
}

/** Loads recent eval-scored runs for a tenant and computes per-group drift. */
export async function buildTenantDriftReport(db: Db, tenantId: number) {
  // Last 60 days of eval-scored outcomes — enough for a baseline-vs-recent split.
  const sinceMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const rows = await db
    .select({
      actionType: runModelOutcomes.actionType,
      model: runModelOutcomes.resolvedModel,
      faithfulness: runModelOutcomes.faithfulness,
      answerRelevance: runModelOutcomes.answerRelevance,
      createdAt: runModelOutcomes.createdAt,
    })
    .from(runModelOutcomes)
    .where(
      and(
        eq(runModelOutcomes.tenantId, tenantId),
        isNotNull(runModelOutcomes.faithfulness),
        gte(runModelOutcomes.createdAt, new Date(sinceMs)),
      ),
    )
    .orderBy(desc(runModelOutcomes.createdAt))
    .limit(2000);

  // Drift the overall quality proxy (mean of faithfulness + answer-relevance).
  const samples: ScoredSample[] = rows.map((r) => ({
    group: `${r.actionType}:${r.model}`,
    score: ((r.faithfulness ?? 0) + (r.answerRelevance ?? 0)) / 2,
    ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(new Date(r.createdAt as never)),
  }));

  const groups = detectGroupDrift(samples, { minSamples: 8 });
  return {
    generatedAt: new Date().toISOString(),
    totalScored: rows.length,
    drifting: groups.filter((g) => g.result.drifted),
    groups,
  };
}
