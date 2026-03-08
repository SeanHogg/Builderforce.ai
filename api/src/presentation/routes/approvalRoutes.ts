/**
 * Approvals routes – /api/approvals
 *
 * Human-in-the-loop approval gate for destructive / high-risk agent actions.
 *
 * P3-3: Approval Workflow API
 *
 * POST   /api/approvals          Create a pending approval (claw API key auth)
 * GET    /api/approvals          List approvals for tenant (tenant JWT)
 * GET    /api/approvals/:id      Get approval detail (tenant JWT)
 * PATCH  /api/approvals/:id      Accept or reject an approval (tenant JWT, MANAGER+)
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { approvals, coderclawInstances } from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
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

export function createApprovalRoutes(db: Db): Hono<ApprovalHonoEnv> {
  const router = new Hono<ApprovalHonoEnv>();

  // POST /api/approvals – create a pending approval request
  // Claw API key auth (?clawId=&key=) or tenant JWT.
  router.post('/', async (c) => {
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
      metadata?:    unknown;
      expiresAt?:   string;
      requestedBy?: string;
    }>();

    if (!body.actionType || !body.description) {
      return c.json({ error: 'actionType and description are required' }, 400);
    }

    const approvalId = crypto.randomUUID();
    const now = new Date();

    await db.insert(approvals).values({
      id:          approvalId,
      tenantId,
      clawId:      resolvedClawId,
      requestedBy: body.requestedBy ?? (resolvedClawId ? String(resolvedClawId) : null),
      actionType:  body.actionType,
      description: body.description,
      metadata:    body.metadata != null ? JSON.stringify(body.metadata) : null,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
      createdAt:   now,
      updatedAt:   now,
    });

    // Notify connected browser clients via the relay if clawId is known
    if (resolvedClawId && c.env.CLAW_RELAY) {
      const stub = c.env.CLAW_RELAY.get(c.env.CLAW_RELAY.idFromName(String(resolvedClawId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        'approval.request',
          approvalId,
          actionType:  body.actionType,
          description: body.description,
          expiresAt:   body.expiresAt,
        }),
      })).catch(() => { /* best-effort */ });
    }

    return c.json({ approvalId }, 201);
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

    const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
    return c.json(row);
  });

  return router;
}
