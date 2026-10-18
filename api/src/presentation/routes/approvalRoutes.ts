/**
 * Approvals routes – /api/approvals
 *
 * Human-in-the-loop approval gate for destructive / high-risk agent actions.
 *
 * POST   /api/approvals          Create a pending approval (agentHost API key auth, or tenant JWT DEVELOPER+)
 * GET    /api/approvals          List approvals for tenant (tenant JWT)
 * GET    /api/approvals/:id      Get approval detail (tenant JWT)
 * PATCH  /api/approvals/:id      Accept or reject an approval (tenant JWT, MANAGER+)
 *
 * Expiring timed-out approvals is NOT a route. It used to be `GET /escalate`, guarded
 * by a `CRON_SECRET` query param — but Cloudflare crons invoke `scheduled()`, not a
 * URL, so nothing ever called it, and an unset secret made it an unauthenticated
 * bulk-mutate endpoint. It now runs natively on the `*​/5` tick as
 * `runApprovalExpirySweep` (application/approvals), so there is one cron pattern and
 * no shared secret to leak or forget.
 *
 * AUTHORIZATION. Every route is behind an auth middleware mounted BEFORE the routes
 * (it used to be mounted after POST /, leaving creation unauthenticated-by-ordering
 * for anything the handler's own inline check missed):
 *   • all routes        — `approvalAuth`: an agentHost API key (?agentHostId=&key=)
 *                         OR a tenant JWT.
 * On top of that:
 *   • POST /            — DEVELOPER+ for human callers; `task.execution` action types
 *                         are server-only (they clear the run gate, so a client must
 *                         never be able to forge one and self-approve a run).
 *   • PATCH /:id        — MANAGER+ to approve/reject (approving a `task.execution`
 *                         gate STARTS a billable autonomous run); DEVELOPER+ to
 *                         answer a question/feedback request, which decides nothing.
 * Superadmin note: superadmin is a GLOBAL user flag (`sa` claim / users.is_superadmin)
 * used for cap-bypass (resolveSuperadminUnlimited); it is orthogonal to tenant role
 * and no requireRole gate in this codebase bypasses on it. A superadmin in their own
 * tenant holds OWNER, which clears every gate here.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authMiddleware, requireRole, isManager } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import { requestApproval } from '../../application/approval/requestApproval';
import { decideApproval } from '../../application/approval/decideApproval';
import { getApproval, listApprovals } from '../../application/approval/approvalQueue';
import { getPendingApprovalCount } from '../../application/approval/pendingApprovalCount';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { parseBody, z, zJsonObject } from './requestBody';

/** `actionType` / `description` stay optional so the handler's own
 *  "actionType and description are required" still answers; `metadata` is stored
 *  as JSON verbatim, so it keeps every key. */
const CreateApprovalBody = z.object({
  kind: z.string().nullish(),
  actionType: z.string().optional(),
  description: z.string().optional(),
  metadata: zJsonObject.nullish(),
  expiresAt: z.string().nullish(),
  requestedBy: z.string().nullish(),
});

/** `status` is a plain string so an unknown verb still gets the handler's own
 *  `status must be "approved", "rejected", or "answered"` message. */
const ResolveApprovalBody = z.object({
  status: z.string().optional(),
  reviewNote: z.string().nullish(),
  responseText: z.string().nullish(),
});

type ApprovalHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY: DurableObjectNamespace<AgentHostRelayDO>;
  };
  Variables: HonoEnv['Variables'] & {
    /** Set only on the agentHost API-key branch of {@link buildApprovalAuth}. */
    approvalAgentHostId?: number;
  };
};

/**
 * Auth for every tenant-facing approvals route.
 *
 * Two legitimate principals reach this router: a self-hosted agent host proving an
 * API key on the query string (it has no user), and a signed-in tenant user. This
 * middleware resolves whichever is present and establishes `tenantId` (plus
 * `approvalAgentHostId` for the machine caller) BEFORE any handler runs, so no
 * route in the file can be reached unauthenticated by mount ordering.
 *
 * A machine caller has no tenant role, so `role` is left unset — every role gate
 * below therefore also refuses it unless it takes the explicit machine branch.
 */
function buildApprovalAuth(db: Db): MiddlewareHandler<ApprovalHonoEnv> {
  return async (c, next) => {
    const agentHostIdParam = Number(c.req.query('agentHostId') ?? '');
    const apiKey = c.req.query('key');
    // The machine branch is scoped to CREATION only (POST /) — the one thing a host
    // legitimately does here. Widening it to the reads would let a host key page
    // through the tenant's whole approval queue, which it never could before.
    if (c.req.method === 'POST' && Number.isInteger(agentHostIdParam) && agentHostIdParam > 0 && apiKey) {
      const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey, c.env);
      if (!agentHost) return c.text('Unauthorized', 401);
      c.set('tenantId', agentHost.tenantId);
      c.set('approvalAgentHostId', agentHost.id);
      await next();
      return;
    }
    // Cast: authMiddleware is typed against the base HonoEnv; this router only widens
    // Bindings/Variables, so it is safe to run here (same pattern as agentHostRoutes).
    return (authMiddleware as unknown as MiddlewareHandler<ApprovalHonoEnv>)(c, next);
  };
}

