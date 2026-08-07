/**
 * `/api/challenges` — paste a brief, get a working system.
 *
 *   POST   /api/challenges            { brief, projectId? } → parse + plan (nothing built)
 *   GET    /api/challenges                                  → the tenant's challenges
 *   GET    /api/challenges/blueprints                       → the blueprint catalog
 *   GET    /api/challenges/:id                              → spec + plan + readiness
 *   POST   /api/challenges/:id/replan                       → re-read the brief
 *   POST   /api/challenges/:id/build                        → materialise it
 *   DELETE /api/challenges/:id
 *
 * Parse/plan and BUILD are separate calls on purpose. Planning is a model reading
 * a brief, and that reading is exactly what a human should check before a project,
 * thirty files and a board of tickets exist. Build is the explicit second act.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import { gatewayExtractor } from '../../application/llm/gatewayExtractor';
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
  setChallengeStatus,
  toChallengeView,
  updateChallengePlan,
} from '../../application/challenge/challengeStore';
import { parseBrief, type ChallengeSpec } from '../../application/challenge/parseBrief';
import { planChallenge, type ChallengePlan } from '../../application/challenge/planChallenge';
import { materializeChallenge } from '../../application/challenge/materializeChallenge';
import { BLUEPRINTS } from '../../application/challenge/blueprints';
import { HOSTING_STRATEGIES } from '../../application/backend';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/** Briefs longer than this are truncated at extraction; reject beyond it outright. */
const MAX_BRIEF_CHARS = 60_000;

/** Read + plan one brief. Shared by create and replan so the two cannot drift. */
async function readAndPlan(env: Env, brief: string): Promise<{ spec: ChallengeSpec; plan: ChallengePlan }> {
  const llm = gatewayExtractor(env, { useCase: 'challenge_brief', maxTokens: 1_200 });
  const spec = await parseBrief(brief, llm);
  const plan = await planChallenge(
    spec,
    brief,
    gatewayExtractor(env, { useCase: 'challenge_design', maxTokens: 3_000 }),
  );
  return { spec, plan };
}

export function createChallengeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * The catalog. Declared BEFORE `/:id` — Hono matches in registration order, and
   * a later literal route loses to an earlier parameterised one.
   */
  router.get('/blueprints', (c) =>
    c.json({
      blueprints: BLUEPRINTS.map((b) => ({
        key: b.key,
        name: b.name,
        summary: b.summary,
        capabilities: b.capabilities,
        strategy: b.strategy,
        requiredConnectors: b.requiredConnectors,
        requiredSecrets: b.requiredSecrets,
        handlerCount: Object.keys(b.handlers).length,
        successCriteria: b.successCriteria,
      })),
      strategies: HOSTING_STRATEGIES.map((s) => ({
        key: s.key,
        label: s.label,
        summary: s.summary,
        zeroSetup: s.zeroSetup,
      })),
    }),
  );

  router.get('/', async (c) =>
    c.json({ challenges: await listChallenges(db, c.get('tenantId') as number) }));

  router.post('/', async (c) => {
    const body = await c.req.json<{ brief?: unknown; projectId?: unknown }>().catch(() => ({}) as never);
    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    if (!brief) return c.json({ error: 'brief is required' }, 400);
    if (brief.length > MAX_BRIEF_CHARS) {
      return c.json({ error: `brief exceeds ${MAX_BRIEF_CHARS} characters` }, 400);
    }

    const tenantId = c.get('tenantId') as number;
    let spec: ChallengeSpec;
    let plan: ChallengePlan;
    try {
      ({ spec, plan } = await readAndPlan(c.env as Env, brief));
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/challengeRoutes.ts', operation: 'create' });
      return c.json({ error: error instanceof Error ? error.message : 'Could not read the brief' }, 502);
    }

    const row = await createChallenge(db, {
      tenantId,
      projectId: typeof body.projectId === 'number' ? body.projectId : null,
      brief,
      spec,
      plan,
      userId: (c.get('userId') as string) ?? null,
    });
    return c.json({ challenge: toChallengeView(row) }, 201);
  });

  router.get('/:id', async (c) => {
    const row = await getChallenge(db, c.get('tenantId') as number, c.req.param('id'));
    if (!row) return c.json({ error: 'Challenge not found' }, 404);
    return c.json({ challenge: toChallengeView(row) });
  });

  /** Re-read the same brief. Useful after connecting an integration the first
   *  pass could not see, or simply when the first reading was wrong. */
  router.post('/:id/replan', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const row = await getChallenge(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Challenge not found' }, 404);

    try {
      const { spec, plan } = await readAndPlan(c.env as Env, row.brief);
      const updated = await updateChallengePlan(db, tenantId, row.id, {
        spec,
        plan,
        // A rebuilt plan for an already-built challenge stays 'built': the project
        // still exists, and downgrading the status would make the UI offer to
        // create a second one.
        status: row.status === 'built' ? 'built' : 'planned',
      });
      if (!updated) return c.json({ error: 'Challenge not found' }, 404);
      return c.json({ challenge: toChallengeView(updated) });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/challengeRoutes.ts', operation: 'replan' });
      return c.json({ error: error instanceof Error ? error.message : 'Could not re-read the brief' }, 502);
    }
  });

  /**
   * Build it. Idempotent — rebuilding overwrites files and handlers and skips
   * tickets that already exist, so a customer can iterate on the plan and press
   * Build repeatedly without accumulating duplicates.
   */
  router.post('/:id/build', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);

    const row = await getChallenge(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Challenge not found' }, 404);

    const spec = row.spec as ChallengeSpec;
    const plan = row.plan as ChallengePlan;
    if (!plan?.blueprintKey) return c.json({ error: 'This challenge has no plan yet — re-plan it first' }, 409);

    await setChallengeStatus(db, tenantId, row.id, { status: 'building' });

    try {
      const result = await materializeChallenge({
        db,
        env,
        bucket: env.UPLOADS,
        tenantId,
        spec,
        plan,
        projectId: row.projectId,
      });
      const updated = await setChallengeStatus(db, tenantId, row.id, {
        status: 'built',
        projectId: result.projectId,
      });
      return c.json({ challenge: updated ? toChallengeView(updated) : null, result });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/challengeRoutes.ts', operation: 'build' });
      const message = error instanceof Error ? error.message : 'Build failed';
      await setChallengeStatus(db, tenantId, row.id, { status: 'failed', error: message });
      return c.json({ error: message }, 500);
    }
  });

  /** Delete the challenge record. The PROJECT it built is deliberately left
   *  alone — deleting a workspace full of real work because a plan record was
   *  tidied away would be indefensible. */
  router.delete('/:id', async (c) => {
    await deleteChallenge(db, c.get('tenantId') as number, c.req.param('id'));
    return c.json({ ok: true });
  });

  return router;
}
