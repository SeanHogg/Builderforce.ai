/**
 * Ship agent-run telemetry to a tenant's own OpenTelemetry collector.
 *
 * This is the door the product was missing: every lifecycle transition and tool
 * call is already recorded, and until now none of it could leave, so a buyer with
 * an existing observability stack saw agent work as an island. An exporter row says
 * where to send it; this module resolves that row, builds the OTLP payload, and
 * POSTs it.
 *
 * Best-effort by construction. A collector outage must never fail or slow a run, so
 * every failure is recorded on the exporter row (which the settings panel shows)
 * rather than raised. The row's own health columns are what turn "spans are being
 * dropped" from an invisible condition into a visible one.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { otelExporters } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from './caughtErrorReporter';
import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';
import { buildOtlpTracePayload, runIsSampled, tracesUrl, type AgentSpan } from './otelSpans';
import type { Env } from '../../env';

/** An exporter as the settings panel sees it — never carrying the credential. */
export interface OtelExporterView {
  id: string;
  name: string;
  endpoint: string;
  serviceName: string | null;
  sampleRate: number;
  enabled: boolean;
  hasHeaders: boolean;
  lastExportAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const cacheKey = (tenantId: number): string => `otel-exporters:${tenantId}`;
const EXPORT_TIMEOUT_MS = 5_000;

function toView(row: typeof otelExporters.$inferSelect): OtelExporterView {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    serviceName: row.serviceName,
    sampleRate: row.sampleRate,
    enabled: row.enabled,
    hasHeaders: Boolean(row.headersEnc),
    lastExportAt: row.lastExportAt ? new Date(row.lastExportAt).toISOString() : null,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
  };
}

/** The workspace's exporters, for the settings panel. */
export async function listExporters(db: Db, tenantId: number): Promise<OtelExporterView[]> {
  const rows = await db.select().from(otelExporters).where(scopedToTenant(otelExporters, tenantId)).limit(20);
  return rows.map(toView);
}

export interface UpsertExporterInput {
  name: string;
  endpoint: string;
  /** `undefined` keeps stored headers; `null` clears them; an object replaces them. */
  headers?: Record<string, string> | null;
  serviceName?: string | null;
  sampleRate?: number;
  enabled?: boolean;
}

/** Create an exporter. The endpoint is SSRF-guarded before it is ever stored. */
export async function createExporter(
  env: Env,
  db: Db,
  tenantId: number,
  userId: string,
  input: UpsertExporterInput,
): Promise<{ ok: boolean; exporter?: OtelExporterView; error?: string }> {
  const guard = safeEndpoint(input.endpoint);
  if (!guard.ok) return { ok: false, error: guard.error };

  const sealed = input.headers
    ? await encryptCredentials(input.headers, credentialSecret(env), tenantId)
    : null;
  const [row] = await db
    .insert(otelExporters)
    .values({
      tenantId,
      name: input.name.trim().slice(0, 255),
      endpoint: guard.endpoint,
      headersEnc: sealed?.enc ?? null,
      headersIv: sealed?.iv ?? null,
      serviceName: input.serviceName?.trim().slice(0, 255) ?? null,
      sampleRate: clampRate(input.sampleRate),
      enabled: input.enabled ?? true,
      createdBy: userId,
    })
    .returning();
  await invalidateCached(env, cacheKey(tenantId));
  return { ok: true, exporter: toView(row) };
}

/** Update an exporter. Omitted headers are KEPT — they are never returned to edit. */
export async function updateExporter(
  env: Env,
  db: Db,
  tenantId: number,
  id: string,
  input: Partial<UpsertExporterInput>,
): Promise<{ ok: boolean; exporter?: OtelExporterView; error?: string }> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.endpoint !== undefined) {
    const guard = safeEndpoint(input.endpoint);
    if (!guard.ok) return { ok: false, error: guard.error };
    patch.endpoint = guard.endpoint;
    // A new endpoint is a new destination: its failure history says nothing about it.
    patch.consecutiveFailures = 0;
    patch.lastError = null;
  }
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 255);
  if (input.serviceName !== undefined) patch.serviceName = input.serviceName?.trim().slice(0, 255) ?? null;
  if (input.sampleRate !== undefined) patch.sampleRate = clampRate(input.sampleRate);
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.headers === null) {
    patch.headersEnc = null;
    patch.headersIv = null;
  } else if (input.headers) {
    const sealed = await encryptCredentials(input.headers, credentialSecret(env), tenantId);
    patch.headersEnc = sealed.enc;
    patch.headersIv = sealed.iv;
  }

  const [row] = await db
    .update(otelExporters)
    .set(patch)
    .where(scopedToTenant(otelExporters, tenantId, eq(otelExporters.id, id)))
    .returning();
  if (!row) return { ok: false, error: 'Exporter not found' };
  await invalidateCached(env, cacheKey(tenantId));
  return { ok: true, exporter: toView(row) };
}