// Slack/email fan-out + manager-email lookup live in the shared approvalNotifier
// so the cloud `ask_human` path notifies identically — see imports above.

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createApprovalRoutes(db: Db, runtimeService: RuntimeService): Hono<ApprovalHonoEnv> {
  const router = new Hono<ApprovalHonoEnv>();

  // Auth (agentHost API key OR tenant JWT) for EVERY route below. Mounted here —
  // above the routes — because it previously sat after POST '/', so creation
  // depended entirely on the handler's own inline check.
  router.use('*', buildApprovalAuth(db));

  // POST /api/approvals – create a pending approval request
  // AgentHost API key auth (?agentHostId=&key=) or tenant JWT (DEVELOPER+).
  router.post('/', async (c) => {
    const resolvedAgentHostId = c.get('approvalAgentHostId') ?? null;

    // Human callers must be DEVELOPER+ : an approval request is a work item that
    // notifies managers over Slack/email and can auto-resolve against the tenant's
    // auto-approval rules, so a read-only VIEWER must not be able to open one.
    // (The machine branch has no role and is authorized by its API key instead.)
    if (resolvedAgentHostId == null && !hasMinRole(c.get('role') as TenantRole, TenantRole.DEVELOPER)) {
      return c.json({ error: `Requires at least '${TenantRole.DEVELOPER}' role to raise an approval request` }, 403);
    }

    const body = await parseBody(c, CreateApprovalBody);
    const result = await requestApproval(db, c.env, {
      tenantId: c.get('tenantId') as number,
      agentHostId: resolvedAgentHostId,
      callerUserId: (c.get('userId') as string | undefined) ?? null,
      requestedBy: body.requestedBy,
      kind: body.kind,
      actionType: body.actionType,
      description: body.description,
      metadata: body.metadata,
      expiresAt: body.expiresAt,
    });
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    return c.json({ approvalId: result.approvalId, status: result.status }, 201);
  });

  // GET /api/approvals?status=&agentHostId=&projectId=
  // Each row is enriched with `taskId` and `projectId` (via execution → task) so
  // callers can show the work item that caused the request and scope/group the
  // queue by project without a second round-trip; null when the
  // approval isn't tied to a task (e.g. a self-hosted host gate). An explicit
  // `?projectId=` narrows server-side.
  router.get('/', async (c) => {
    const agentHostId = c.req.query('agentHostId') ? Number(c.req.query('agentHostId')) : null;
    const projectRaw  = c.req.query('projectId');
    const projectId   = projectRaw && Number.isInteger(Number(projectRaw)) ? Number(projectRaw) : null;
    const rows = await listApprovals(db, c.get('tenantId') as number, c.get('userId') as string | undefined, {
      status: c.req.query('status'),
      agentHostId,
      projectId,
    });
    return c.json({ approvals: rows });
  });

  // GET /api/approvals/count — pending count + recent createdAt for the dashboard
  // tile, read from pending rows only (the list reads every status up to a cap).
  // Registered BEFORE '/:id' so 'count' is not read as an approval id.
  router.get('/count', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await getPendingApprovalCount(db, c.env as Env, tenantId, c.get('userId') as string | undefined));
  });

  // GET /api/approvals/:id
  router.get('/:id', async (c) => {
    const row = await getApproval(db, c.get('tenantId') as number, c.get('userId') as string | undefined, c.req.param('id'));
    if (!row) return c.json({ error: 'Approval not found' }, 404);
    return c.json(row);
  });

  // PATCH /api/approvals/:id – resolve a request.
  //   approval kind  → status 'approved' | 'rejected'   (MANAGER+)
  //   question/feedback kind → status 'answered' with a free-text responseText (DEVELOPER+)
  //
  // The DECISION verbs are manager-only: approving a `task.execution` gate below
  // replays the run via dispatchCloudRunForTask, i.e. any member who could PATCH
  // this could clear the governance gate and start a billable autonomous run. That
  // was the hole. Answering a question steers a run that is ALREADY approved and
  // running, so it stays at the run tier — split with the shared `isManager`
  // predicate rather than a second gating mechanism.
  router.patch('/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const body = await parseBody(c, ResolveApprovalBody);
    const result = await decideApproval(db, c.env, {
      tenantId: c.get('tenantId') as number,
      segmentId: c.get('segmentId') ?? null,
      approvalId: c.req.param('id'),
      actor: { userId: c.get('userId') as string, role: c.get('role') as string, isManager: isManager(c) },
      status: body.status,
      reviewNote: body.reviewNote,
      responseText: body.responseText,
      runtimeService,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    // `startedExecutionId` lets the caller follow a run the approval started; when the
    // approval was granted but the run was refused, `startRefusal` says which guard
    // declined, so the approver is never left thinking their decision started work.
    const { row, startedExecutionId, startRefusal } = result;
    return c.json({ ...row, startedExecutionId, ...(startRefusal ? { startRefusal } : {}) });
  });

  return router;
}
