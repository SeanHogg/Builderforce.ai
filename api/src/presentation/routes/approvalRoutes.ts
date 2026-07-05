/**
 * Approvals routes – /api/approvals
 *
 * Human-in-the-loop approval gate for destructive / high-risk agent actions.
 *
 * POST   /api/approvals          Create a pending approval (agentHost API key auth)
 * GET    /api/approvals          List approvals for tenant (tenant JWT)
 * GET    /api/approvals/:id      Get approval detail (tenant JWT)
 * PATCH  /api/approvals/:id      Accept or reject an approval (tenant JWT, MANAGER+)
 * GET    /api/approvals/escalate  Expire timed-out pending approvals + re-notify (internal/cron)
 */
import { Hono } from 'hono';
import { eq, and, desc, lt, getTableColumns } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { approvals, executions, tasks } from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import { checkAutoApprovalRules } from './approvalRuleRoutes';
import { normalizeRequestKind, isAnswerableKind } from '../../domain/approval/requestKind';
import { sendSlackNotification, notifyApprovalRequested } from '../../application/approval/approvalNotifier';
import { resumePausedExecution } from '../../application/runtime/executionResume';
import { dispatchCloudRunForTask, parseApprovalReplay } from './runtimeRoutes';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

type ApprovalHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY: DurableObjectNamespace<AgentHostRelayDO>;
  };
};

// Slack/email fan-out + manager-email lookup live in the shared approvalNotifier
// so the cloud `ask_human` path notifies identically — see imports above.

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createApprovalRoutes(db: Db, runtimeService: RuntimeService): Hono<ApprovalHonoEnv> {
  const router = new Hono<ApprovalHonoEnv>();

  // ── GET /api/approvals/escalate ─────────────────────────────────────────
  // Intended to be called by a Cloudflare Cron Trigger (or an admin endpoint).
  // Finds all pending approvals whose expiresAt has passed, marks them expired,
  // and sends a Slack/email escalation alert.
  // Auth: CRON_SECRET query param (or open for Cloudflare cron if secured at CF level)
  router.get('/escalate', async (c) => {
    const env = c.env;
    const secret = c.req.query('secret');
    if (secret !== env.CRON_SECRET && env.CRON_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const now = new Date();
    const expired = await db
      .select()
      .from(approvals)
      .where(and(
        eq(approvals.status, 'pending'),
        lt(approvals.expiresAt, now),
      ));

    if (expired.length === 0) return c.json({ escalated: 0 });

    const ids = expired.map((a) => a.id);
    await db
      .update(approvals)
      .set({ status: 'expired', updatedAt: now })
      .where(and(
        eq(approvals.status, 'pending'),
        lt(approvals.expiresAt, now),
      ));

    // Group by tenant for notifications
    const byTenant = new Map<number, typeof expired>();
    for (const a of expired) {
      const list = byTenant.get(a.tenantId) ?? [];
      list.push(a);
      byTenant.set(a.tenantId, list);
    }

    if (env.SLACK_APPROVAL_WEBHOOK_URL) {
      for (const [, list] of byTenant) {
        const lines = list.map((a) => `• *${a.actionType}* — ${a.description}`).join('\n');
        await sendSlackNotification(
          env.SLACK_APPROVAL_WEBHOOK_URL,
          `:warning: *${list.length} approval request(s) expired without review:*\n${lines}`,
        );
      }
    }

    return c.json({ escalated: expired.length, ids });
  });

  // POST /api/approvals – create a pending approval request
  // AgentHost API key auth (?agentHostId=&key=) or tenant JWT.
  router.post('/', async (c) => {
    const env = c.env;
    let tenantId: number;
    let resolvedAgentHostId: number | null = null;

    const agentHostIdParam = Number(c.req.query('agentHostId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(agentHostIdParam) && agentHostIdParam > 0 && apiKey) {
      const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey);
      if (!agentHost) return c.text('Unauthorized', 401);
      tenantId = agentHost.tenantId;
      resolvedAgentHostId = agentHost.id;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
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

  // All read/update routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/approvals?status=&agentHostId=&projectId=
  // Each row is enriched with `projectId` (via execution → task) so the caller can
  // scope/group the queue by project without a second round-trip; null when the
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
      .select({ ...getTableColumns(approvals), projectId: tasks.projectId })
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
  //   approval kind  → status 'approved' | 'rejected'
  //   question/feedback kind → status 'answered' with a free-text responseText
  router.patch('/:id', async (c) => {
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
