/**
 * The audit export sweep — sends a tenant's security and audit events to its own
 * OpenTelemetry collector as OTLP logs (PRD 39 §4a).
 *
 * WHY A SWEEP. Traces leave inline, per run event, because a dropped span is a
 * momentary gap. Audit events are different: a security trail that is dropped
 * silently is a compliance failure. But the delivery constraint is the same as
 * traces — a collector outage must never slow or fail a request — so the sweep
 * runs on the `frequent` cron tick (registered in `src/cronSweeps.ts`), never
 * on the request path. Every outcome lands on the exporter row's health columns
 * (`last_export_at` / `last_error` / `consecutive_failures`), which the settings
 * panel already renders.
 *
 * There is no single audit store to read (PRD 39 §4a calls this out): the event
 * set is scattered across core and operational tables. Each source below is ONE
 * reader reading rows with an id strictly greater than the saved cursor, through
 * the database handle that owns the table — `tool_audit_events` is on the
 * operational endpoint and must be read through `runTelemetryDatabase(db)`, the
 * others through the core handle. `admin_audit_log` is the cross-tenant operator
 * trail and is deliberately NOT a source: tenant export carries only that
 * tenant's events, and the operator trail never leaves the platform.
 *
 * AT-LEAST-ONCE. The cursor advances only after the batch is accepted, so a
 * failed batch is retried whole from the last confirmed position — and the
 * event id (`<source>:<row id>`, exported as `builderforce.audit.event_id`) is
 * the dedup key a collector matches on, so a redelivery after a crash between
 * the POST and the cursor write dedupes instead of duplicating.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import {
  approvalActions,
  authUserSessions,
  auditReportRuns,
  connectorConnections,
  otelExporters,
  tenantApiKeys,
  tenantMembers,
  toolAuditEvents,
} from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { credentialSecret, decryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from './caughtErrorReporter';
import { buildOtlpLogsPayload, logsUrl, type AuditLogEvent } from './otelSpans';
import type { Env } from '../../env';

/** Which signals an exporter ships. `traces` is the pre-audit default. */
export type OtelExporterSignals = 'traces' | 'audit' | 'both';

export function signalsIncludeAudit(signals: string): boolean {
  return signals === 'audit' || signals === 'both';
}

/** The seven event sources (PRD 39 §4a's confirmed set), one reader each. */
export const AUDIT_SOURCES = [
  'auth.sessions',
  'memberships',
  'api_keys',
  'exports',
  'integrations',
  'approvals',
  'tool_calls',
] as const;

export type AuditSource = (typeof AUDIT_SOURCES)[number];

/** `{source: lastSeenId, sent: n}` — one JSONB column on the exporter row.
 * `lastSeenId` is the row's own id (serial or uuid — both order under `>`). */
export interface AuditCursor {
  [source: string]: number | string | undefined;
  sent?: number;
}

export interface OtelAuditSweepResult {
  tenants: number;
  sent: number;
  failed: number;
}

const BATCH_LIMIT = 200;
const EXPORT_TIMEOUT_MS = 5_000;

/**
 * One source = one table + one id cursor, read through the handle that owns the
 * table. Keeping every reader on this shape is what lets the sweep add a source
 * by adding one entry, and what makes the cursor per-source by construction.
 */
interface AuditSourceReader {
  source: AuditSource;
  /** The handle that owns the table — core for everything except tool_calls. */
  read(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]>;
}

/**
 * Cursor predicate: `id > afterId`. A zero/empty cursor means "from the
 * beginning" and OMITS the predicate — the literal would otherwise be cast to
 * the column type, and `0` is not a valid uuid for the uuid-keyed sources.
 */
const after = (column: Parameters<typeof gt>[0], afterId: number | string) =>
  afterId === 0 || afterId === '' ? undefined : gt(column, afterId as never);

const idAttr = (value: number | string | null | undefined) => value ?? null;

const readers: readonly AuditSourceReader[] = [
  // Sign-in / session events. Sessions have no tenant column; a session belongs
  // to a tenant through its user's membership, so this reader joins
  // auth_user_sessions to tenant_members rather than filtering by a tenant id.
  { source: 'auth.sessions', read: readSessions },
  { source: 'memberships', read: readMemberships },
  { source: 'api_keys', read: readApiKeys },
  { source: 'exports', read: readExports },
  { source: 'integrations', read: readIntegrations },
  { source: 'approvals', read: readApprovals },
  { source: 'tool_calls', read: readToolCalls },
];

/**
 * Sessions have no tenant column; a session belongs to a tenant through its
 * user's membership. This joins auth_user_sessions to tenant_members and is the
 * one reader whose table is reached indirectly.
 */
