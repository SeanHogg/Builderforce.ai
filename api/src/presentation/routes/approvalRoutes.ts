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
import { eq, and, desc, lt, getTableColumns } from 'drizzle-orm';
import { authMiddleware, requireRole, isManager } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { approvals, executions, tasks } from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import { checkAutoApprovalRules } from './approvalRuleRoutes';
import { normalizeRequestKind, isAnswerableKind } from '../../domain/approval/requestKind';
import { sendSlackNotification, notifyApprovalRequested } from '../../application/approval/approvalNotifier';
import { resumePausedExecution } from '../../application/runtime/executionResume';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { parseApprovalReplay } from '../../application/runtime/executionApprovalGate';
import { TicketAuditService } from '../../application/audit/ticketAuditService';
import { TicketParticipantsService } from '../../application/kanban/ticketParticipants';
import { resolveMemberDisplayName } from '../../application/kanban/roleCapability';
import { recordActivity, resolveHumanActor } from '../../application/activity/activityLog';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

/** The role a `task.execution` approval was created for (set on the metadata when
 *  the gated run is role-attributed), or null. Drives the §5.8 approvals→sign-off bridge. */
function parseApprovalRoleKey(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as { roleKey?: unknown };
    return typeof m.roleKey === 'string' && m.roleKey.trim() ? m.roleKey.trim() : null;
  } catch {
    return null;
  }
}

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
      const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey);
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
    const env = c.env;
    const tenantId = c.get('tenantId') as number;
    const resolvedAgentHostId = c.get('approvalAgentHostId') ?? null;

    // Human callers must be DEVELOPER+ : an approval request is a work item that
    // notifies managers over Slack/email and can auto-resolve against the tenant's
    // auto-approval rules, so a read-only VIEWER must not be able to open one.
    // (The machine branch has no role and is authorized by its API key instead.)
    if (resolvedAgentHostId == null && !hasMinRole(c.get('role') as TenantRole, TenantRole.DEVELOPER)) {
      return c.json({ error: `Requires at least '${TenantRole.DEVELOPER}' role to raise an approval request` }, 403);
    }

    const body = await c.req.json<{
      kind?:        string;
      actionType:   string;
      description:  string;
      metadata?:    Record<string, unknown>;
      expiresAt?:   string;
      requestedBy?: string;
    }>();

    if (!body.actionType || !body.description) {
      return c.json({ error: 'actionType and description are required' }, 400);
    }

    // `task.execution` is the RUN gate: an approved one lets a task dispatch without
    // further manager sign-off (see evaluateExecutionApprovalGate, which is the only
    // thing that legitimately creates them — server-side, never over HTTP). Accepting
    // one here would let any caller mint a gate row and, if an auto-approval rule
    // matched it, clear the manager gate on a high/urgent ticket outright.
    if (body.actionType === 'task.execution') {
      return c.json({ error: `'task.execution' approvals are created by the execution gate, not by clients` }, 400);
    }

    const kind = normalizeRequestKind(body.kind);

    // ── Auto-approval check ──────────────────────────────────────────────────
    // Only 'approval' kinds can auto-resolve; questions/feedback always need a
    // human to actually answer, so they never short-circuit to a status.
    const autoApproved = kind === 'approval'
      && await checkAutoApprovalRules(db, tenantId, body.actionType, body.metadata ?? null);

    const approvalId = crypto.randomUUID();
    const now = new Date();
    const status = autoApproved ? 'approved' : 'pending';

    await db.insert(approvals).values({
      id:          approvalId,
      tenantId,
      agentHostId:      resolvedAgentHostId,
      requestedBy: body.requestedBy ?? (resolvedAgentHostId ? String(resolvedAgentHostId) : null),
      kind,
      actionType:  body.actionType,
      description: body.description,
      metadata:    body.metadata != null ? JSON.stringify(body.metadata) : null,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
      status,
      reviewedBy:  autoApproved ? 'auto-approval-rule' : null,
      reviewNote:  autoApproved ? 'Automatically approved by matching rule' : null,
      createdAt:   now,
      updatedAt:   now,
    });

    // Notify connected browser clients via the relay if agentHostId is known
    if (resolvedAgentHostId && env.AGENT_HOST_RELAY) {
      const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(resolvedAgentHostId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        autoApproved ? 'approval.auto_approved' : 'approval.request',
          approvalId,
          kind,
          actionType:  body.actionType,
          description: body.description,
          expiresAt:   body.expiresAt,
          status,
        }),
      })).catch(() => { /* best-effort */ });
    }

    // Slack + email fan-out for new pending requests (skip if auto-approved).
    if (!autoApproved) {
      await notifyApprovalRequested(env, db, {
        tenantId, approvalId, kind, actionType: body.actionType, description: body.description,
      });
    }

    return c.json({ approvalId, status }, 201);
  });

  // GET /api/approvals?status=&agentHostId=&projectId=
  // Each row is enriched with `taskId` and `projectId` (via execution → task) so
  // callers can show the work item that caused the request and scope/group the
  // queue by project without a second round-trip; null when the
  // approval isn't tied to a task (e.g. a self-hosted host gate). An explicit
  // `?projectId=` narrows server-side.
  router.get('/', async (c) => {
    const tenantId     = c.get('tenantId') as number;
    const statusFilter = c.req.query('status');
    const agentHostFilter   = c.req.query('agentHostId') ? Number(c.req.query('agentHostId')) : null;
    const projectFilterRaw  = c.req.query('projectId');
    const projectFilter     = projectFilterRaw && Number.isInteger(Number(projectFilterRaw))
      ? Number(projectFilterRaw)
      : null;

    let rows = await db
      .select({ ...getTableColumns(approvals), taskId: tasks.id, projectId: tasks.projectId })
      .from(approvals)
      .leftJoin(executions, eq(approvals.executionId, executions.id))
      .leftJoin(tasks, eq(executions.taskId, tasks.id))
      .where(eq(approvals.tenantId, tenantId))
      .orderBy(desc(approvals.createdAt));

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (agentHostFilter != null) rows = rows.filter((r) => r.agentHostId === agentHostFilter);
    if (projectFilter != null) rows = rows.filter((r) => r.projectId === projectFilter);

    return c.json({ approvals: rows });
  });

  // GET /api/approvals/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
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
  router.patch('/:id', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const userId    = c.get('userId') as string;
    const id        = c.req.param('id');
    const env       = c.env;

    const body = await c.req.json<{
      status:        'approved' | 'rejected' | 'answered';
      reviewNote?:   string;
      responseText?: string;
    }>();

    if (body.status !== 'approved' && body.status !== 'rejected' && body.status !== 'answered') {
      return c.json({ error: 'status must be "approved", "rejected", or "answered"' }, 400);
    }
    if (body.status === 'answered' && !body.responseText?.trim()) {
      return c.json({ error: 'responseText is required when answering' }, 400);
    }
    if (body.status !== 'answered' && !isManager(c as never)) {
      return c.json({
        error: `Requires at least '${TenantRole.MANAGER}' role to approve or reject a request`,
      }, 403);
    }

    const [existing] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Approval not found' }, 404);
    if (existing.status !== 'pending') return c.json({ error: 'Request is not pending' }, 409);

    const kind = normalizeRequestKind(existing.kind);
    // Guard kind/status alignment: answerable kinds use 'answered'; approvals use approve/reject.
    if (body.status === 'answered' && !isAnswerableKind(kind)) {
      return c.json({ error: `'answered' is only valid for question/feedback requests` }, 400);
    }
    if (body.status !== 'answered' && isAnswerableKind(kind)) {
      return c.json({ error: `${kind} requests are resolved with status 'answered' + responseText` }, 400);
    }

    const responseText = body.status === 'answered' ? body.responseText!.trim() : null;

    await db
      .update(approvals)
      .set({
        status:       body.status,
        reviewedBy:   userId,
        reviewNote:   body.reviewNote ?? null,
        responseText,
        updatedAt:    new Date(),
      })
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));

    // Resume a paused CLOUD run: a cloud agent's question carries the execution it
    // paused (no agent_host_id). Deliver the answer the same way a steer is — as a
    // pending user turn the loop drains on its next tick — and wake the durable run.
    // (The on-prem relay branch below covers self-hosted agents.)
    if (existing.executionId && responseText) {
      await resumePausedExecution(env, db, {
        executionId: existing.executionId,
        tenantId,
        answer: responseText,
        approvalId: id,
      });
    }

    // Approving a `task.execution` gate must actually START the run — approval only
    // unlocks the gate, so without this the task would sit idle until a human went
    // back to the ticket and clicked Run again. Replay the original submit (stored
    // on the approval) AS the same agent + model. dispatchCloudRunForTask calls
    // runtimeService.submit directly (no gate), so this can't loop. The LLM loop
    // runs in waitUntil; we await setup so the execution exists before responding.
    let startedExecutionId: number | null = null;
    if (body.status === 'approved' && existing.actionType === 'task.execution') {
      const replay = parseApprovalReplay(existing.metadata);
      if (replay) {
        startedExecutionId = await dispatchCloudRunForTask(
          env as Env,
          db,
          runtimeService,
          (p) => c.executionCtx.waitUntil(p),
          {
            taskId: replay.taskId,
            tenantId,
            payload: replay.payload,
            agentHostId: replay.agentHostId,
            submittedBy: existing.requestedBy ?? userId,
          },
        ).catch(() => null);
      }
    }

    // §5.8 — Approvals ↔ sign-offs bridge: a human DECIDING a role-attributed execution
    // gate records that role's sign-off on the accountability ledger, so a human approval
    // satisfies the role/review requirement (and clears the audit) exactly like an agent
    // reviewer's sign-off. Only when the approval carries an explicit roleKey (set at
    // creation for a role-attributed run) — never inferred, so it can't forge a record.
    if (body.status === 'approved' || body.status === 'rejected') {
      const roleKey = parseApprovalRoleKey(existing.metadata);
      const bridgeTaskId = parseApprovalReplay(existing.metadata)?.taskId;
      if (roleKey && bridgeTaskId != null) {
        try {
          const auditSvc = new TicketAuditService(db);
          const memberName = await resolveMemberDisplayName(db, tenantId, 'human', userId);
          await auditSvc.recordSignoff(env, tenantId, {
            taskId: bridgeTaskId,
            roleKey,
            verdict: body.status === 'approved' ? 'approved' : 'changes_requested',
            memberKind: 'human',
            memberRef: userId,
            memberName,
            summary: body.reviewNote ?? (body.status === 'approved' ? 'Approved via human gate' : 'Changes requested via human gate'),
            contribution: existing.executionId ? { executionId: existing.executionId } : undefined,
          });
          const participants = new TicketParticipantsService(db);
          await participants.syncStates(env, tenantId, bridgeTaskId).catch(() => {});
          await participants.invalidate(env, bridgeTaskId).catch(() => {});
          await recordActivity(env, db, {
            tenantId, projectId: null,
            actor: await resolveHumanActor(env, db, tenantId, userId),
            verb: body.status === 'approved' ? 'ticket.role.completed' : 'ticket.signed_off',
            targetType: 'task', targetId: String(bridgeTaskId), targetLabel: `#${bridgeTaskId}`,
            summary: `${roleKey} ${body.status === 'approved' ? 'approved' : 'changes requested'} via human approval`.slice(0, 300),
            metadata: { roleKey, via: 'approval', verdict: body.status },
          }).catch(() => {});
        } catch { /* best-effort bridge — never block the approval resolve */ }
      }
    }

    // Notify the agentHost about the decision via the relay so the blocked gate resumes.
    if (existing.agentHostId && env.AGENT_HOST_RELAY) {
      const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(existing.agentHostId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:         'approval.decision',
          approvalId:   id,
          status:       body.status,
          reviewNote:   body.reviewNote,
          responseText,
          reviewedBy:   userId,
        }),
      })).catch(() => { /* best-effort */ });
    }

    // Slack notification on decision
    if (env.SLACK_APPROVAL_WEBHOOK_URL) {
      const icon = body.status === 'approved' ? ':white_check_mark:' : body.status === 'rejected' ? ':x:' : ':speech_balloon:';
      const verb = body.status === 'answered' ? 'answered' : body.status;
      await sendSlackNotification(
        env.SLACK_APPROVAL_WEBHOOK_URL,
        `${icon} ${kind} *${verb}* by ${userId}\n` +
        `Action: ${existing.actionType} — ${existing.description}` +
        (responseText ? `\nAnswer: ${responseText}` : '') +
        (body.reviewNote ? `\nNote: ${body.reviewNote}` : ''),
      );
    }

    const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
    // startedExecutionId is set when approving a task.execution gate auto-started a
    // run — lets the caller (ticket panel / board) follow the new execution.
    return c.json({ ...row, startedExecutionId });
  });

  return router;
}
