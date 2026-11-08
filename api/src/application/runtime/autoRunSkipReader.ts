/**
 * autoRunSkipReader — the READ side of the `auto_run_skipped` / `auto_run_error` ledger.
 *
 * `autoRunSkipLedger.ts` owns the WRITE side (one writer, state-gated). This module owns
 * the query shape for the one reader that needs the latest refusal of MANY tickets at
 * once: the stall census, whose fast ladder cannot see most of what actually refuses a
 * ticket (capability mismatch, cloud-run cap, token cap, execution switch, requirement
 * gate, same-lane re-entry, cooldown, a thrown trigger). The recorded row IS the real
 * refusal, so the census reads it instead of guessing `will_run`.
 *
 * ONE query for any number of tickets (`DISTINCT ON (session_key) … ORDER BY ts DESC`,
 * the same shape the lifecycle ledger reads) — never one query per ticket.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { AUTO_RUN_REASON_TEXT, type AutoRunReason } from '../swimlane/evaluateAutoRun';

/** The tool names the ledger writes: a decision not to run, and a trigger that threw. */
export const AUTO_RUN_SKIPPED_TOOL = 'auto_run_skipped';
export const AUTO_RUN_ERROR_TOOL = 'auto_run_error';

/**
 * Upper bound on how far back the query looks. The PRIMARY staleness rule is the ticket's
 * last lane change (applied by the caller, which knows it); this only bounds the scan for
 * a caller that has no lane-change time to offer.
 */
export const REFUSAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** A ticket's most recent recorded refusal. */
export interface RecordedRefusal {
  reason: AutoRunReason;
  at: Date;
}

/**
 * Turn one ledger row into a refusal, or null when it carries no usable reason. PURE.
 *
 * An `auto_run_error` row has no `reason` field — a throw is not a decision — so it maps
 * to `trigger_error`. A skip row's `reason` must be a real {@link AutoRunReason}
 * (`will_run` is not a refusal): an off-vocabulary value is dropped rather than trusted.
 */
export function refusalFromRow(row: { toolName: string; args: string | null; ts: Date }): RecordedRefusal | null {
  if (row.toolName === AUTO_RUN_ERROR_TOOL) return { reason: 'trigger_error', at: row.ts };
  if (row.toolName !== AUTO_RUN_SKIPPED_TOOL || !row.args) return null;
  try {
    const parsed: unknown = JSON.parse(row.args);
    const reason = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).reason : undefined;
    if (typeof reason !== 'string' || reason === 'will_run' || !(reason in AUTO_RUN_REASON_TEXT)) return null;
    return { reason: reason as AutoRunReason, at: row.ts };
  } catch {
    return null;
  }
}

const taskIdOf = (sessionKey: string | null): number | null => {
  const m = /^task:(\d+)$/.exec(sessionKey ?? '');
  return m ? Number(m[1]) : null;
};

/**
 * The latest recorded refusal per ticket, for many tickets, in ONE query.
 *
 * Tickets with no usable row are simply absent from the map. Failure is the caller's to
 * handle (the census degrades to its fast-ladder verdict).
 */
export async function loadLatestRefusals(
  db: Db,
  tenantId: number,
  taskIds: readonly number[],
  now: number = Date.now(),
): Promise<Map<number, RecordedRefusal>> {
  const out = new Map<number, RecordedRefusal>();
  if (taskIds.length === 0) return out;
  const rows = await runTelemetryDatabase(db)
    .selectDistinctOn([toolAuditEvents.sessionKey], {
      sessionKey: toolAuditEvents.sessionKey,
      toolName: toolAuditEvents.toolName,
      args: toolAuditEvents.args,
      ts: toolAuditEvents.ts,
    })
    .from(toolAuditEvents)
    .where(and(
      eq(toolAuditEvents.tenantId, tenantId),
      inArray(toolAuditEvents.toolName, [AUTO_RUN_SKIPPED_TOOL, AUTO_RUN_ERROR_TOOL]),
      inArray(toolAuditEvents.sessionKey, taskIds.map((id) => `task:${id}`)),
      gte(toolAuditEvents.ts, new Date(now - REFUSAL_LOOKBACK_MS)),
    ))
    .orderBy(toolAuditEvents.sessionKey, desc(toolAuditEvents.ts));
  for (const r of rows) {
    const id = taskIdOf(r.sessionKey);
    const refusal = id == null ? null : refusalFromRow({ toolName: r.toolName, args: r.args, ts: r.ts });
    if (id != null && refusal) out.set(id, refusal);
  }
  return out;
}
