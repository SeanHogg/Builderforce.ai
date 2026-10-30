/**
 * cloudOutcomeRow — THE `run.outcome` timeline row of a cloud run (PRD 35 §8.2), and the ONE function that writes it.
 *
 * It is called from the single place an execution's terminal status is persisted (`ExecutionRepository.update`, wired in
 * `buildRuntimeService`; and the cron reaper's batch update, which bypasses the repository), so EVERY way a run ends — the agent
 * landing it, a cancel (whatever its prior status), either reaper, the Durable Object's crash path, a platform halt — writes the
 * same row, once, with the status the execution LANDED with. Nothing else writes it.
 *
 * Counts (steps, tool calls, tokens, the efficiency fields) are the agent's, from the run's `RunState.telemetry`; the cloud tail
 * hands them over just before the terminal transition ({@link handOffOutcomeCounts}). A run that never had a tally (a cancel while
 * it sat between ticks, a reaper, a refusal before it started) carries NO counts: unknown is absent, never zero.
 *
 * Uniqueness belongs to the table (a partial unique index, migrations 1286 / 0029) and the insert is ON CONFLICT DO NOTHING, so
 * racing writers and a re-run after an eviction record one row. The matching `run.finished` trace row is written only by the
 * writer that won, so its status can never differ from the landed one.
 */
import type { RunOutcomeRow } from '@builderforce/agent-run';
import { cloudRunId } from '../../domain/execution/cloudRunId';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The status the execution landed with — what the board and the timeline show. */
export type LandedStatus = 'finished' | 'failed' | 'cancelled';

export const OUTCOME_ROW_TOOL = 'run.outcome';

/** The terminal execution statuses, as the row names them. */
const LANDED: Readonly<Record<string, LandedStatus>> = { completed: 'finished', failed: 'failed', cancelled: 'cancelled' };

/** The counts the agent built, waiting for the terminal transition of the same run (same isolate: the tail then the DO / worker update). */
const pendingCounts = new Map<number, Partial<RunOutcomeRow>>();
const MAX_PENDING = 200;

/** The agent's row for a run that is about to land: its counts become the outcome row's. */
export function handOffOutcomeCounts(executionId: number, row: Partial<RunOutcomeRow>): void {
  if (pendingCounts.size >= MAX_PENDING) pendingCounts.delete(pendingCounts.keys().next().value as number);
  pendingCounts.set(executionId, row);
}

/** What the terminal writer needs of an execution (the entity's plain shape, or a reaped row). */
export interface TerminalExecution {
  id: unknown;
  tenantId: unknown;
  cloudAgentRef: string | null;
  /** Set for a self-hosted run: its host reports its own outcome. */
  agentHostId: number | null | undefined;
  status: string;
  errorMessage: string | null;
}

/**
 * Insert the outcome rows for a set of landed executions with ONE multi-row `INSERT ... ON CONFLICT DO NOTHING RETURNING`, then
 * write `run.finished` ONLY for the executions that insert actually recorded (the ones whose row won), so the trace closes with the
 * landed status and a lost race writes nothing. Never throws (telemetry).
 */
async function insertOutcomeRows(db: Db, executions: ReadonlyArray<TerminalExecution>): Promise<void> {
  const landedRows = executions.flatMap((e) => {
    const landed = LANDED[e.status];
    return landed && e.agentHostId == null ? [{ e, landed }] : [];
  });
  if (landedRows.length === 0) return;
  const ts = new Date();
  const base = (e: TerminalExecution) => ({
    tenantId: Number(e.tenantId), agentHostId: null, cloudAgentRef: e.cloudAgentRef ?? null, executionId: Number(e.id),
    sessionKey: `exec:${Number(e.id)}`, category: 'run', ts,
  });
  try {
    const telemetry = runTelemetryDatabase(db);
    const recorded = await telemetry
      .insert(toolAuditEvents)
      .values(landedRows.map(({ e, landed }) => {
        const id = Number(e.id);
        const counts = pendingCounts.get(id);
        pendingCounts.delete(id);
        return {
          ...base(e), toolName: OUTCOME_ROW_TOOL,
          args: JSON.stringify({ entryPoint: 'cloud', runId: cloudRunId(id), ...counts, terminalStatus: landed, ...(landed !== 'finished' && e.errorMessage ? { reason: e.errorMessage } : {}) }),
          result: counts?.steps !== undefined ? `${landed} after ${counts.steps} step(s)` : landed,
        };
      }))
      .onConflictDoNothing()
      .returning({ executionId: toolAuditEvents.executionId });
    const won = new Set(recorded.map((r) => r.executionId));
    const finished = landedRows.filter(({ e }) => won.has(Number(e.id)));
    if (finished.length > 0) {
      await telemetry.insert(toolAuditEvents).values(finished.map(({ e, landed }) => ({
        ...base(e), toolName: 'run.finished', args: JSON.stringify({ kind: 'run.finished', outcome: landed }), result: 'run.finished',
      })));
    }
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/cloudOutcomeRow.ts', operation: 'insertOutcomeRows', context: { executionIds: landedRows.map(({ e }) => Number(e.id)) } });
  }
}

/** Write the run's one outcome row for an execution that has just LANDED terminal (a won `land()`). Host runs / non-terminal skipped. */
export function recordTerminalOutcome(db: Db, e: TerminalExecution): Promise<void> {
  return insertOutcomeRows(db, [e]);
}

/**
 * The cron reaper's raw batch UPDATE bypasses the repository: it calls this right after EACH batch's UPDATE with the rows that
 * UPDATE landed (its RETURNING), so a later batch failing never loses an earlier batch's rows. One multi-row insert per batch.
 */
export function recordReapedOutcomes(
  db: Db,
  rows: ReadonlyArray<{ id: number; tenant_id: number; agent_host_id: number | null; cloud_agent_ref: string | null; error_message: string | null }>,
): Promise<void> {
  return insertOutcomeRows(db, rows.map((row) => ({
    id: row.id, tenantId: row.tenant_id, cloudAgentRef: row.cloud_agent_ref, agentHostId: row.agent_host_id, status: 'failed', errorMessage: row.error_message,
  })));
}

