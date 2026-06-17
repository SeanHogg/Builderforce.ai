/**
 * Persona routes — /api/personas/*
 *
 * Serves the psychometric-persona catalog and scoring used by the Pro persona
 * editor (sliders / questionnaire / import). The catalog is a static in-memory
 * constant (no DB round-trip, so no cache needed); scoring + import are pure
 * functions. The behavioural compile happens later, in agent-runtime.
 *
 * Pro gate: scoring and import require a paid plan — equivalent to
 * PlanLimits.psychometricPersona (false only on FREE). Mirrors the
 * `premiumOverride || effectivePlan !== 'free'` convention used in llmRoutes.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveTenantPlan } from './llmRoutes';
import {
  PSYCHOMETRIC_CATALOG,
  PSYCHOMETRIC_QUESTIONS,
  ENNEAGRAM_TYPES,
  scoreQuestionnaire,
  sanitizeVector,
} from '../../application/persona/psychometricCatalog';
import type { HonoEnv } from '../../env';

export function createPersonaRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** True when the tenant's plan includes the psychometric-persona Pro feature. */
  async function tenantHasPsychometric(env: HonoEnv['Bindings'], tenantId: number): Promise<boolean> {
    const access = await resolveTenantPlan(env, tenantId);
    return access.premiumOverride || access.effectivePlan !== 'free';
  }

  // -------------------------------------------------------------------------
  // GET /api/personas/psychometric/catalog
  // The full framework suite + questionnaire bank. Static constant — every
  // authenticated user may read it (so the editor can render the locked state).
  // -------------------------------------------------------------------------
  router.get('/psychometric/catalog', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const entitled = await tenantHasPsychometric(c.env, tenantId);
    return c.json({
      entitled,
      frameworks: PSYCHOMETRIC_CATALOG,
      questions: PSYCHOMETRIC_QUESTIONS,
      enneagram: ENNEAGRAM_TYPES,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/personas/psychometric/score   (Pro)
  // Body: { answers: { [questionId]: 1..5 } } -> { vector }
  // -------------------------------------------------------------------------
  router.post('/psychometric/score', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    if (!(await tenantHasPsychometric(c.env, tenantId))) {
      return c.json({ error: 'Psychometric personas require a Pro plan.', upgrade: true }, 403);
    }
    const body = await c.req
      .json<{ answers?: Record<string, number> }>()
      .catch(() => ({ answers: {} as Record<string, number> }));
    const vector = scoreQuestionnaire(body.answers ?? {});
    return c.json({ vector, source: 'questionnaire' });
  });

  // -------------------------------------------------------------------------
  // POST /api/personas/psychometric/import   (Pro)
  // Body: { vector: Record<string, number> } (e.g. a human's test results)
  // -> sanitised vector (unknown dimensions dropped, values clamped 0..100)
  // -------------------------------------------------------------------------
  router.post('/psychometric/import', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    if (!(await tenantHasPsychometric(c.env, tenantId))) {
      return c.json({ error: 'Psychometric personas require a Pro plan.', upgrade: true }, 403);
    }
    const body = await c.req.json<{ vector?: unknown }>().catch(() => ({ vector: undefined }));
    const vector = sanitizeVector(body.vector);
    return c.json({ vector, source: 'imported' });
  });

  return router;
}
