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
import { recordCloudToolEvent } from './cloudToolEvents';

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
 * Write the run's one outcome row for an execution that has just landed terminal. A self-hosted run and a non-terminal status are
 * skipped. Never throws (telemetry).
 */
export async function recordTerminalOutcome(db: Db, e: TerminalExecution): Promise<void> {
  const landed = LANDED[e.status];
  if (!landed || e.agentHostId != null) return;
  const executionId = Number(e.id);
  const counts = pendingCounts.get(executionId);
  pendingCounts.delete(executionId);
  const written = await recordCloudToolEvent(db, {
    tenantId: Number(e.tenantId),
    ...(e.cloudAgentRef ? { cloudAgentRef: e.cloudAgentRef } : {}),
    executionId,
    toolName: OUTCOME_ROW_TOOL,
    category: 'run',
    detail: { entryPoint: 'cloud', runId: cloudRunId(executionId), ...counts, terminalStatus: landed, ...(landed !== 'finished' && e.errorMessage ? { reason: e.errorMessage } : {}) },
    result: counts?.steps !== undefined ? `${landed} after ${counts.steps} step(s)` : landed,
    once: true,
  });
  // The trace closes with the status the run LANDED as — written only by the writer that recorded the row.
  if (written) {
    await recordCloudToolEvent(db, {
      tenantId: Number(e.tenantId),
      ...(e.cloudAgentRef ? { cloudAgentRef: e.cloudAgentRef } : {}),
      executionId,
      toolName: 'run.finished',
      category: 'run',
      detail: { kind: 'run.finished', outcome: landed },
      result: 'run.finished',
    });
  }
}

/**
 * The cron reaper fails runs with a raw batch UPDATE that bypasses the repository, so it reports what it failed here: every
 * cloud run it moved to `failed` (queued, running or paused alike) gets the same one row, with the reaper's reason.
 */
export async function recordReapedOutcomes(
  db: Db,
  rows: ReadonlyArray<{ id: number; tenant_id: number; agent_host_id: number | null; cloud_agent_ref: string | null; error_message: string | null }>,
): Promise<void> {
  for (const row of rows) {
    await recordTerminalOutcome(db, {
      id: row.id, tenantId: row.tenant_id, cloudAgentRef: row.cloud_agent_ref, agentHostId: row.agent_host_id, status: 'failed', errorMessage: row.error_message,
    });
  }
}
