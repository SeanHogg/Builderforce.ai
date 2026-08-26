/**
 * `/api/realizations` — turn an idea into something a person can open.
 *
 *   GET    /api/realizations/targets          the catalog + hosting strategies
 *   POST   /api/realizations/plan             read an idea, rank the proofs (writes nothing)
 *   GET    /api/realizations                  the workspace's proofs
 *   POST   /api/realizations                  choose a target and plan it
 *   GET    /api/realizations/:id               also rolls up the proof's own console's verdict
 *   POST   /api/realizations/:id/build        build it, publish it, wire its forms
 *   PATCH  /api/realizations/:id/verdict      park it — the one verdict a person sets
 *   DELETE /api/realizations/:id
 *
 * ── THE LOOP RECORDS ITSELF ─────────────────────────────────────────────────
 * Read, Prove, Build and Measure each write a correlated event to the outcome
 * ledger when the proof names the Creation Session whose idea it is proving
 * (`sessionId`). That is what makes the platform's north-star metric — the
 * share of ideas that reached a proof whose kill condition was actually graded
 * — computable at all. See `application/realization/proofOutcomes.ts`.
 *
 * Plan and BUILD are separate calls, for the same reason they are on challenges:
 * planning is a model reading an idea, and that reading is exactly what a human
 * should check before a project, a canvas full of files and a board of tickets
 * exist. `/plan` is deliberately a read — it persists nothing, so exploring which
 * proof to run costs a request and leaves no rows behind.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import { gatewayExtractor } from '../../application/llm/gatewayExtractor';
import { HOSTING_STRATEGIES } from '../../application/backend';
import { getChallenge } from '../../application/challenge/challengeStore';
import { parseBrief, type ChallengeSpec } from '../../application/challenge/parseBrief';
import type { ChallengePlan } from '../../application/challenge/planChallenge';
import { planRealization } from '../../application/realization/planRealization';
import {
  abandonRealization,
  createRealization,
  deleteRealization,
  getRealization,
  listRealizations,
  setRealizationOutcome,
  toRealizationView,
} from '../../application/realization/realizationStore';
import { syncRealizationVerdict } from '../../application/realization/realizationVerdict';
import { proofReachable, recordProofOutcome } from '../../application/realization/proofOutcomes';
import { resolveOutcomeSession } from '../../application/outcomes/outcomeLedger';
import { ingressForPlanning, realize } from '../../application/realization/realizeService';
import { REALIZATION_TARGETS, realizationTargetByKey, recommendRealizations } from '../../application/realization/targets';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/** Ideas longer than this are a brief, and belong in the challenge pipeline. */
const MAX_IDEA_CHARS = 20_000;

/** Read an idea into a spec. Shared by `/plan` and create so the two cannot drift. */
async function readIdea(env: Env, idea: string): Promise<ChallengeSpec> {
  return parseBrief(idea, gatewayExtractor(env, { useCase: 'realization_idea', maxTokens: 1_200 }));
}

/** The target catalog, as the client needs it. */
const targetCatalog = () =>
  REALIZATION_TARGETS.map((t) => ({
    key: t.key,
    name: t.name,
    summary: t.summary,
    answers: t.answers,
    fidelity: t.fidelity,
    effort: t.effort,
    suits: t.suits,
    hasBackend: t.strategy !== null,
    allowsStrategyChoice: t.allowsStrategyChoice === true,
  }));

