/**
 * A cloud SUB-AGENT is its own durable execution with an owner pointer — the cloud form
 * of the editor's run lineage.
 *
 * It runs on the same runner, through the same engine, as every other cloud run; what
 * makes it a child is the `subagent` spec on its payload and `parent_execution_id` on its
 * row (1209). This module owns what follows from that pointer and nothing else:
 *
 *   • its brief      — the sub-agent instructions in front of the parent's prompt;
 *   • its lineage    — which children of a run are still live;
 *   • its delivery   — when it ends, its report goes to the chat AND, exactly once, to
 *                      its parent as a steer read before the parent's next turn;
 *   • the cascade    — a parent that ends takes its live children with it.
 *
 * Spawning and the parent's verbs are `cloudLiveOrchestration.ts`.
 */

import { eq, inArray } from 'drizzle-orm';
import { childReportText, clipChildOutput, type ChildReportLike } from '@builderforce/agent-tools';
import { parseSubagentReport } from '@builderforce/agent-loop';
import { executions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TERMINAL_EXECUTION_STATUSES } from '../../domain/execution/Execution';
import type { ExecutionStatus } from '../../domain/shared/types';
import { EXECUTION_NON_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';
import { listBranchDiff, readRepoFile } from '../repos/readRepoContents';
import type { RepoFileReader } from '../repos/repoReadMemo';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { enqueueExecutionMessage, releasePendingSteers } from './executionSteering';
import { parseCloudAgentRef, parseOriginatingChatId } from './cloudDispatch';
import { postSubagentChatReport } from './subagentChatReport';
import { rehashPaths, type WrittenFileHashes } from './cloudAgent/writtenFileHashes';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { RuntimeService } from './RuntimeService';
import { MAX_CHILD_ROWS } from './cloudChildSpec';

import { childHandle, childIdOf, parseCloudChild, type CloudChildSpec } from './cloudChildSpec';
export { childBrief, childHandle, childIdOf, childPayload, isSubagentRun, parseCloudChild, withCloudChildHandle, type CloudChildSpec } from './cloudChildSpec';

type ChildRow = { id: number; status: string; payload: string | null; result: string | null; errorMessage: string | null };

const isTerminal = (status: string): boolean => TERMINAL_EXECUTION_STATUSES.includes(status as ExecutionStatus);

/** Children still working — ids only, filtered in SQL: liveness never needs the report blobs. */
async function liveChildIds(db: Db, tenantId: number, parentExecutionId: number): Promise<number[]> {
  const rows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(scopedToTenant(executions, tenantId, eq(executions.parentExecutionId, parentExecutionId), inArray(executions.status, [...EXECUTION_NON_TERMINAL_STATUSES])))
    .limit(MAX_CHILD_ROWS);
  return rows.map((r) => r.id);
}

/** Handles of a run's children that are still working. */
export async function liveChildHandles(db: Db, tenantId: number, parentExecutionId: number): Promise<string[]> {
  return (await liveChildIds(db, tenantId, parentExecutionId)).map(childHandle);
}

/**
 * Why a parent may not finish yet, or null. A run that ends with children still working
 * would strand their reports — and it opens the pull request without their changes.
 */
export async function liveChildrenFinishBlock(db: Db, tenantId: number, parentExecutionId: number): Promise<string | null> {
  const live = await liveChildHandles(db, tenantId, parentExecutionId);
  return live.length
    ? `Your sub-agents ${live.join(', ')} are still running. Call wait_agents (their reports arrive as messages) or stop_agent before you finish — the pull request must include their work.`
    : null;
}

/**
 * The files a run's descendants committed to its branch, added to the run's own written
 * set — they committed from their own runs, so it never saw the writes. Read from the
 * branch itself, so it is exactly what the pull request will hold (grandchildren too).
 */
export async function absorbChildWrites(
  db: Db,
  tenantId: number,
  parentExecutionId: number,
  repoCtx: TicketRepoContext | null,
  writtenPaths: Set<string>,
  /** The parent's own per-file hashes. The branch diff cannot say WHICH of its paths a child
   *  rewrote, so every path on it is re-hashed from its final content on the branch (read
   *  through `readRepoFile`, as the write/edit tools do); one that cannot be read drops its
   *  entry — an unhashed anchor is merely never stale, where a hash of text a child replaced
   *  would mark the fact stale on the first recall. */
  writtenHashes?: WrittenFileHashes,
  /** How the branch's files are read for the re-hash; defaults to `readRepoFile` on the run's
   *  branch. The finish gates pass the memo they share with `verifyWrittenFiles`, so a path
   *  is read once per finish attempt, not once per consumer. */
  read?: RepoFileReader,
): Promise<void> {
  if (!repoCtx) return;
  const [anyChild] = await db
    .select({ id: executions.id })
    .from(executions)
    .where(scopedToTenant(executions, tenantId, eq(executions.parentExecutionId, parentExecutionId)))
    .limit(1);
  if (!anyChild) return;
  const diff = await listBranchDiff({ ...repoCtx, ref: repoCtx.branch }, repoCtx.base, repoCtx.branch);
  if (!diff.ok) return;
  for (const f of diff.files) writtenPaths.add(f.path);
  if (!writtenHashes) return;
  const readFile: RepoFileReader = read ?? ((path) => readRepoFile({ ...repoCtx, ref: repoCtx.branch }, path));
  await rehashPaths(writtenHashes, diff.files, async (path) => {
    const file = await readFile(path);
    return file.ok && !file.truncated ? file.content : null;
  });
}

const childStateOf = (row: ChildRow): ChildReportLike['state'] =>
  row.status === 'completed' ? 'done' : row.status === 'cancelled' ? 'stopped' : 'failed';

/** A settled child's whole answer — what the chat carries; its owner reads it clipped. */
function childAnswerOf(row: ChildRow): string {
  return (childStateOf(row) === 'done' ? row.result : row.errorMessage ?? row.result) ?? '';
}

function reportOf(row: ChildRow, spec: CloudChildSpec): ChildReportLike {
  const state = childStateOf(row);
  const answer = childAnswerOf(row);
  const { openIssues, unverifiedClaims } = parseSubagentReport(answer);
  return {
    handle: spec.handle,
    name: spec.asAgent?.name ?? spec.persona?.name ?? spec.label,
    state,
    label: spec.label,
    output: clipChildOutput(answer),
    ...(spec.ticket ? { ticket: spec.ticket } : {}),
    ...(openIssues.length ? { openIssues } : {}),
    ...(unverifiedClaims?.length ? { unverifiedClaims } : {}),
  };
}

/**
 * A run reached a terminal state on the durable runner. If it is a child, its report goes
 * to the chat and to its parent; if it is a parent, its live children are stopped.
 * Best-effort and called from the runner's ONE terminal chokepoint.
 */
export async function settleCloudChildLineage(db: Db, runtime: RuntimeService, executionId: number): Promise<void> {
  try {
    const [row] = await db
      .select({ id: executions.id, tenantId: executions.tenantId, status: executions.status, payload: executions.payload, result: executions.result, errorMessage: executions.errorMessage, parentExecutionId: executions.parentExecutionId })
      .from(executions)
      .where(eq(executions.id, executionId))
      .limit(1);
    if (!row) return;
    await stopLiveChildren(db, runtime, row.tenantId, executionId, `execution:${executionId}`);
    const spec = parseCloudChild(row.payload);
    if (!spec || row.parentExecutionId == null) return;
    const report = reportOf(row, spec);
    // The chat hears every child, as it does in the editor — whole: the owner's clipped
    // copy points here for the rest ("the full text is in the chat").
    const answer = childAnswerOf(row);
    await postSubagentChatReport(db, row.tenantId, parseOriginatingChatId(row.payload), parseCloudAgentRef(row.payload ?? undefined), {
      ok: report.state === 'done',
      label: spec.label,
      output: answer,
      ...(report.state !== 'done' ? { error: answer || `the sub-agent ${report.state}` } : {}),
      ...(spec.ticket ? { ticket: spec.ticket } : {}),
      ...(spec.asAgent ? { asAgent: spec.asAgent } : {}),
    });
    // The parent hears it once, before its next turn — unless it has already ended.
    const [parent] = await db.select({ status: executions.status }).from(executions).where(scopedToTenant(executions, row.tenantId, eq(executions.id, row.parentExecutionId))).limit(1);
    if (parent && !isTerminal(parent.status)) {
      await enqueueExecutionMessage(db, { executionId: row.parentExecutionId, tenantId: row.tenantId, role: 'user', text: childReportText(report) });
    }
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/cloudChildRuns.ts', operation: 'settleCloudChildLineage', context: { executionId } });
  }
}

/** Stop a run's live children (all, or the named handles). Returns the handles stopped. */
export async function stopLiveChildren(db: Db, runtime: RuntimeService, tenantId: number, parentExecutionId: number, by: string, handles?: readonly string[]): Promise<string[]> {
  const wanted = handles ? new Set(handles.map(childIdOf).filter((id): id is number => id != null)) : null;
  const live = (await liveChildIds(db, tenantId, parentExecutionId)).filter((id) => !wanted || wanted.has(id)).map((id) => ({ id }));
  const stopped: string[] = [];
  for (const child of live) {
    try {
      await runtime.cancel(child.id, by);
    } catch {
      // It ended on its own between the read and the cancel — nothing left to stop.
      continue;
    }
    await releasePendingSteers(db, tenantId, child.id);
    stopped.push(childHandle(child.id));
  }
  return stopped;
}

/** The child rows of a parent, by handle — for a wait or a message addressed to them. */
export async function childRowsByHandle(db: Db, tenantId: number, parentExecutionId: number, handles: readonly string[]): Promise<ChildRow[]> {
  const ids = handles.map(childIdOf).filter((id): id is number => id != null);
  if (!ids.length) return [];
  return db
    .select({ id: executions.id, status: executions.status, payload: executions.payload, result: executions.result, errorMessage: executions.errorMessage })
    .from(executions)
    .where(scopedToTenant(executions, tenantId, eq(executions.parentExecutionId, parentExecutionId), inArray(executions.id, ids)));
}

export { isTerminal as isTerminalExecutionStatus };