async function readSessions(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select({
      id: authUserSessions.id,
      userId: authUserSessions.userId,
      sessionName: authUserSessions.sessionName,
      ipAddress: authUserSessions.ipAddress,
      revokedAt: authUserSessions.revokedAt,
      createdAt: authUserSessions.createdAt,
    })
    .from(authUserSessions)
    .innerJoin(tenantMembers, eq(tenantMembers.userId, authUserSessions.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), after(authUserSessions.id, afterId)))
    .orderBy(authUserSessions.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `auth.sessions:${row.id}`,
    name: row.revokedAt ? 'auth.session.revoked' : 'auth.session.created',
    timeMs: new Date(row.revokedAt ?? row.createdAt).getTime(),
    attributes: {
      'builderforce.audit.user_id': row.userId,
      'builderforce.audit.session_name': row.sessionName ?? null,
      'builderforce.audit.ip': row.ipAddress ?? null,
    },
  }));
}

/** Role and membership changes on core. */
async function readMemberships(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), after(tenantMembers.id, afterId)))
    .orderBy(tenantMembers.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `memberships:${row.id}`,
    name: 'membership.changed',
    timeMs: new Date(row.joinedAt).getTime(),
    attributes: {
      'builderforce.audit.user_id': row.userId,
      'builderforce.audit.role': row.role,
      'builderforce.audit.active': row.isActive,
      'builderforce.audit.seat_kind': row.seatKind,
    },
  }));
}

/** API key changes on core. */
async function readApiKeys(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select()
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), after(tenantApiKeys.id, afterId)))
    .orderBy(tenantApiKeys.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `api_keys:${row.id}`,
    name: row.revokedAt ? 'api_key.revoked' : 'api_key.created',
    timeMs: new Date(row.revokedAt ?? row.createdAt).getTime(),
    attributes: {
      'builderforce.audit.key_id': row.id,
      'builderforce.audit.key_name': row.name,
      'builderforce.audit.user_id': row.createdByUserId ?? null,
    },
  }));
}

/** Exports (compliance / evidence packs) on core. */
async function readExports(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select()
    .from(auditReportRuns)
    .where(and(eq(auditReportRuns.tenantId, tenantId), after(auditReportRuns.id, afterId)))
    .orderBy(auditReportRuns.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `exports:${row.id}`,
    name: 'export.generated',
    timeMs: new Date(row.createdAt).getTime(),
    attributes: {
      'builderforce.audit.export_id': row.id,
      'builderforce.audit.period': row.periodMonth,
      'builderforce.audit.user_id': row.generatedBy ?? null,
    },
  }));
}

/** Integration (connector) connections on core. */
async function readIntegrations(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.tenantId, tenantId), after(connectorConnections.id, afterId)))
    .orderBy(connectorConnections.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `integrations:${row.id}`,
    name: 'integration.connected',
    timeMs: new Date(row.createdAt).getTime(),
    attributes: {
      'builderforce.audit.connector': row.connectorKey,
      'builderforce.audit.connection': row.name,
      'builderforce.audit.enabled': row.enabled,
      'builderforce.audit.user_id': row.createdByUserId ?? null,
    },
  }));
}

/** Approval decisions on core. */
async function readApprovals(db: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const rows = await db
    .select()
    .from(approvalActions)
    .where(and(eq(approvalActions.tenantId, tenantId), after(approvalActions.id, afterId)))
    .orderBy(approvalActions.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `approvals:${row.id}`,
    name: 'approval.decided',
    timeMs: new Date(row.actedAt ?? row.requestedAt ?? row.createdAt).getTime(),
    attributes: {
      'builderforce.audit.subject_kind': row.subjectKind,
      'builderforce.audit.subject_ref': row.subjectRef,
      'builderforce.audit.decision': row.state,
      'builderforce.audit.approver': row.approverRef,
    },
  }));
}

/**
 * Agent tool calls — the ONE source on the operational endpoint. Read through
 * `runTelemetryDatabase(db)`, never the core handle, or production would query
 * a table that lives on the other database.
 */
