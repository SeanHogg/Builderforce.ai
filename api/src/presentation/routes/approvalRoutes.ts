/**
 * Approvals routes – /api/approvals
 *
 * Human-in-the-loop approval gate for destructive / high-risk agent actions.
 *
 * POST   /api/approvals          Create a pending approval (claw API key auth)
 * GET    /api/approvals          List approvals for tenant (tenant JWT)
 * GET    /api/approvals/:id      Get approval detail (tenant JWT)
 * PATCH  /api/approvals/:id      Accept or reject an approval (tenant JWT, MANAGER+)
 * GET    /api/approvals/escalate  Expire timed-out pending approvals + re-notify (internal/cron)
 */
import { Hono } from 'hono';
import { eq, and, desc, lt, or } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { approvals, coderclawInstances, tenantMembers, users } from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
import { checkAutoApprovalRules } from './approvalRuleRoutes';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ClawRelayDO } from '../../infrastructure/relay/ClawRelayDO';

type ApprovalHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    CLAW_RELAY: DurableObjectNamespace<ClawRelayDO>;
  };
};

async function verifyClawApiKey(db: Db, id: number, key?: string | null): Promise<{ id: number; tenantId: number } | null> {
  if (!key) return null;
  const [claw] = await db
    .select({ id: coderclawInstances.id, tenantId: coderclawInstances.tenantId, apiKeyHash: coderclawInstances.apiKeyHash })
    .from(coderclawInstances)
    .where(eq(coderclawInstances.id, id));
  if (!claw) return null;
  const valid = await verifySecret(key, claw.apiKeyHash);
  return valid ? claw : null;
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

async function sendSlackNotification(webhookUrl: string, text: string): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => { /* best-effort */ });
}

async function sendEmailNotification(
  apiKey: string,
  from: string,
  to: string[],
  subject: string,
  html: string,
): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch(() => { /* best-effort */ });
}

/** Collect manager email addresses for the tenant to use as notification recipients. */
async function getManagerEmails(db: Db, tenantId: number): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.isActive, true),
      or(
        eq(tenantMembers.role, 'manager'),
        eq(tenantMembers.role, 'owner'),
      ),
    ));
  return rows.map((r) => r.email);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createApprovalRoutes(db: Db): Hono<ApprovalHonoEnv> {
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
  // Claw API key auth (?clawId=&key=) or tenant JWT.
  router.post('/', async (c) => {
    const env = c.env;
    let tenantId: number;
    let resolvedClawId: number | null = null;

    const clawIdParam = Number(c.req.query('clawId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(clawIdParam) && clawIdParam > 0 && apiKey) {
      const claw = await verifyClawApiKey(db, clawIdParam, apiKey);
      if (!claw) return c.text('Unauthorized', 401);
      tenantId = claw.tenantId;
      resolvedClawId = claw.id;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    const body = await c.req.json<{
      actionType:   string;
      description:  string;
      metadata?:    Record<string, unknown>;
      expiresAt?:   string;
      requestedBy?: string;
    }>();

    if (!body.actionType || !body.description) {
      return c.json({ error: 'actionType and description are required' }, 400);
    }

    // ── Auto-approval check ──────────────────────────────────────────────────
    const autoApproved = await checkAutoApprovalRules(
      db, tenantId, body.actionType, body.metadata ?? null,
    );

    const approvalId = crypto.randomUUID();
    const now = new Date();
    const status = autoApproved ? 'approved' : 'pending';

    await db.insert(approvals).values({
      id:          approvalId,
      tenantId,
      clawId:      resolvedClawId,
      requestedBy: body.requestedBy ?? (resolvedClawId ? String(resolvedClawId) : null),
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

    // Notify connected browser clients via the relay if clawId is known
    if (resolvedClawId && env.CLAW_RELAY) {
      const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(resolvedClawId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        autoApproved ? 'approval.auto_approved' : 'approval.request',
          approvalId,
          actionType:  body.actionType,
          description: body.description,
          expiresAt:   body.expiresAt,
          status,
        }),
      })).catch(() => { /* best-effort */ });
    }

    // Slack notification for new pending approvals (skip if auto-approved)
    if (!autoApproved && env.SLACK_APPROVAL_WEBHOOK_URL) {
      await sendSlackNotification(
        env.SLACK_APPROVAL_WEBHOOK_URL,
        `:bell: *New approval request* (${body.actionType})\n${body.description}\n` +
        `Approve or reject at: ${env.APP_URL ?? 'https://builderforce.ai'}/approvals/${approvalId}`,
      );
    }

    // Email notification for new pending approvals
    if (!autoApproved && env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
      const emails = await getManagerEmails(db, tenantId);
      if (emails.length > 0) {
        const subject = `[Builderforce] Approval required: ${body.actionType}`;
        const html = `<p>A new approval request requires your attention.</p>
<ul>
  <li><strong>Action:</strong> ${body.actionType}</li>
  <li><strong>Description:</strong> ${body.description}</li>
</ul>
<p><a href="${env.APP_URL ?? 'https://builderforce.ai'}/approvals/${approvalId}">Review approval</a></p>`;
        await sendEmailNotification(env.RESEND_API_KEY, env.NOTIFICATION_EMAIL_FROM, emails, subject, html);
      }
    }

    return c.json({ approvalId, status }, 201);
  });

  // All read/update routes require tenant JWT
  router.use('*', authMiddleware);

  // GET /api/approvals?status=&clawId=
  router.get('/', async (c) => {
    const tenantId     = c.get('tenantId') as number;
    const statusFilter = c.req.query('status');
    const clawFilter   = c.req.query('clawId') ? Number(c.req.query('clawId')) : null;

    let rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.tenantId, tenantId))
      .orderBy(desc(approvals.createdAt));

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (clawFilter != null) rows = rows.filter((r) => r.clawId === clawFilter);

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

  // PATCH /api/approvals/:id – approve or reject
  router.patch('/:id', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const userId    = c.get('userId') as string;
    const id        = c.req.param('id');
    const env       = c.env;

    const body = await c.req.json<{
      status:      'approved' | 'rejected';
      reviewNote?: string;
    }>();

    if (body.status !== 'approved' && body.status !== 'rejected') {
      return c.json({ error: 'status must be "approved" or "rejected"' }, 400);
    }

    const [existing] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Approval not found' }, 404);
    if (existing.status !== 'pending') return c.json({ error: 'Approval is not pending' }, 409);

    await db
      .update(approvals)
      .set({
        status:     body.status,
        reviewedBy: userId,
        reviewNote: body.reviewNote ?? null,
        updatedAt:  new Date(),
      })
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));

    // Notify the claw about the decision via the relay
    if (existing.clawId && env.CLAW_RELAY) {
      const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(existing.clawId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        'approval.decision',
          approvalId:  id,
          status:      body.status,
          reviewNote:  body.reviewNote,
          reviewedBy:  userId,
        }),
      })).catch(() => { /* best-effort */ });
    }

    // Slack notification on decision
    if (env.SLACK_APPROVAL_WEBHOOK_URL) {
      const icon = body.status === 'approved' ? ':white_check_mark:' : ':x:';
      await sendSlackNotification(
        env.SLACK_APPROVAL_WEBHOOK_URL,
        `${icon} Approval *${body.status}* by ${userId}\n` +
        `Action: ${existing.actionType} — ${existing.description}` +
        (body.reviewNote ? `\nNote: ${body.reviewNote}` : ''),
      );
    }

    const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
    return c.json(row);
  });

  return router;
}
