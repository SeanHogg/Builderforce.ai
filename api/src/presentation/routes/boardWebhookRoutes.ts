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
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { SyncEngine, type StoredConnection } from '../../application/boardsync/SyncEngine';
import { createDrizzleStore, loadConnectionCredentials } from '../../application/boardsync/drizzleStore';
import { createBoardProvider, type NormalizedTicket } from '../../application/boardsync/providers';
import { hashFields } from '../../application/boardsync/reconciler';
import { verifyProviderWebhookSignature, normalizeWebhookPayload } from '../../application/boardsync/webhookIngest';
import { getBoardProviderMeta } from '../../application/boardsync/providerCatalog';
import { ingestIncidentWebhook } from '../../application/boardsync/opsIngest';

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

    // monday.com subscription handshake: an unsigned { challenge } POST that must
    // be echoed verbatim to activate the webhook. No signature on this one event.
    if (provider === 'monday') {
      try {
        const probe = JSON.parse(rawBody) as { challenge?: unknown };
        if (probe && typeof probe.challenge === 'string') {
          return c.json({ challenge: probe.challenge });
        }
      } catch {
        /* fall through to normal signed handling */
      }
    }

    // Provider-aware signature verification (each provider signs differently;
    // trust is the per-connection webhook_secret in every case).
    const valid = await verifyProviderWebhookSignature(provider, rawBody, (n) => c.req.header(n), conn.webhookSecret);
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

    // Ops events (Sentry/PagerDuty = `incident` category) are NOT kanban tickets:
    // divert them into prod_incidents (the Quality lens) instead of the task board.
    if (getBoardProviderMeta(provider)?.category === 'incident') {
      try {
        const id = await ingestIncidentWebhook(db, c.env, conn, provider, normalized);
        return c.json({ received: true, processed: true, decision: 'incident', incidentId: id }, 200);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'incident ingest failed' }, 500);
      }
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

    const store = createDrizzleStore(db, c.env as Env);
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
