/**
 * Board webhook routes — /api/board-webhooks
 *
 * Inbound webhook ingest for an external board connection. HMAC-SHA256 is
 * verified against board_connections.webhook_secret (mirrors the GitHub webhook
 * verification in githubWebhookRoutes), then the payload is normalized and run
 * through the same reconcile path the polling SyncEngine uses.
 *
 * POST /api/board-webhooks/:provider/:connectionId
 *
 * No tenant auth middleware here: callers are external providers. Trust is
 * established by the per-connection webhook secret, and tenantId is taken from
 * the connection row (never from the request).
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { boardConnections } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { SyncEngine, type StoredConnection } from '../../application/boardsync/SyncEngine';
import { createDrizzleStore, loadConnectionCredentials } from '../../application/boardsync/drizzleStore';
import { createBoardProvider, type NormalizedTicket } from '../../application/boardsync/providers';
import { hashFields } from '../../application/boardsync/reconciler';
import { verifyWebhookSignature, normalizeWebhookPayload } from '../../application/boardsync/webhookIngest';

export function createBoardWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /:provider/:connectionId
  router.post('/:provider/:connectionId', async (c) => {
    const provider = c.req.param('provider');
    const connectionId = c.req.param('connectionId');

    const [conn] = await db
      .select()
      .from(boardConnections)
      .where(eq(boardConnections.id, connectionId))
      .limit(1);
    if (!conn) return c.json({ error: 'Connection not found' }, 404);
    if (conn.provider !== provider) {
      return c.json({ error: 'provider mismatch' }, 400);
    }
    if (!conn.webhookEnabled || !conn.webhookSecret) {
      return c.json({ received: true, processed: false, reason: 'webhook not enabled for this connection' });
    }

    // Read raw body BEFORE parsing — needed for HMAC.
    const rawBody = await c.req.text();
    const sigHeader =
      c.req.header('X-Hub-Signature-256') ??
      c.req.header('X-Board-Signature-256') ??
      c.req.header('X-Signature-256') ??
      '';

    const valid = await verifyWebhookSignature(rawBody, sigHeader, conn.webhookSecret);
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const normalized = normalizeWebhookPayload(provider, payload);
    if (!normalized) {
      return c.json({ received: true, processed: false, reason: 'event carried no actionable ticket' });
    }

    const ticket: NormalizedTicket = {
      externalId: normalized.externalId,
      externalUrl: normalized.externalUrl,
      externalVersion: normalized.externalVersion,
      title: normalized.title,
      body: normalized.body,
      state: normalized.state,
      source: provider,
      contentHash: hashFields(normalized.fields),
      fields: normalized.fields,
    };

    const secret = c.env.INTEGRATION_ENCRYPTION_SECRET ?? c.env.JWT_SECRET;
    const loaded = await loadConnectionCredentials(db, conn.tenantId, conn.credentialId, secret);
    const credentials = loaded?.credentials ?? {};
    const baseUrl = loaded?.baseUrl ?? null;

    const store = createDrizzleStore(db);
    const engine = new SyncEngine(store, (sc: StoredConnection) =>
      createBoardProvider(
        sc.provider,
        { credentials, baseUrl, externalBoardId: conn.externalBoardId },
        fetch,
      ),
    );

    const storedConn: StoredConnection = {
      id: conn.id,
      tenantId: conn.tenantId,
      segmentId: conn.segmentId,
      projectId: conn.projectId,
      provider: conn.provider,
      pollCursor: conn.pollCursor,
    };

    try {
      const decision = await engine.applyInboundTicket(storedConn, ticket, normalized.originatedLocally);
      return c.json({ received: true, processed: true, decision: decision.decision, reason: decision.reason }, 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'ingest failed' }, 500);
    }
  });

  return router;
}
