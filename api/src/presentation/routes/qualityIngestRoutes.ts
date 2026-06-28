/**
 * Quality ingest routes — /api/quality-ingest (PUBLIC, no tenant JWT).
 *
 * The inbound edge of the Quality pillar. Three keyed/​signed surfaces, all
 * resolving the owning tenant/project FROM the credential (never the request):
 *   POST /events            native canonical batch — Authorization: Bearer bfq_… (or ?key=)
 *   POST /otlp/v1/logs      OTLP/HTTP JSON logs     — same ingest key
 *   POST /otlp/v1/traces    OTLP/HTTP JSON traces   — same ingest key
 *   POST /webhooks/:sourceId provider webhook       — HMAC-verified against the source secret
 *
 * Every body is run through the source's adapter (adapters.ts) → canonical events
 * → ingestEngine. Mirrors the keyed/JWT split of telemetryRoutes + boardWebhookRoutes.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { errorSources } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { decryptCredentials } from '../../application/integrations/credentialCrypto';
import { getErrorAdapter } from '../../application/quality/adapters';
import { ingestErrorEvents, type IngestSourceRef } from '../../application/quality/ingestEngine';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

interface ResolvedSource extends IngestSourceRef {
  source: string;
  webhookSecretEnc: string | null;
  webhookSecretIv: string | null;
}

/** Pull the ingest key from `Authorization: Bearer <key>` or `?key=`. */
function readIngestKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return c.req.query('key')?.trim() || null;
}

async function resolveSourceByKey(db: Db, key: string): Promise<ResolvedSource | null> {
  const keyHash = await hashSecret(key);
  const [row] = await db
    .select({
      id: errorSources.id, tenantId: errorSources.tenantId, projectId: errorSources.projectId,
      source: errorSources.source, enabled: errorSources.enabled,
      webhookSecretEnc: errorSources.webhookSecretEnc, webhookSecretIv: errorSources.webhookSecretIv,
    })
    .from(errorSources)
    .where(eq(errorSources.keyHash, keyHash))
    .limit(1);
  if (!row || !row.enabled) return null;
  return row as ResolvedSource;
}

export function createQualityIngestRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Shared keyed-ingest handler for native + OTLP. */
  const keyedIngest = (adapterId: string) => async (c: import('hono').Context<HonoEnv>) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const source = await resolveSourceByKey(db, key);
    if (!source) return c.json({ error: 'Invalid ingest key' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const events = getErrorAdapter(adapterId).normalize(body);
    const result = await ingestErrorEvents(db, c.env as Env, source, events);
    return c.json(result, result.capExceeded ? 429 : 202);
  };

  // Native canonical batch (browser SDK + server/compiled code).
  router.post('/events', keyedIngest('native'));

  // OTLP/HTTP JSON — exporters append /v1/logs and /v1/traces to the configured endpoint.
  router.post('/otlp/v1/logs', keyedIngest('otlp'));
  router.post('/otlp/v1/traces', keyedIngest('otlp'));

  // Provider webhook (Sentry/PostHog/LogRocket). Addressed by source id; the raw
  // body is HMAC-verified against the source's decrypted secret before normalize.
  router.post('/webhooks/:sourceId', async (c) => {
    const sourceId = c.req.param('sourceId');
    const [row] = await db
      .select({
        id: errorSources.id, tenantId: errorSources.tenantId, projectId: errorSources.projectId,
        source: errorSources.source, enabled: errorSources.enabled,
        webhookSecretEnc: errorSources.webhookSecretEnc, webhookSecretIv: errorSources.webhookSecretIv,
      })
      .from(errorSources)
      .where(eq(errorSources.id, sourceId))
      .limit(1);
    if (!row || !row.enabled) return c.json({ error: 'Unknown source' }, 404);

    const adapter = getErrorAdapter(row.source);
    const rawBody = await c.req.text();

    // When a secret is configured AND the adapter can verify, the signature must
    // pass. A source with no secret accepts unsigned posts (some providers don't sign).
    if (row.webhookSecretEnc && row.webhookSecretIv && adapter.verify) {
      const secretBlob = await decryptCredentials(
        row.webhookSecretEnc,
        row.webhookSecretIv,
        (c.env.INTEGRATION_ENCRYPTION_SECRET ?? c.env.JWT_SECRET) as string,
        row.tenantId,
      );
      const secret = typeof secretBlob?.secret === 'string' ? secretBlob.secret : '';
      const ok = secret ? await adapter.verify(rawBody, (n) => c.req.header(n), secret) : false;
      if (!ok) return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const events = adapter.normalize(payload);
    const result = await ingestErrorEvents(db, c.env as Env, row as ResolvedSource, events);
    return c.json(result, result.capExceeded ? 429 : 202);
  });

  return router;
}
