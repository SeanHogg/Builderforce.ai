/**
 * Agent runtime routes – /api/agent-runtime
 *
 * The execution surface that closes the loop for cloud/browser agents:
 *
 *   POST /api/agent-runtime/claim                 Browser pull worker claims the
 *                                                 next pending `browser` dispatch
 *   POST /api/agent-runtime/:dispatchId/running   Mark a claimed dispatch running
 *   POST /api/agent-runtime/:dispatchId/result    Report a terminal result; the
 *                                                 SwimlaneCoordinator aggregates
 *                                                 the stage and autonomously
 *                                                 advances the ticket (or routes
 *                                                 it to needs_attention).
 *
 * A browser PWA/WebContainer runs the agent loop in src/application/browserRuntime
 * and drives these endpoints. Claws use the same /result callback.
 */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { agentDispatches } from '../../infrastructure/database/schema';
import { SwimlaneCoordinator } from '../../application/swimlane/SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from '../../application/swimlane/DrizzleCoordinatorStore';
import {
  ClawStageDispatcher,
  type ClawRelayNamespace,
} from '../../application/swimlane/clawStageDispatcher';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type RuntimeEnv = { CLAW_RELAY?: ClawRelayNamespace };

export function createAgentRuntimeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const mkCoordinator = (env: unknown): SwimlaneCoordinator =>
    new SwimlaneCoordinator(
      new DrizzleCoordinatorStore(db),
      new ClawStageDispatcher((env as RuntimeEnv)?.CLAW_RELAY),
    );

  // Claim the next pending browser dispatch for this tenant.
  router.post('/claim', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const [candidate] = await db
      .select()
      .from(agentDispatches)
      .where(
        and(
          eq(agentDispatches.tenantId, tenantId),
          eq(agentDispatches.runtime, 'browser'),
          eq(agentDispatches.status, 'pending'),
        ),
      )
      .orderBy(asc(agentDispatches.createdAt))
      .limit(1);

    if (!candidate) return c.json({ dispatch: null });

    const claimToken = crypto.randomUUID();
    // Guard against a race: only claim if it is still pending.
    const [claimed] = await db
      .update(agentDispatches)
      .set({ status: 'claimed', externalRef: claimToken, claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentDispatches.id, candidate.id), eq(agentDispatches.status, 'pending')))
      .returning();

    if (!claimed) return c.json({ dispatch: null }); // lost the race

    return c.json({
      dispatch: {
        dispatchId: claimed.id,
        claimToken,
        role: claimed.role,
        model: claimed.model,
        input: claimed.input,
        taskId: claimed.taskId,
        ticketRunId: claimed.ticketRunId,
      },
    });
  });

  // Optional: mark a claimed dispatch as actively running.
  router.post('/:dispatchId/running', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const dispatchId = c.req.param('dispatchId');
    const [row] = await db
      .update(agentDispatches)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(agentDispatches.id, dispatchId), eq(agentDispatches.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'Dispatch not found' }, 404);
    return c.json({ ok: true });
  });

  // Report a terminal result — this is the automated callback that advances the
  // ticket (autonomous mode) or routes it to needs_attention.
  router.post('/:dispatchId/result', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const dispatchId = c.req.param('dispatchId');
    const body = await c.req.json<{ status: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string }>();

    if (!['completed', 'failed', 'cancelled'].includes(body.status)) {
      return c.json({ error: 'status must be completed | failed | cancelled' }, 400);
    }

    try {
      await mkCoordinator(c.env).reportDispatchResult(dispatchId, tenantId, {
        status: body.status,
        output: body.output ?? null,
        error: body.error ?? null,
      });
    } catch {
      return c.json({ error: 'Dispatch not found' }, 404);
    }
    return c.json({ ok: true });
  });

  return router;
}
