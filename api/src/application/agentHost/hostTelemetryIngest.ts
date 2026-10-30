/**
 * Host telemetry ingest — tool-audit events, usage snapshots and file changes posted
 * by an agent host (directly, or through its relay Durable Object).
 *
 * Each kind arrives as ONE event (every host already in the field) or as a batch
 * (`{ events: [...] }`, sent by the relay DO and newer runtimes). Either way a request
 * is ONE multi-row INSERT per kind: on neon-http every statement is an HTTPS round
 * trip, and a running agent emits these per tool call, so a statement per event kept
 * the database awake for the whole run.
 *
 * Tenancy comes from the VERIFIED host key, never from an event body.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { executions, taskFileChanges, toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** Most events one batch may carry (mirrors the route schema). */
export const HOST_TELEMETRY_BATCH_MAX = 200;

/** A body is either one event or `{ events }`. */
export function eventsOf<T extends object>(body: T | { events: T[] }): { events: T[]; single: boolean } {
  return 'events' in body && Array.isArray(body.events)
    ? { events: body.events, single: false }
    : { events: [body as T], single: true };
}

export interface HostIdentity {
  tenantId: number;
  agentHostId: number;
}

type NumberLike = number | string | null | undefined;

export interface ToolAuditEventInput {
  runId?: string | null;
  executionId?: NumberLike;
  sessionKey?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  category?: string | null;
  args?: unknown;
  result?: string | null;
  durationMs?: number | null;
  ts?: string | number | null;
}

export interface UsageSnapshotInput {
  sessionKey?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  contextTokens?: number | null;
  contextWindowMax?: number | null;
  compactionCount?: number | null;
  ts?: string | number | null;
}

export interface FileChangeInput {
  taskId?: NumberLike;
  executionId?: NumberLike;
  path?: unknown;
  change?: string | null;
  agent?: unknown;
}

const finiteOrNull = (value: NumberLike): number | null =>
  value != null && Number.isFinite(Number(value)) ? Number(value) : null;

/** Rows for the events that name a tool; an event without one is dropped. */
export function toolAuditRows(host: HostIdentity, events: ToolAuditEventInput[]) {
  return events.flatMap((e) => (e.toolName ? [{
    tenantId: host.tenantId,
    agentHostId: host.agentHostId,
    // Stamp the execution so the event is queryable per-run (the cloud Logs/
    // Timeline scope by execution_id), giving V2/host runs parity with V1.
    executionId: finiteOrNull(e.executionId),
    runId: e.runId ?? null,
    sessionKey: e.sessionKey ?? null,
    toolCallId: e.toolCallId ?? null,
    toolName: e.toolName,
    category: e.category ?? null,
    args: e.args != null ? JSON.stringify(e.args) : null,
    result: e.result ?? null,
    durationMs: e.durationMs ?? null,
    ts: e.ts ? new Date(e.ts) : new Date(),
  }] : []));
}

export function usageSnapshotRows(host: HostIdentity, events: UsageSnapshotInput[]) {
  return events.map((e) => ({
    tenantId: host.tenantId,
    agentHostId: host.agentHostId,
    sessionKey: e.sessionKey ?? 'default',
    inputTokens: e.inputTokens ?? 0,
    outputTokens: e.outputTokens ?? 0,
    contextTokens: e.contextTokens ?? 0,
    contextWindowMax: e.contextWindowMax ?? 0,
    compactionCount: e.compactionCount ?? 0,
    ts: e.ts ? new Date(e.ts) : new Date(),
  }));
}

/** Tool names that are the CLOUD's own rows: a host never sends them and must not forge one for a run (`run.outcome` is the cloud's one-per-run row). */
const CLOUD_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(['run.outcome']);

/**
 * Admit a host's batch: drop the cloud-only rows, and every row whose `executionId` is not in the host's own TENANT (the id arrives in
 * the BODY, so it is checked, in ONE query). Rows are dropped, never the whole batch.
 */
