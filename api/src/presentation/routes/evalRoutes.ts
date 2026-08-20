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
import { authMiddleware } from '../middleware/authMiddleware';
import { evaluateResponse, type EvalJudge } from '../../application/eval/semanticEval';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { getTenantDriftReport } from '../../application/eval/driftReport';
import { evaluateVariant } from '../../application/eval/variantEval';
import { resolveTenantPlan } from './llmRoutes';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

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
    return c.json(await getTenantDriftReport(db, c.env as Env, tenantId));
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

// `buildTenantDriftReport` moved to `application/eval/driftReport.ts` on
// 2026-08-19. Two application modules imported it from this route file, which
// made a cron sweep depend on an HTTP module.
