/**
 * Public workflow trigger entrypoints — /api/workflow-triggers
 *
 * No JWT: these are addressed by the random per-trigger `token` minted on save.
 *
 *   POST /api/workflow-triggers/hook/:token   Webhook trigger — fires the owning
 *       workflow with the request body as payload. If the trigger has a signing
 *       secret, the request must carry a matching `X-Signature: sha256=<hex>`
 *       HMAC of the raw body (same scheme as the GitHub webhook route).
 *
 * Inbound-email triggers are addressed by the same token (the inbox local-part)
 * and dispatched by the Worker `email()` handler via `handleInboundEmail`, which
 * shares the firing path below.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { workflowDefinitions, workflowTriggers } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import { instantiateWorkflowRun, type RunTarget } from '../../application/workflow/instantiateRun';
import { verifyHmacSignature } from '../../application/workflow/verifySignature';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Build the run target a trigger row fires onto. */
function targetFromTrigger(row: typeof workflowTriggers.$inferSelect): RunTarget {
  return row.runtime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: row.cloudAgentRef }
    : { runtime: 'host', agentHostId: row.agentHostId };
}

/**
 * Fire the workflow behind an addressed (webhook / inbound-email) trigger.
 * Shared by the HTTP route and the inbound-email handler.
 */
export async function fireAddressedTrigger(
  db: Db,
  row: typeof workflowTriggers.$inferSelect,
  payload: unknown,
  source: string,
): Promise<{ ok: true; workflowId: string } | { ok: false; error: string }> {
  const [defRow] = await db
    .select({ name: workflowDefinitions.name, projectId: workflowDefinitions.projectId, definition: workflowDefinitions.definition })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, row.definitionId), eq(workflowDefinitions.tenantId, row.tenantId)));
  if (!defRow) return { ok: false, error: 'workflow definition not found' };

  const result = await instantiateWorkflowRun(db, {
    tenantId: row.tenantId,
    segmentId: row.segmentId,
    definition: parseDefinition(defRow.definition),
    name: defRow.name,
    projectId: defRow.projectId,
    target: targetFromTrigger(row),
    triggerPayload: payload,
    triggerSource: source,
  });

  await db
    .update(workflowTriggers)
    .set({
      lastRunAt: new Date(),
      lastStatus: (result.ok ? `ok: ${result.workflowId}` : `error: ${result.error}`).slice(0, 32),
      updatedAt: new Date(),
    })
    .where(eq(workflowTriggers.id, row.id));

  return result.ok ? { ok: true, workflowId: result.workflowId } : { ok: false, error: result.error };
}

export function createWorkflowTriggerRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/hook/:token', async (c) => {
    const token = c.req.param('token');
    const [row] = await db.select().from(workflowTriggers).where(eq(workflowTriggers.token, token));
    if (!row || !row.enabled || row.triggerType !== 'webhook') {
      return c.json({ error: 'Unknown or disabled webhook' }, 404);
    }

    // Read the raw body once: needed for HMAC verification AND as the payload.
    const rawBody = await c.req.text();
    if (row.secret) {
      const sig = c.req.header('X-Signature') ?? c.req.header('x-signature') ?? '';
      const valid = await verifyHmacSignature(rawBody, sig, row.secret);
      if (!valid) return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: unknown = rawBody;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      /* non-JSON body — pass the raw string through as payload */
    }

    const result = await fireAddressedTrigger(db, row, payload, `webhook:${row.nodeId}`);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, workflowId: result.workflowId }, 202);
  });

  return router;
}