export async function admitToolAuditRows(db: Db, host: HostIdentity, rows: ReturnType<typeof toolAuditRows>): Promise<ReturnType<typeof toolAuditRows>> {
  const candidates = rows.filter((row) => !CLOUD_ONLY_TOOL_NAMES.has(row.toolName));
  const ids = [...new Set(candidates.flatMap((row) => (row.executionId != null ? [row.executionId] : [])))];
  if (ids.length === 0) return candidates;
  const owned = await db.select({ id: executions.id }).from(executions).where(and(inArray(executions.id, ids), eq(executions.tenantId, host.tenantId)));
  const mine = new Set(owned.map((row) => row.id));
  return candidates.filter((row) => row.executionId == null || mine.has(row.executionId));
}

/** Insert in ONE statement; returns the rows written. */
export async function insertToolAuditRows(db: Db, rows: ReturnType<typeof toolAuditRows>): Promise<number> {
  if (rows.length === 0) return 0;
  await runTelemetryDatabase(db).insert(toolAuditEvents).values(rows);
  return rows.length;
}

/** Insert in ONE statement; returns the rows written. */
export async function insertUsageSnapshotRows(db: Db, rows: ReturnType<typeof usageSnapshotRows>): Promise<number> {
  if (rows.length === 0) return 0;
  await runTelemetryDatabase(db).insert(usageSnapshots).values(rows);
  return rows.length;
}

export type FileChangeRejection = 'invalid' | 'execution';

/** One file change, shape-checked, or why it cannot be one. */
export function parseFileChange(e: FileChangeInput):
  | { ok: true; taskId: number; executionId: number; path: string; change: string; agent: string }
  | { ok: false } {
  const taskId = Number(e.taskId);
  const executionId = Number(e.executionId);
  const path = typeof e.path === 'string' ? e.path.trim() : '';
  if (e.taskId == null || e.executionId == null || !Number.isFinite(taskId) || !Number.isFinite(executionId) || !path) {
    return { ok: false };
  }
  const change = ['created', 'modified', 'deleted'].includes(e.change ?? '') ? e.change! : 'modified';
  const agent = typeof e.agent === 'string' && e.agent.trim() ? e.agent.trim() : 'agent';
  return { ok: true, taskId, executionId, path, change, agent };
}

/**
 * Admit and insert a batch of file changes. `taskId` and `executionId` arrive in the
 * BODY, so each is checked in ONE query: the execution must belong to this host and
 * tenant AND be the execution OF that task. That proves the task is in the host's
 * tenant too (an execution carries its task), so there is no per-task lookup. Returns how many were written and, per event, why one
 * was refused (`null` = written).
 */
export async function ingestFileChanges(
  db: Db,
  host: HostIdentity,
  events: FileChangeInput[],
): Promise<{ inserted: number; rejected: Array<FileChangeRejection | null> }> {
  const parsed = events.map(parseFileChange);
  const valid = parsed.flatMap((p) => (p.ok ? [p] : []));

  const executionIds = [...new Set(valid.map((p) => p.executionId))];
  const owned = executionIds.length === 0 ? [] : await db.select({ id: executions.id, taskId: executions.taskId })
    .from(executions)
    .where(and(
      inArray(executions.id, executionIds),
      eq(executions.tenantId, host.tenantId),
      eq(executions.agentHostId, host.agentHostId),
    ));
  const executionTask = new Map(owned.map((row) => [row.id, row.taskId]));

  const rejected: Array<FileChangeRejection | null> = [];
  const rows: Array<typeof taskFileChanges.$inferInsert> = [];
  for (const p of parsed) {
    if (!p.ok) { rejected.push('invalid'); continue; }
    if (executionTask.get(p.executionId) !== p.taskId) { rejected.push('execution'); continue; }
    rejected.push(null);
    rows.push({ tenantId: host.tenantId, taskId: p.taskId, executionId: p.executionId, path: p.path, change: p.change, agent: p.agent });
  }
  if (rows.length > 0) await db.insert(taskFileChanges).values(rows);
  return { inserted: rows.length, rejected };
}