export function createRealizationRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * Who this proof is for, as the outcome ledger needs it.
   *
   * The session is RESOLVED rather than believed: `resolveOutcomeSession`
   * accepts it only when it is a live board in this tenant that this user is a
   * member of. Everything else is derived from the proven request, so nothing a
   * client sends can attribute a proof to another workspace's numbers.
   */
  const proofSubject = async (c: Context<HonoEnv>, sessionId: unknown, projectId?: number | null) => {
    const tenantId = c.get('tenantId') as number;
    const userId = (c.get('userId') as string) ?? null;
    return {
      tenantId,
      userId,
      projectId: projectId ?? null,
      sessionId: await resolveOutcomeSession(db, { tenantId, userId, sessionId }),
    };
  };

  /**
   * The catalog. Declared BEFORE `/:id` — Hono matches in registration order, and
   * a later literal route loses to an earlier parameterised one.
   */
  router.get('/targets', (c) =>
    c.json({
      targets: targetCatalog(),
      strategies: HOSTING_STRATEGIES.map((s) => ({
        key: s.key,
        label: s.label,
        summary: s.summary,
        zeroSetup: s.zeroSetup,
      })),
    }));

  /**
   * Read an idea and rank the proofs. Writes nothing — except, when the idea
   * belongs to a board, the one thing worth keeping: that a READ happened, and
   * when. `readBeforeBuildRate` is the difference between a team that chose a
   * proof and a team that started building, and it cannot be told apart after
   * the fact from a call that left no trace.
   */
  router.post('/plan', async (c) => {
    const body = await c.req.json<{ idea?: unknown; sessionId?: unknown }>().catch(() => ({}) as never);
    const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
    if (!idea) return c.json({ error: 'idea is required' }, 400);
    if (idea.length > MAX_IDEA_CHARS) {
      return c.json({ error: `idea exceeds ${MAX_IDEA_CHARS} characters` }, 400);
    }

    const subject = await proofSubject(c, body.sessionId);
    const correlationId = `read:${crypto.randomUUID()}`;
    const startedAt = Date.now();
    await recordProofOutcome(db, { ...subject, correlationId, action: 'idea.read', phase: 'started' });
    try {
      const spec = await readIdea(c.env as Env, idea);
      const recommendations = recommendRealizations(spec);
      await recordProofOutcome(db, {
        ...subject,
        correlationId,
        action: 'idea.read',
        phase: 'succeeded',
        durationMs: Date.now() - startedAt,
        metricKey: 'proofs_ranked',
        metricValue: recommendations.length,
        unit: 'count',
        // The recommender's own opinion, kept small (the catalog is 8 targets) so a
        // later `proof.choose` can be read back against what was actually advised —
        // otherwise "chose X" and "Y was the top pick" can never be compared after
        // the fact, because the ranked list itself was never written down anywhere.
        metadata: { recommendations: recommendations.map((r) => ({ key: r.key, score: r.score, recommended: r.recommended })) },
      });
      return c.json({ spec, recommendations, targets: targetCatalog() });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/realizationRoutes.ts', operation: 'plan' });
      await recordProofOutcome(db, { ...subject, correlationId, action: 'idea.read', phase: 'failed', durationMs: Date.now() - startedAt });
      return c.json({ error: error instanceof Error ? error.message : 'Could not read the idea' }, 502);
    }
  });

  router.get('/', async (c) =>
    c.json({ realizations: await listRealizations(db, c.get('tenantId') as number) }));

  /**
   * Choose a proof and plan it.
   *
   * The idea can arrive three ways: as text, as a challenge id (reusing the spec
   * a brief was already read into), or as a project id (proving something that
   * already exists). All three converge on a spec before anything is planned,
   * because a target builds from a spec and knows nothing about where it came
   * from.
   */
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req
      .json<{ idea?: unknown; challengeId?: unknown; projectId?: unknown; targetKey?: unknown; strategy?: unknown; sessionId?: unknown }>()
      .catch(() => ({}) as never);

    const target = realizationTargetByKey(typeof body.targetKey === 'string' ? body.targetKey : null);
    if (!target) return c.json({ error: 'targetKey must name a realization target' }, 400);

    let spec: ChallengeSpec | null = null;
    let challengeId: string | null = null;
    let briefPlan: ChallengePlan | null = null;

    if (typeof body.challengeId === 'string' && body.challengeId) {
      const challenge = await getChallenge(db, tenantId, body.challengeId);
      if (!challenge) return c.json({ error: 'Challenge not found' }, 404);
      spec = challenge.spec as ChallengeSpec;
      briefPlan = (challenge.plan ?? null) as ChallengePlan | null;
      challengeId = challenge.id;
    } else if (typeof body.idea === 'string' && body.idea.trim()) {
      const idea = body.idea.trim();
      if (idea.length > MAX_IDEA_CHARS) {
        return c.json({ error: `idea exceeds ${MAX_IDEA_CHARS} characters` }, 400);
      }
      try {
        spec = await readIdea(c.env as Env, idea);
      } catch (error) {
        reportCaughtError(error, { source: 'presentation/routes/realizationRoutes.ts', operation: 'create:read' });
        return c.json({ error: error instanceof Error ? error.message : 'Could not read the idea' }, 502);
      }
    }

    if (!spec) return c.json({ error: 'Provide an idea or a challengeId' }, 400);

    const projectId = typeof body.projectId === 'number' ? body.projectId : null;
    // Resolved before the plan so a generated console can name its own backend.
    // Empty when there is no project yet; the materialiser substitutes the real
    // address into every page as it writes them.
    const ingressUrl = await ingressForPlanning(c.env as Env, db, tenantId, projectId);

    const { plan } = planRealization(spec, target, ingressUrl, {
      strategy: typeof body.strategy === 'string' ? body.strategy : null,
      briefPlan,
    });

    const subject = await proofSubject(c, body.sessionId, projectId);
    const row = await createRealization(db, {
      tenantId,
      challengeId,
      projectId,
      sessionId: subject.sessionId,
      targetKey: target.key,
      title: spec.title,
      strategy: plan.strategy,
      spec,
      plan,
      userId: subject.userId,
    });
    // PROVE. The single most consequential decision in the first month of an
    // idea is which proof is worth running, so it is recorded as an act in its
    // own right rather than inferred later from whatever got built.
    const correlationId = `choose:${row.id}`;
    await recordProofOutcome(db, { ...subject, correlationId, action: 'proof.choose', phase: 'started', realizationId: row.id, targetKey: target.key });
    await recordProofOutcome(db, {
      ...subject,
      correlationId,
      action: 'proof.choose',
      phase: 'succeeded',
      realizationId: row.id,
      targetKey: target.key,
      metricKey: 'proof_effort',
      metricValue: target.effort,
      unit: 'count',
      metadata: { fidelity: target.fidelity, fromChallenge: !!challengeId },
    });
    return c.json({ realization: toRealizationView(row) }, 201);
  });

  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const row = await getRealization(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Realization not found' }, 404);
    // Rolled up here, not stored eagerly: a console's write is untrusted until
    // read back server-side, and a person opening this proof to check on it is
    // exactly the moment "what did it tell us?" should already be answered.
    const synced = await syncRealizationVerdict(db, tenantId, row);
    return c.json({ realization: toRealizationView(synced) });
  });

  /**
   * Park it. The one verdict a person sets rather than the console: abandoning
   * is a judgement call with no number to compute, so it does not go through
   * the same rollup as `met`/`missed`.
   */
  router.patch('/:id/verdict', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ verdict?: unknown; note?: unknown }>().catch(() => ({}) as never);
    if (body.verdict !== 'abandoned') {
      return c.json(
        { error: 'Only "abandoned" may be set here — met and missed are recorded from the proof\'s own console.' },
        400,
      );
    }
    const note = typeof body.note === 'string' ? body.note : undefined;
    const updated = await abandonRealization(db, tenantId, c.req.param('id'), note);
    if (!updated) return c.json({ error: 'Realization not found' }, 404);
    // Terminates the grade correlation as FAILED, never validated: parking an
    // idea is a judgement with no number behind it, and counting it as graded
    // would let the north-star metric be satisfied by giving up.
    await recordProofOutcome(db, {
      tenantId,
      userId: (c.get('userId') as string) ?? null,
      projectId: updated.projectId,
      sessionId: updated.sessionId,
      correlationId: `grade:${updated.id}`,
      action: 'proof.grade',
      phase: 'failed',
      realizationId: updated.id,
      targetKey: updated.targetKey,
      metadata: { verdict: 'abandoned' },
    });
    return c.json({ realization: toRealizationView(updated) });
  });

  /**
   * Build it, publish it, and wire its forms.
   *
   * Idempotent, like the challenge build it delegates to: files are overwritten
   * by path, tickets are matched on title and skipped, and a collection that
   * already exists is left alone. Pressing Build twice converges rather than
   * duplicating — which matters here because the natural loop is "build, look at
   * it, edit the plan, build again".
   */
  router.post('/:id/build', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);

    const row = await getRealization(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Realization not found' }, 404);

    const target = realizationTargetByKey(row.targetKey);
    if (!target) return c.json({ error: `Unknown realization target "${row.targetKey}"` }, 409);

    const spec = row.spec as ChallengeSpec;
    const storedPlan = row.plan as ChallengePlan;
    if (!storedPlan?.blueprintKey) {
      return c.json({ error: 'This realization has no plan yet' }, 409);
    }

    await setRealizationOutcome(db, tenantId, row.id, { status: 'building' });

    // BUILD. Correlated on the realization, so a rebuild converges on the same
    // pair rather than counting as a second attempt nobody made.
    const subject = { tenantId, userId: (c.get('userId') as string) ?? null, projectId: row.projectId, sessionId: row.sessionId };
    const buildCorrelation = `build:${row.id}`;
    const buildStartedAt = Date.now();
    await recordProofOutcome(db, { ...subject, correlationId: buildCorrelation, action: 'proof.build', phase: 'started', realizationId: row.id, targetKey: row.targetKey });

    try {
      // Re-derived rather than stored: `requiredCollections` is a property of the
      // TARGET, and a realization planned before a target learned it needs one
      // would otherwise never get it.
      const { collections } = planRealization(spec, target, '', { strategy: row.strategy });

      const result = await realize({
        db,
        env,
        bucket: env.UPLOADS,
        tenantId,
        spec,
        plan: storedPlan,
        collections,
        projectId: row.projectId,
        // The lineage 0935 exists for: the collections this proof provisions
        // carry the session back, so its leads are attributable to the idea.
        sessionId: row.sessionId,
        // Seeded BUILD tickets are offered to the canonical auto-run gate, so a
        // built proof starts moving instead of waiting for a first drag.
        runtimeService,
      });

      const updated = await setRealizationOutcome(db, tenantId, row.id, {
        status: 'built',
        projectId: result.projectId,
        liveUrl: result.liveUrl,
        result: result as unknown as Record<string, unknown>,
      });
      const reachable = proofReachable(result.liveUrl);
      const built = { ...subject, projectId: result.projectId ?? row.projectId, realizationId: row.id, targetKey: row.targetKey };
      await recordProofOutcome(db, {
        ...built,
        correlationId: buildCorrelation,
        action: 'proof.build',
        phase: 'succeeded',
        durationMs: Date.now() - buildStartedAt,
        metricKey: 'reachable_proofs',
        metricValue: reachable ? 1 : 0,
        unit: 'count',
        // `reachable` is what separates a built proof from one a person can
        // open. The Build family counts this key and nothing else.
        metadata: { reachable, publishedAssets: result.publishedAssets },
      });
      // MEASURE starts the moment the proof is live: the clock on "did anyone
      // grade this?" runs from now, and the terminal arrives when the proof's
      // own console reports what its kill condition decided.
      if (reachable) {
        await recordProofOutcome(db, { ...built, correlationId: `grade:${row.id}`, action: 'proof.grade', phase: 'started' });
      }
      return c.json({ realization: updated ? toRealizationView(updated) : null, result });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/realizationRoutes.ts', operation: 'build' });
      const message = error instanceof Error ? error.message : 'Build failed';
      await setRealizationOutcome(db, tenantId, row.id, { status: 'failed', error: message });
      await recordProofOutcome(db, {
        ...subject,
        correlationId: buildCorrelation,
        action: 'proof.build',
        phase: 'failed',
        realizationId: row.id,
        targetKey: row.targetKey,
        durationMs: Date.now() - buildStartedAt,
      });
      return c.json({ error: message }, 500);
    }
  });

  /** Delete the RECORD. The project and the published proof are left alone —
   *  a live URL somebody has already shared must not disappear because a row was
   *  tidied away. */
  router.delete('/:id', async (c) => {
    await deleteRealization(db, c.get('tenantId') as number, c.req.param('id'));
    return c.json({ ok: true });
  });

  return router;
}