async function readToolCalls(coreDb: Db, tenantId: number, afterId: number | string): Promise<AuditLogEvent[]> {
  const db = runTelemetryDatabase(coreDb);
  const rows = await db
    .select({
      id: toolAuditEvents.id,
      toolName: toolAuditEvents.toolName,
      category: toolAuditEvents.category,
      executionId: toolAuditEvents.executionId,
      agentHostId: toolAuditEvents.agentHostId,
      cloudAgentRef: toolAuditEvents.cloudAgentRef,
      ts: toolAuditEvents.ts,
    })
    .from(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), after(toolAuditEvents.id, afterId)))
    .orderBy(toolAuditEvents.id)
    .limit(BATCH_LIMIT);
  return rows.map((row) => ({
    id: `tool_calls:${row.id}`,
    name: 'agent.tool.called',
    timeMs: new Date(row.ts).getTime(),
    attributes: {
      'builderforce.audit.tool': row.toolName,
      'builderforce.audit.category': row.category ?? null,
      'builderforce.audit.execution_id': idAttr(row.executionId),
      'builderforce.audit.agent_host_id': idAttr(row.agentHostId),
      'builderforce.audit.agent_ref': row.cloudAgentRef ?? null,
    },
  }));
}

/**
 * Advance one source cursor to the last id actually read. Events arrive ordered
 * by id ascending, so the last event's id is the highest; serial and uuid ids
 * both order correctly under `>`.
 */
function advanceCursor(cursor: AuditCursor, source: AuditSource, events: AuditLogEvent[]): boolean {
  const last = events[events.length - 1];
  if (!last) return false;
  cursor[source] = last.id.slice(source.length + 1);
  return true;
}

/**
 * Run the sweep for one tenant. Returns events sent, or `null` when the tenant
 * has no audit-enabled exporter. Throws only on a collector delivery failure —
 * the caller records that on the exporter row's health columns.
 */
async function sweepTenant(
  env: Env,
  db: Db,
  row: typeof otelExporters.$inferSelect,
  fetchImpl: typeof fetch,
): Promise<number> {
  let sentTotal = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (row.headersEnc && row.headersIv) {
    const decoded = await decryptCredentials(row.headersEnc, row.headersIv, credentialSecret(env), row.tenantId);
    if (!decoded) throw new Error('stored headers could not be decrypted');
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value === 'string') headers[key] = value;
    }
  }

  const cursor: AuditCursor = { ...((row.auditCursor as AuditCursor | null) ?? {}) };
  for (const reader of readers) {
    const afterId = cursor[reader.source] ?? 0;
    const events = await reader.read(db, row.tenantId, afterId);
    if (events.length === 0) continue;
    const payload = buildOtlpLogsPayload(
      { serviceName: row.serviceName?.trim() || 'builderforce-agents', tenantId: row.tenantId },
      events,
    );
    const res = await fetchImpl(logsUrl(row.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`collector responded ${res.status}`);
    // The cursor advances only after the batch is accepted, so a failed batch
    // retries whole from the last confirmed position — at-least-once with the
    // event id as the collector's dedup key, never loss.
    advanceCursor(cursor, reader.source, events);
    sentTotal += events.length;
  }
  cursor.sent = (cursor.sent ?? 0) + sentTotal;
  await db
    .update(otelExporters)
    .set({ auditCursor: cursor, updatedAt: new Date() })
    .where(and(eq(otelExporters.tenantId, row.tenantId), eq(otelExporters.id, row.id)));
  return sentTotal;
}

/**
 * Run the audit export sweep across every tenant with an audit-enabled exporter.
 * Called from the `frequent` cron tick — never the request path. A collector
 * outage surfaces on the exporter row (`last_error`, `consecutive_failures`)
 * through the same health columns traces use, and never blocks anything else.
 */
export async function runOtelAuditSweep(
  env: Env,
  db: Db,
  fetchImpl: typeof fetch = fetch,
): Promise<OtelAuditSweepResult> {
  const result: OtelAuditSweepResult = { tenants: 0, sent: 0, failed: 0 };
  try {
    const rows = await db.select().from(otelExporters).where(acrossTenants(otelExporters, 'scheduled_sweep', eq(otelExporters.enabled, true))).limit(500);
    for (const row of rows) {
      if (!signalsIncludeAudit(row.signals)) continue;
      result.tenants += 1;
      try {
        const sent = await sweepTenant(env, db, row, fetchImpl);
        result.sent += sent;
        await db
          .update(otelExporters)
          .set({
            lastError: null,
            consecutiveFailures: 0,
            lastExportAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(otelExporters.tenantId, row.tenantId), eq(otelExporters.id, row.id)));
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(otelExporters)
          .set({
            lastError: message.slice(0, 500),
            consecutiveFailures: sql`${otelExporters.consecutiveFailures} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(otelExporters.tenantId, row.tenantId), eq(otelExporters.id, row.id)));
        reportCaughtError(error, {
          source: 'application/observability/otelAuditSweep.ts',
          operation: 'runOtelAuditSweep',
          level: 'warning',
        });
      }
    }
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/observability/otelAuditSweep.ts',
      operation: 'runOtelAuditSweep',
      level: 'warning',
    });
  }
  return result;
}
