/**
 * Agent Ops — /api/agent-ops/*
 *
 * The read/write surface for the three agent-operations contexts, mounted together
 * because they are one operator job ("is my agent fleet behaving?") even though they
 * are three separate domains behind the routes:
 *
 *   COORDINATION (0370)  who holds what right now, and what the agents are telling
 *                        each other about it.
 *     GET    /coordination/:taskId            – live leases + blackboard for a ticket
 *     DELETE /coordination/:taskId/leases     – force-release a stuck lease (manager+)
 *
 *   MEMORY (0371)        every remembered fact WITH its scope, provenance and expiry.
 *     GET    /memory                          – governed list for a scope context
 *     DELETE /memory/:key                     – forget one fact (manager+)
 *     POST   /memory/purge                    – sweep this workspace's lapsed facts (manager+)
 *
 *   REHEARSAL (0372)     dry-run / replay / trial, and their reports.
 *     GET    /rehearsals                      – list
 *     GET    /rehearsals/:id                  – one rehearsal + its suppressed effects
 *     POST   /rehearsals                      – start one (manager+; it spends tokens)
 *
 * WRITES ARE MANAGER+ AND READS ARE MEMBER-LEVEL, matching governance: anyone may see
 * the posture their agents run under; changing it — releasing another agent's lock,
 * deleting a belief, spending tokens on a rehearsal — is a privileged act.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { forceReleaseLease } from '../../application/coordination/leaseService';
import { getTicketCoordination } from '../../application/coordination/coordinationCapability';
import { forget, listGovernedMemories, purgeExpiredMemories } from '../../application/memory/memoryService';
import {
  TRIAL_MAX_TICKETS,
  getRehearsal,
  compareRehearsals,
  isRehearsalKind,
  listRehearsals,
  runRehearsal,
  runTrial,
} from '../../application/rehearsal/rehearsalService';
import type { DbHandle } from '../../application/shared/dbHandle';
import type { HonoEnv } from '../../env';
import { getReconciliationDiagnostics, listReconciliationRuns, reconciliationRequesterId, runPrTicketReconciliation } from '../../application/reconciliation/prReconciliationService';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { listIdeAgentVersions, releaseIdeAgentVersion } from '../../application/agentIdentity/agentRunIdentity';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const numQuery = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function createAgentOpsRoutes(db: DbHandle) {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Coordination ────────────────────────────────────────────────────────────

  /** One ticket's live coordination state: who holds which paths, and the board. */
  router.get('/coordination/:taskId', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId) || taskId <= 0) return json({ error: 'invalid taskId' }, 400);
    // The service owns the IDOR guard (a ticket's tenant comes from its project) and
    // returns null when the ticket is not ours.
    const state = await getTicketCoordination(c.env, db, c.get('tenantId'), taskId);
    return state ? json(state) : json({ error: 'ticket not found' }, 404);
  });

  /**
   * Force-release a lease. The escape hatch for the one failure the TTL cannot fix
   * fast enough: an operator who knows a holder is dead and does not want to wait out
   * the remaining window while live agents queue behind it.
   */
  router.delete('/coordination/:taskId/leases', requireRole(TenantRole.MANAGER), async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const body = (await c.req.json<{ resource?: unknown }>().catch(() => ({}))) as { resource?: unknown };
    const resource = typeof body.resource === 'string' ? body.resource : '';
    if (!Number.isFinite(taskId) || !resource) return json({ error: 'taskId and resource are required' }, 400);
    // Only the PATH comes from the client. The service resolves which live lease that
    // is within the ticket's scope, so a client can neither name a lease outside this
    // ticket nor be trusted with the repo/branch half of a lease key.
    const released = await forceReleaseLease(c.env, db, { tenantId: c.get('tenantId'), taskId, resource });
    return json({ released });
  });

  // ── Memory governance ───────────────────────────────────────────────────────

  /** Every fact visible from a scope context, with provenance and expiry. */
  router.get('/memory', async (c) => {
    const tenantId = c.get('tenantId');
    const rows = await listGovernedMemories(
      c.env,
      db,
      {
        tenantId,
        projectId: numQuery(c.req.query('projectId')),
        ticketId: numQuery(c.req.query('taskId')),
      },
      { limit: numQuery(c.req.query('limit')) ?? 200 },
    );
    return json({ memories: rows });
  });

  /** Forget one fact — the human counterpart of the agent's `memory_forget`. */
  router.delete('/memory/:key', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const key = c.req.param('key');
    const result = await forget(c.env, db, {
      tenantId,
      projectId: numQuery(c.req.query('projectId')),
      ticketId: numQuery(c.req.query('taskId')),
    }, key);
    return json(result, result.ok ? 200 : 400);
  });

  /** Sweep this workspace's lapsed facts now instead of waiting for the daily cron. */
  router.post('/memory/purge', requireRole(TenantRole.MANAGER), async (c) => {
    const removed = await purgeExpiredMemories(c.env, db, c.get('tenantId'));
    return json({ removed });
  });

  // ── Rehearsal ───────────────────────────────────────────────────────────────

  // ── PR/ticket reconciliation ───────────────────────────────────────────────

  /** Durable run history. Every item and every handled error is retained per run. */
  router.get('/pr-reconciliation/runs', async (c) => {
    const repoId = c.req.query('repoId') || undefined;
    const limit = numQuery(c.req.query('limit')) ?? 25;
    return json({ runs: await listReconciliationRuns(db, c.get('tenantId'), repoId, limit) });
  });

  /** Full evidence, recommendations, errors, and self-verifying ledger invariants. */
  router.get('/pr-reconciliation/runs/:id/diagnostics', async (c) => {
    const diagnostics = await getReconciliationDiagnostics(db, c.get('tenantId'), c.req.param('id'));
    return diagnostics ? json(diagnostics) : json({ error: 'reconciliation run not found' }, 404);
  });

  /**
   * Run the dedicated reconciler. Dry-run is the default. Apply mode is doubly
   * gated: MANAGER+ here and a non-empty, explicit PR-number allowlist in the
   * service; only high-confidence close candidates can pass the second gate.
   */
  router.post('/pr-reconciliation/runs', requireRole(TenantRole.MANAGER), async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const repoId = typeof body.repoId === 'string' ? body.repoId : '';
    const mode = body.mode === 'apply' ? 'apply' : body.mode == null || body.mode === 'dry_run' ? 'dry_run' : null;
    const approvedPrNumbers = Array.isArray(body.approvedPrNumbers)
      ? body.approvedPrNumbers.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!repoId) return json({ error: 'repoId is required' }, 400);
    if (!mode) return json({ error: "mode must be 'dry_run' or 'apply'" }, 400);

    try {
      const result = await runPrTicketReconciliation(c.env, db, {
        tenantId: c.get('tenantId'), repoId, mode, approvedPrNumbers,
        requestedBy: reconciliationRequesterId(c.get('userId'), c.get('machineActor')),
      });
      return json(result, 201);
    } catch (error) {
      reportCaughtError(error, {
        source: 'presentation/routes/agentOpsRoutes.ts',
        operation: 'POST /pr-reconciliation/runs',
        context: { tenantId: c.get('tenantId'), repoId, mode, approvedPrNumbers },
      });
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  router.get('/rehearsals', async (c) => {
    const rehearsalRows = await listRehearsals(db, c.get('tenantId'), {
      projectId: numQuery(c.req.query('projectId')),
      limit: numQuery(c.req.query('limit')) ?? 50,
    });
    return json({ rehearsals: rehearsalRows });
  });

  router.get('/rehearsals/compare', async (c) => {
    const left = c.req.query('left'); const right = c.req.query('right');
    if (!left || !right || left === right) return json({ error: 'left and right must name two distinct rehearsals' }, 400);
    const comparison = await compareRehearsals(db, c.get('tenantId'), left, right);
    return comparison ? json(comparison) : json({ error: 'rehearsal not found' }, 404);
  });

  router.get('/rehearsals/:id', async (c) => {
    const found = await getRehearsal(db, c.get('tenantId'), c.req.param('id'));
    return found ? json(found) : json({ error: 'rehearsal not found' }, 404);
  });

  /**
   * Start a rehearsal. MANAGER+ because it spends model tokens, and synchronous
   * because a rehearsal is bounded and the caller wants the report — a job id would
   * just move the wait into a poll loop.
   */
  router.post('/rehearsals', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const kind = body.kind;
    if (!isRehearsalKind(kind)) return json({ error: "kind must be 'dry_run', 'replay' or 'trial'" }, 400);

    const agentRef = typeof body.agentRef === 'string' ? body.agentRef : undefined;
    const model = typeof body.model === 'string' && body.model ? body.model : undefined;
    // `users.id` is a VARCHAR(36) — coercing it through Number() yielded NaN for every
    // real user, so this attribution was ALWAYS null. Pass the id through as the string
    // it is; the column and the service signature now agree with the schema.
    const createdBy = typeof userId === 'string' && userId ? userId : null;

    try {
      if (kind === 'trial') {
        if (!agentRef) return json({ error: 'a trial needs an agentRef' }, 400);
        const ids = await runTrial(c.env, db, {
          tenantId,
          projectId: Number.isFinite(Number(body.projectId)) ? Number(body.projectId) : null,
          agentRef,
          ...(model ? { model } : {}),
          ticketCount: Number.isFinite(Number(body.ticketCount)) ? Number(body.ticketCount) : undefined,
          createdBy,
        });
        return json({ ids, max: TRIAL_MAX_TICKETS });
      }

      const id = await runRehearsal(c.env, db, {
        tenantId,
        kind,
        taskId: Number.isFinite(Number(body.taskId)) ? Number(body.taskId) : undefined,
        sourceExecutionId: Number.isFinite(Number(body.sourceExecutionId)) ? Number(body.sourceExecutionId) : undefined,
        ...(agentRef ? { agentRef } : {}),
        ...(model ? { model } : {}),
        createdBy,
      });
      return json({ id });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  router.get('/agents/:ref/versions', async (c) => {
    return json(await listIdeAgentVersions(db, c.get('tenantId'), c.req.param('ref')));
  });

  router.post('/agents/:ref/releases', requireRole(TenantRole.MANAGER), async (c) => {
    const body: { versionId?: string; mode?: string; canaryPercent?: number } = await c.req.json<{ versionId?: string; mode?: string; canaryPercent?: number }>().catch(() => ({}));
    if (!body.versionId || !['stable', 'canary', 'rollback'].includes(body.mode ?? '')) return json({ error: 'versionId and mode (stable, canary, rollback) are required' }, 400);
    try {
      await releaseIdeAgentVersion(db, {
        tenantId: c.get('tenantId'), agentRef: c.req.param('ref'), versionId: body.versionId,
        mode: body.mode as 'stable' | 'canary' | 'rollback', canaryPercent: body.canaryPercent,
        actorRef: c.get('userId') ?? undefined,
      });
      return json({ ok: true });
    } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  return router;
}
