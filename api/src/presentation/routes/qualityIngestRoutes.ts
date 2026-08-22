/**
 * Quality ingest routes — /api/quality-ingest (PUBLIC, no tenant JWT).
 *
 * The inbound edge of the Quality pillar. Every channel resolves a COLLECTOR (not
 * the request) and ingests through it; a project collector lands events straight
 * in its project, a tenant-level collector routes each event via its mapping rules:
 *   POST /events                       native canonical batch — Bearer bfq_… (or ?key=)
 *   POST /product-report               BuilderForce.ai's own UI errors (anonymous)
 *   POST /client-report                agent-runtime / VSIX crashes — agent-host key or tenant JWT
 *   POST /otlp/v1/{logs,traces}        OTLP/HTTP (protobuf or JSON) — same key
 *   POST /webhooks/:collectorId/:provider  provider webhook — HMAC-verified per integration
 *
 * Bodies run through the source adapter (adapters.ts) → canonical events → ingestEngine.
 */

import { Hono } from 'hono';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { errorCollectors, errorCollectorIntegrations, errorMappingRules, projects } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { decryptCredentials } from '../../application/integrations/credentialCrypto';
import { getErrorAdapter } from '../../application/quality/adapters';
import { otlpLogsToJson, otlpTracesToJson } from '../../application/quality/otlpProtobuf';
import { ingestErrorEvents } from '../../application/quality/ingestEngine';
import { parseClientErrorReport, resolveClientReportCollector } from '../../application/quality/clientErrorReport';
import { resolveCallerTenant } from '../middleware/callerTenant';
import type { CollectorRef, MappingRule } from '../../application/quality/errorMapping';
import type { NormalizedErrorEvent } from '../../application/quality/errorSpec';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { recordVisitorEvent } from '../../application/marketing/VisitorEventService';
import { isValidVisitorId } from '../../application/marketing/MarketingService';
import { VISITOR_JOURNEY_KINDS } from '../../domain/marketing/VisitorJourney';

/** Pull the ingest key from `Authorization: Bearer <key>` or `?key=`. */
function readIngestKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return c.req.query('key')?.trim() || null;
}

/**
 * Resolve the collector a raw ingest key belongs to.
 *
 * Accepts the CURRENT key, or a rotated-out key whose grace window is still open
 * (QUAL-7). The grace window exists because an ingest key lives inside software
 * that is already deployed — a browser bundle, a container image, an OTLP
 * exporter config — so a rotation that took effect instantly would silently drop
 * every event from every one of them until each redeploys, which is the failure
 * mode that makes operators never rotate at all.
 *
 * The expiry is a PREDICATE on this read, not a swept column: an expired grace
 * hash simply stops matching, so no cron has to run for the old key to die, and
 * a sweep that failed to run could never leave a retired key working.
 */
async function resolveCollectorByKey(db: Db, key: string): Promise<CollectorRef | null> {
  const keyHash = await hashSecret(key);
  const [row] = await db
    .select({
      id: errorCollectors.id, tenantId: errorCollectors.tenantId, projectId: errorCollectors.projectId,
      defaultProjectId: errorCollectors.defaultProjectId, enabled: errorCollectors.enabled,
    })
    .from(errorCollectors)
    .where(or(
      eq(errorCollectors.keyHash, keyHash),
      and(
        eq(errorCollectors.previousKeyHash, keyHash),
        gt(errorCollectors.previousKeyExpiresAt, new Date()),
      ),
    ))
    .limit(1);
  if (!row || !row.enabled) return null;
  return { id: row.id, tenantId: row.tenantId, projectId: row.projectId, defaultProjectId: row.defaultProjectId };
}