/** Remove an exporter. Spans stop leaving immediately. */
export async function deleteExporter(env: Env, db: Db, tenantId: number, id: string): Promise<boolean> {
  const [row] = await db
    .delete(otelExporters)
    .where(scopedToTenant(otelExporters, tenantId, eq(otelExporters.id, id)))
    .returning({ id: otelExporters.id });
  if (!row) return false;
  await invalidateCached(env, cacheKey(tenantId));
  return true;
}

/**
 * A collector endpoint the platform is willing to POST to: https only, no private,
 * loopback or link-local host. The SAME `assertSafeUrl` guard every other
 * tenant-supplied URL goes through — an exporter is an outbound fetch a tenant
 * chooses the target of, which is exactly the shape SSRF exploits.
 */
function safeEndpoint(raw: string): { ok: true; endpoint: string } | { ok: false; error: string } {
  try {
    const url = assertSafeUrl(raw, { allowHttp: false });
    return { ok: true, endpoint: url.toString() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.replace(/^URL/, 'endpoint') };
  }
}

const clampRate = (rate?: number): number =>
  typeof rate === 'number' && Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;

/** Enabled exporters for a tenant, cached — this is read on every run event. */
async function enabledExporters(env: Env, db: Db, tenantId: number) {
  return getOrSetCached(
    env,
    cacheKey(tenantId),
    async () =>
      db
        .select()
        .from(otelExporters)
        .where(scopedToTenant(otelExporters, tenantId, eq(otelExporters.enabled, true)))
        .limit(5),
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/** Record the outcome so a silently-failing collector is visible in settings. */
async function recordOutcome(db: Db, tenantId: number, id: string, error: string | null): Promise<void> {
  await db
    .update(otelExporters)
    .set(
      error
        ? { lastError: error.slice(0, 500), consecutiveFailures: sql`${otelExporters.consecutiveFailures} + 1`, updatedAt: new Date() }
        : { lastError: null, consecutiveFailures: 0, lastExportAt: new Date(), updatedAt: new Date() },
    )
    .where(and(eq(otelExporters.tenantId, tenantId), eq(otelExporters.id, id)));
}

/**
 * Send spans to every enabled exporter for the tenant. Never throws, never blocks a
 * run: the caller fires this and moves on.
 */
export async function exportAgentSpans(
  env: Env,
  db: Db,
  tenantId: number,
  spans: readonly AgentSpan[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ exported: number }> {
  if (spans.length === 0) return { exported: 0 };
  let exported = 0;
  try {
    const rows = await enabledExporters(env, db, tenantId);
    for (const row of rows) {
      const sampled = spans.filter((s) => runIsSampled(s.executionId, row.sampleRate));
      if (sampled.length === 0) continue;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (row.headersEnc && row.headersIv) {
        try {
          const decoded = await decryptCredentials(row.headersEnc, row.headersIv, credentialSecret(env), tenantId);
          for (const [key, value] of Object.entries(decoded)) {
            if (typeof value === 'string') headers[key] = value;
          }
        } catch {
          await recordOutcome(db, tenantId, row.id, 'stored headers could not be decrypted');
          continue;
        }
      }
      const payload = buildOtlpTracePayload(
        { serviceName: row.serviceName?.trim() || 'builderforce-agents', tenantId },
        sampled,
      );
      try {
        const res = await fetchImpl(tracesUrl(row.endpoint), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
        });
        if (res.ok) {
          exported += sampled.length;
          await recordOutcome(db, tenantId, row.id, null);
        } else {
          await recordOutcome(db, tenantId, row.id, `collector responded ${res.status}`);
        }
      } catch (error) {
        await recordOutcome(db, tenantId, row.id, error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/observability/otelExporter.ts',
      operation: 'exportAgentSpans',
      level: 'warning',
    });
  }
  return { exported };
}
