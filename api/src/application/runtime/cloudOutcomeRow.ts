/**
 * cloudOutcomeRow — THE `run.outcome` timeline row of a cloud run (PRD 35 §8.2): ONE per run, written where the run's
 * fate is final, carrying the status the execution LANDED with.
 *
 * The agent builds the row when it settles, but the cloud decides what finishing a ticket means (a missing sign-off lands
 * the run `ok: false`, a tripped breaker lands it COMPLETED, a steered stop lands it cancelled), so the agent's row is
 * stashed and written here after the landing — with the landed status — rather than at the agent's settle. Runs that never
 * reach the agent's settle still get theirs: a rehearsal that spent its step budget, a platform refusal before the run
 * started, a run cancelled or reaped while PAUSED.
 *
 * Idempotent per execution: a re-run after an eviction that fell between the write and the terminal save records nothing
 * the second time.
 */
import { eq } from 'drizzle-orm';
import type { RunOutcomeRow } from '@builderforce/agent-run';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import { reportedFallback } from '../observability/caughtErrorReporter';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { recordCloudToolEvent } from './cloudToolEvents';
import { cloudRunId } from '../../domain/execution/cloudRunId';

/** The status the execution landed with — what the board and the timeline show. */
export type LandedStatus = 'finished' | 'failed' | 'cancelled';

/** Whose run a row belongs to. */
export interface OutcomeRowRun { tenantId: number; executionId: number; cloudAgentRef?: string | null }

export const OUTCOME_ROW_TOOL = 'run.outcome';

/** The status a settled result landed with. */
export function landedStatus(result: { ok: boolean; cancelled: boolean }): LandedStatus {
  return result.cancelled ? 'cancelled' : result.ok ? 'finished' : 'failed';
}

/**
 * Write the run's one outcome row. `row` is the agent's (counts, tokens, efficiency fields) or nothing for a run that
 * never started; `landed` replaces its terminal status; `reason` names why a run that did not finish stopped.
 */
export async function writeCloudOutcomeRow(db: Db, run: OutcomeRowRun, row: Partial<RunOutcomeRow> | undefined, landed: LandedStatus, reason?: string): Promise<void> {
  const [existing] = await runTelemetryDatabase(db)
    .select({ id: toolAuditEvents.id })
    .from(toolAuditEvents)
    .where(scopedToTenant(toolAuditEvents, run.tenantId, eq(toolAuditEvents.executionId, run.executionId), eq(toolAuditEvents.toolName, OUTCOME_ROW_TOOL)))
    .limit(1);
  if (existing) return;
  await recordCloudToolEvent(db, {
    tenantId: run.tenantId,
    ...(run.cloudAgentRef ? { cloudAgentRef: run.cloudAgentRef } : {}),
    executionId: run.executionId,
    toolName: OUTCOME_ROW_TOOL,
    category: 'run',
    detail: { entryPoint: 'cloud', runId: cloudRunId(run.executionId), steps: 0, toolCalls: 0, toolErrors: 0, ...row, terminalStatus: landed, ...(reason ? { reason } : {}) },
    result: `${landed} after ${row?.steps ?? 0} step(s)`,
  });
}

/**
 * The row of a cloud run that ended while PAUSED on a question (cancelled by a person, or reaped as abandoned): it never
 * settled through the agent, so there is no agent row — the run's own count of steps is unknown and recorded as none.
 * Best-effort: a failed write is reported, never thrown into the cancel / reap that triggered it.
 */
export async function writePausedRunEndRow(
  db: Db,
  e: { id: unknown; tenantId: unknown; cloudAgentRef: string | null },
  landed: LandedStatus,
  reason?: string,
): Promise<void> {
  const run = { tenantId: Number(e.tenantId), executionId: Number(e.id), cloudAgentRef: e.cloudAgentRef };
  await writeCloudOutcomeRow(db, run, undefined, landed, reason)
    .catch(reportedFallback(undefined, { source: 'application/runtime/cloudOutcomeRow.ts', operation: 'writePausedRunEndRow', context: { executionId: run.executionId } }));
}
