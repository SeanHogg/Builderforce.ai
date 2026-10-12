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
import { childReportText, type ChildReportLike, type ModelRole } from '@builderforce/agent-tools';
import { subagentSystemPrompt } from '@builderforce/agent-loop';
import { executions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TERMINAL_EXECUTION_STATUSES } from '../../domain/execution/Execution';
import type { ExecutionStatus } from '../../domain/shared/types';
import { parseJsonObject } from '../../domain/shared/json';
import { listBranchDiff } from '../repos/readRepoContents';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { enqueueExecutionMessage, releasePendingSteers } from './executionSteering';
import { parseCloudAgentRef, parseOriginatingChatId } from './cloudDispatch';
import { postSubagentChatReport } from './subagentChatReport';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { RuntimeService } from './RuntimeService';

/** The payload key a child's spec rides under. */
const SPEC_KEY = 'subagent';

/** Everything a child execution needs to know about itself, carried on its payload. */
export interface CloudChildSpec {
  parentExecutionId: number;
  /** The run at the top of its tree — the one its tokens bill to and that opens the PR. */
  rootExecutionId: number;
  /** 1 for a child, 2 for a grandchild … (spawning stops at `MAX_SUBAGENT_DEPTH`). */
  depth: number;
  /** How its owner addresses it (`message_agent`, `stop_agent`, reports). */
  handle: string;
  label: string;
  task: string;
  role?: ModelRole;
  /** Who it runs as — resolved by the parent at spawn, so the child never re-resolves. */
  persona?: { name: string; brief: string };
  asAgent?: { ref: string; name: string };
  staffing?: string;
  ticket?: string;
  /** Its owner's display name, for the brief and for direction it reads. */
  owner: string;
}

/** A child's handle is its execution id — unique, stateless, and parseable back. */
export const childHandle = (executionId: number): string => `a${executionId}`;
export function childIdOf(handle: string): number | null {
  const m = /^a(\d+)$/.exec(handle.trim());
  return m ? Number(m[1]) : null;
}

export function parseCloudChild(payload: string | null | undefined): CloudChildSpec | null {
  if (!payload) return null;
  try {
    const spec = (JSON.parse(payload) as Record<string, unknown>)[SPEC_KEY] as CloudChildSpec | undefined;
    return spec && typeof spec.parentExecutionId === 'number' && typeof spec.task === 'string' ? spec : null;
  } catch {
    return null;
  }
}

/** Whether a run is someone's sub-agent — a slice of its parent's run, never a run of its own. */
export const isSubagentRun = (payload: string | null | undefined): boolean => parseCloudChild(payload) !== null;

/** The child's payload: its owner's routing (chat, agent, model, gates) and its own spec. */
export function childPayload(parentPayload: string | undefined, spec: CloudChildSpec): string {
  // An unreadable parent payload just carries nothing forward.
  const parent = parseJsonObject(parentPayload);
  // Only what routes and governs the run is inherited. A parent's follow-up directive,
  // role instruction or review sign-off is ITS job, not the child's.
  const inherited = Object.fromEntries(
    ['chatId', 'cloudAgentRef', 'model', 'policyGates', 'routingBias'].filter((k) => k in parent).map((k) => [k, parent[k]]),
  );
  // `lifecycleNeutral`: a child never moves the ticket or speaks for a managed stage.
  return JSON.stringify({ ...inherited, executor: 'durable', lifecycleNeutral: true, [SPEC_KEY]: spec });
}

/** The child's prompt and first turn — the sub-agent brief in front of its owner's prompt. */
export function childBrief(spec: CloudChildSpec, basePrompt: string): { systemPrompt: string; userContent: string } {
  return {
    systemPrompt: `${subagentSystemPrompt(spec.persona, { owner: spec.owner })}\n\n${basePrompt}`,
    userContent: spec.task,
  };
}

type ChildRow = { id: number; status: string; payload: string | null; result: string | null; errorMessage: string | null };

const isTerminal = (status: string): boolean => TERMINAL_EXECUTION_STATUSES.includes(status as ExecutionStatus);

export async function childrenOf(db: Db, tenantId: number, parentExecutionId: number): Promise<ChildRow[]> {
  return db
    .select({ id: executions.id, status: executions.status, payload: executions.payload, result: executions.result, errorMessage: executions.errorMessage })
    .from(executions)
    .where(scopedToTenant(executions, tenantId, eq(executions.parentExecutionId, parentExecutionId)));
}

/** Handles of a run's children that are still working. */
export async function liveChildHandles(db: Db, tenantId: number, parentExecutionId: number): Promise<string[]> {
  return (await childrenOf(db, tenantId, parentExecutionId)).filter((c) => !isTerminal(c.status)).map((c) => childHandle(c.id));
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
export async function absorbChildWrites(db: Db, tenantId: number, parentExecutionId: number, repoCtx: TicketRepoContext | null, writtenPaths: Set<string>): Promise<void> {
  if (!repoCtx) return;
  if (!(await childrenOf(db, tenantId, parentExecutionId)).length) return;
  const diff = await listBranchDiff({ ...repoCtx, ref: repoCtx.branch }, repoCtx.base, repoCtx.branch);
  if (diff.ok) for (const f of diff.files) writtenPaths.add(f.path);
}

function reportOf(row: ChildRow, spec: CloudChildSpec): ChildReportLike {
  const state = row.status === 'completed' ? 'done' : row.status === 'cancelled' ? 'stopped' : 'failed';
  return {
    handle: spec.handle,
    name: spec.asAgent?.name ?? spec.persona?.name ?? spec.label,
    state,
    label: spec.label,
    output: (state === 'done' ? row.result : row.errorMessage ?? row.result) ?? '',
    ...(spec.ticket ? { ticket: spec.ticket } : {}),
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
    // Direction that reached a child after its last turn has nobody left to act on it —
    // its owner, not a follow-up run, decides what happens next.
    await releasePendingSteers(db, row.tenantId, executionId);
    const report = reportOf(row, spec);
    // The chat hears every child, as it does in the editor.
    await postSubagentChatReport(db, row.tenantId, parseOriginatingChatId(row.payload), parseCloudAgentRef(row.payload ?? undefined), {
      ok: report.state === 'done',
      label: spec.label,
      output: report.output,
      ...(report.state !== 'done' ? { error: report.output || `the sub-agent ${report.state}` } : {}),
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
  const live = (await childrenOf(db, tenantId, parentExecutionId)).filter((c) => !isTerminal(c.status) && (!wanted || wanted.has(c.id)));
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
