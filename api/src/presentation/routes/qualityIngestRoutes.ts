/**
 * Quality ingest routes — /api/quality-ingest (PUBLIC, no tenant JWT).
 *
 * The inbound edge of the Quality pillar. Every channel resolves a COLLECTOR (not
 * the request) and ingests through it; a project collector lands events straight
 * in its project, a tenant-level collector routes each event via its mapping rules:
 *   POST /events                       native canonical batch — Bearer bfq_… (or ?key=)
 *   POST /otlp/v1/{logs,traces}        OTLP/HTTP (protobuf or JSON) — same key
 *   POST /webhooks/:collectorId/:provider  provider webhook — HMAC-verified per integration
 *
 * Bodies run through the source adapter (adapters.ts) → canonical events → ingestEngine.
 */

import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { errorCollectors, errorCollectorIntegrations, errorMappingRules } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { decryptCredentials } from '../../application/integrations/credentialCrypto';
import { getErrorAdapter } from '../../application/quality/adapters';
import { otlpLogsToJson, otlpTracesToJson } from '../../application/quality/otlpProtobuf';
import { ingestErrorEvents } from '../../application/quality/ingestEngine';
import type { CollectorRef, MappingRule } from '../../application/quality/errorMapping';
import type { NormalizedErrorEvent } from '../../application/quality/errorSpec';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Pull the ingest key from `Authorization: Bearer <key>` or `?key=`. */
function readIngestKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return c.req.query('key')?.trim() || null;
}

async function resolveCollectorByKey(db: Db, key: string): Promise<CollectorRef | null> {
  const keyHash = await hashSecret(key);
  const [row] = await db
    .select({
      id: errorCollectors.id, tenantId: errorCollectors.tenantId, projectId: errorCollectors.projectId,
      defaultProjectId: errorCollectors.defaultProjectId, enabled: errorCollectors.enabled,
    })
    .from(errorCollectors)
    .where(eq(errorCollectors.keyHash, keyHash))
    .limit(1);
  if (!row || !row.enabled) return null;
  return { id: row.id, tenantId: row.tenantId, projectId: row.projectId, defaultProjectId: row.defaultProjectId };
}

/** Mapping rules (priority asc) — only a tenant-level collector needs them. */
async function loadRulesIfTenant(db: Db, collector: CollectorRef): Promise<MappingRule[]> {
  if (collector.projectId != null) return [];
  return db
    .select({
      matchField: errorMappingRules.matchField, matchOp: errorMappingRules.matchOp,
      matchValue: errorMappingRules.matchValue, projectId: errorMappingRules.projectId,
      priority: errorMappingRules.priority,
    })
    .from(errorMappingRules)
    .where(eq(errorMappingRules.collectorId, collector.id))
    .orderBy(asc(errorMappingRules.priority));
}

/** Ingest a normalized batch through a collector (loads mapping rules as needed). */
async function ingestForCollector(db: Db, env: Env, collector: CollectorRef, events: NormalizedErrorEvent[]) {
  const rules = await loadRulesIfTenant(db, collector);
  return ingestErrorEvents(db, env, collector, events, rules);
}

export function createQualityIngestRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Keyed native ingest (browser SDK + server/compiled code). */
  router.post('/events', async (c) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const collector = await resolveCollectorByKey(db, key);
    if (!collector) return c.json({ error: 'Invalid ingest key' }, 401);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const events = getErrorAdapter('native').normalize(body);
    const result = await ingestForCollector(db, c.env as Env, collector, events);
    return c.json(result, result.capExceeded ? 429 : 202);
  });

  /**
   * OTLP/HTTP — exporters append /v1/logs and /v1/traces. Accepts the default
   * `application/x-protobuf` (our dependency-free reader) AND `application/json`;
   * both reshape to the OTLP JSON the otlp adapter consumes.
   */
  const otlpIngest = (kind: 'logs' | 'traces') => async (c: import('hono').Context<HonoEnv>) => {
    const key = readIngestKey(c);
    if (!key) return c.json({ error: 'Missing ingest key' }, 401);
    const collector = await resolveCollectorByKey(db, key);
    if (!collector) return c.json({ error: 'Invalid ingest key' }, 401);

    const contentType = (c.req.header('Content-Type') ?? '').toLowerCase();
    let otlpJson: unknown;
    try {
      if (contentType.includes('protobuf')) {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        otlpJson = kind === 'logs' ? otlpLogsToJson(bytes) : otlpTracesToJson(bytes);
      } else {
        otlpJson = await c.req.json();
      }
    } catch {
      return c.json({ error: 'Invalid OTLP body' }, 400);
    }

    const events = getErrorAdapter('otlp').normalize(otlpJson);
    const result = await ingestForCollector(db, c.env as Env, collector, events);
    return c.json(result, result.capExceeded ? 429 : 202);
  };

  router.post('/otlp/v1/logs', otlpIngest('logs'));
  router.post('/otlp/v1/traces', otlpIngest('traces'));

  /**
   * Provider webhook — addressed by collector + provider. The raw body is
   * HMAC-verified against the integration's decrypted secret (when configured)
   * before the provider adapter normalizes it.
   */
  router.post('/webhooks/:collectorId/:provider', async (c) => {
    const collectorId = c.req.param('collectorId');
    const provider = c.req.param('provider');

    const [col] = await db
      .select({
        id: errorCollectors.id, tenantId: errorCollectors.tenantId, projectId: errorCollectors.projectId,
        defaultProjectId: errorCollectors.defaultProjectId, enabled: errorCollectors.enabled,
      })
      .from(errorCollectors)
      .where(eq(errorCollectors.id, collectorId))
      .limit(1);
    if (!col || !col.enabled) return c.json({ error: 'Unknown collector' }, 404);

    let adapter;
    try { adapter = getErrorAdapter(provider); } catch { return c.json({ error: 'Unknown provider' }, 404); }

    const [integration] = await db
      .select({ secretEnc: errorCollectorIntegrations.secretEnc, secretIv: errorCollectorIntegrations.secretIv })
      .from(errorCollectorIntegrations)
      .where(and(eq(errorCollectorIntegrations.collectorId, collectorId), eq(errorCollectorIntegrations.provider, provider)))
      .limit(1);
    if (!integration) return c.json({ error: 'Provider not connected to this collector' }, 404);

    const rawBody = await c.req.text();

    // When a secret is configured AND the adapter can verify, the signature must
    // pass. An integration with no secret accepts unsigned posts (some providers
    // don't sign).
    if (integration.secretEnc && integration.secretIv && adapter.verify) {
      const blob = await decryptCredentials(
        integration.secretEnc, integration.secretIv,
        (c.env.INTEGRATION_ENCRYPTION_SECRET ?? c.env.JWT_SECRET) as string, col.tenantId,
      );
      const secret = typeof blob?.secret === 'string' ? blob.secret : '';
      const ok = secret ? await adapter.verify(rawBody, (n) => c.req.header(n), secret) : false;
      if (!ok) return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const collector: CollectorRef = { id: col.id, tenantId: col.tenantId, projectId: col.projectId, defaultProjectId: col.defaultProjectId };
    const events = adapter.normalize(payload);
    const result = await ingestForCollector(db, c.env as Env, collector, events);
    return c.json(result, result.capExceeded ? 429 : 202);
  });

  return router;
}