/** Mapping rules (priority asc) — only a tenant-level collector needs them. */
async function loadRulesIfTenant(db: Db, collector: CollectorRef): Promise<MappingRule[]> {
  if (collector.projectId != null) return [];
  // A collector-less source (id: null) has no collector to load mapping rules for.
  if (collector.id == null) return [];
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

/**
 * How each product-reporter surface lands in the Quality feed, as DATA.
 *
 * The mapping used to be a pair of ternaries over "is it manual", which is fine
 * for two reporters and wrong for three — adding the error boundaries meant
 * either another branch in each expression or a crash filed as an API error.
 * A new reporter is a row here.
 */
const PRODUCT_REPORT_SOURCES = {
  manual:         { type: 'UserReportedError', environment: 'user-report' },
  'api-client':   { type: 'ApiError',          environment: 'product-ui' },
  'render-crash': { type: 'RenderCrash',       environment: 'product-ui' },
} as const satisfies Record<string, { type: string; environment: string }>;

export function createQualityIngestRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * BuilderForce.ai's product reporter. Its destination is a product invariant,
   * resolved here instead of accepted from the browser. This keeps the endpoint
   * usable before sign-in and prevents reports from being routed to customer
   * projects. An exact-name lookup is deliberate: fail closed if the canonical
   * project is missing or duplicated rather than guessing a destination.
   */
  router.post('/product-report', async (c) => {
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    if (declaredLength > 32_768) return c.json({ error: 'Report is too large' }, 413);

    const rawBody = await c.req.text();
    if (rawBody.length > 32_768) return c.json({ error: 'Report is too large' }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 10_000) : '';
    if (!message) return c.json({ error: 'message is required' }, 400);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
    const source = body.source === 'api-client' || body.source === 'render-crash'
      ? body.source
      : 'manual';
    // The opaque marketing visitor id, when the browser had one. Never trusted for
    // anything but correlation — it grants no access and identifies no account.
    const visitorId = typeof body.visitorId === 'string' ? body.visitorId : null;
    const level: NormalizedErrorEvent['level'] =
      body.level === 'fatal' || body.level === 'warning' || body.level === 'info' ? body.level : 'error';

    const matches = await db
      .select({ id: projects.id, tenantId: projects.tenantId })
      .from(projects)
      .where(sql`lower(${projects.name}) = 'builderforce.ai'`)
      .limit(2);
    if (matches.length !== 1) return c.json({ error: 'Product error project is unavailable' }, 503);
    const project = matches[0]!;

    const reporter = PRODUCT_REPORT_SOURCES[source];
    const event: NormalizedErrorEvent = {
      type: reporter.type,
      message: title ? `${title} — ${message}` : message,
      level,
      timestamp: new Date().toISOString(),
      environment: reporter.environment,
      source: 'native',
      ...(typeof body.url === 'string' ? { url: body.url.slice(0, 2_048) } : {}),
      tags: { reporter: source },
      context: {
        manual: source === 'manual',
        reporter: source,
        ...(body.context && typeof body.context === 'object' && !Array.isArray(body.context)
          ? body.context as Record<string, unknown>
          : {}),
      },
    };
    const collector: CollectorRef = {
      id: null,
      tenantId: project.tenantId,
      projectId: project.id,
      defaultProjectId: null,
    };
    const result = await ingestErrorEvents(db, c.env as Env, collector, [event]);
    if (result.capExceeded) return c.json({ error: 'Monthly error event limit reached', ...result }, 429);
    if (result.accepted !== 1) return c.json({ error: 'Could not record the report', ...result }, 422);

    // ── The error also belongs on the VISITOR'S timeline ──────────────────────
    // Until this existed, an anonymous visitor's error went into Product Quality
    // with nothing on it that identified the session it happened in: the report
    // said "a TypeError happened on /pricing", and the question anyone actually
    // asks — "which visitors hit this, and did they leave afterwards" — had no
    // answer at all. Writing the same fact onto the journey stream puts the error
    // between the page before it and whatever the visitor did next.
    //
    // Deferred through waitUntil: a report is telemetry, and its second write
    // must not add latency to the first. Best-effort by the same logic — a lost
    // journey row must never turn a recorded error into a 500.
    if (isValidVisitorId(visitorId)) {
      c.executionCtx.waitUntil(
        recordVisitorEvent(db, c.env as Env, {
          visitorId,
          visitId: body.visitId,
          kind: VISITOR_JOURNEY_KINDS.error,
          path: typeof body.url === 'string' ? new URL(body.url, 'https://builderforce.ai').pathname : null,
          occurredAt: event.timestamp,
          metadata: { title, reporter: source, level },
        }).catch((error) => reportCaughtError(error, {
          source: 'presentation/routes/qualityIngestRoutes.ts',
          operation: 'product-report visitor journey',
          level: 'warning',
          context: { visitorId },
        })),
      );
    }

    return c.json({ ok: true, ...result }, 202);
  });

  /**
   * The on-prem runtime's and the VS Code extension's door into the SAME store.
   *
   * Neither ships an ingest key — they hold the credential they were already
   * given when the workspace was linked — so this door authenticates the
   * CALLER and derives the collector, where `/events` authenticates the COLLECTOR
   * itself. Everything after that is the shared pipeline: the same canonical
   * events, the same grouping, the same monthly cap.
   */
  router.post('/client-report', async (c) => {
    const caller = await resolveCallerTenant(db, c);
    if (!caller) return c.json({ error: 'Invalid or missing credential' }, 401);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const parsed = parseClientErrorReport(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);

    const collector = await resolveClientReportCollector(db, caller.tenantId, parsed.projectId);
    if (!collector) {
      return c.json({
        error: 'No destination for this report — link the workspace to a project, '
          + 'or create a workspace-level error collector with a default project.',
      }, 422);
    }

    const result = await ingestForCollector(db, c.env as Env, collector, parsed.events);
    return c.json(result, result.capExceeded ? 429 : 202);
  });

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
