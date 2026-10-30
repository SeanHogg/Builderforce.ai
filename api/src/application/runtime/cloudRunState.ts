/**
 * cloudRunState — what a durable cloud run carries between alarm ticks (PRD 35 WS3).
 *
 * The agent's own state is the contract's `RunState` (plain JSON: transcript, step, guard
 * and finish counters, model policy, memory, compaction, written paths, asked gates). The
 * HOST adds only what it resolved once and must reuse: the ticket's repo context, the
 * tenant's routing and the cost session's spend totals. Nothing here is policy.
 *
 * A cursor written before the cutover holds the old shape (OpenAI-shaped `messages`, the
 * counters at the top level). {@link toRunState} reads it once, so a deploy mid-run
 * resumes the same conversation on the one agent instead of starting it over.
 */
import { freshTally, initialModelRunState, type RunMessage, type RunState } from '@builderforce/agent-run';
import type { RunKnowledgeState } from '@builderforce/agent-tools';
import type { RunPolicyState } from '@builderforce/run-policy';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import type { ProgressDetectorState } from '@builderforce/run-guards';
import type { TaskState } from '@builderforce/agent-run';
import type { CostLoopState } from './costLoop/costLoopSession';
import type { CloudRouting } from './cloudAgent/routing';

/** The legacy (pre-agent-run) fields of a cursor, read once and never written. */
interface LegacyLoopState {
  messages?: Array<Record<string, unknown>>;
  writtenPaths?: string[];
  step?: number;
  runKnowledge?: RunKnowledgeState;
  modelPolicy?: { policy: RunPolicyState; stallRecoveries?: number; forceToolChoice?: 'required' };
  pinnedModel?: string;
  noDeliverableBlocked?: boolean;
  reviewVerdictRecorded?: boolean;
  placeholderBlocks?: number;
  ciPendingBlocks?: number;
  ciFailureBlocks?: number;
  policyAskedGates?: string[];
  /** C3 / C1 / the guards, as the old cost session persisted them. */
  taskState?: TaskState;
  loadedTools?: string[];
  progress?: ProgressDetectorState;
  cascade?: unknown;
  pendingPause?: string;
  checksNote?: string;
}

/** Mid-run state the durable (DO) surface persists between alarm ticks. */
export interface CloudLoopState extends CostLoopState, LegacyLoopState {
  /** The one agent's resume state. Absent on a cursor written before the cutover. */
  run?: RunState;
  /** The ticket's repo context, resolved on the first tick. Every tick — the finalize tick included —
   *  uses the SAME repo/branch/credential; `null` = no repo bound. */
  repoCtx?: TicketRepoContext | null;
  /** Why repo resolution missed on the first tick (empty when it resolved). */
  repoMiss?: string;
  /** The tenant's LLM routing, resolved on the first tick and reused by later ticks. */
  routing?: CloudRouting;
  /** Content hash of each written file as the run left it (path → hash). Persisted so a durable run's run-end
   *  facts stay anchored to files written on EARLIER ticks. */
  writtenHashes?: Record<string, string>;
}

/** A transcript row in the agent's own shape, read from an OpenAI-shaped one. */
function toRunMessage(row: Record<string, unknown>): RunMessage | null {
  const role = row.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') return null;
  const content = typeof row.content === 'string' ? row.content : row.content == null ? '' : JSON.stringify(row.content);
  const rawCalls = Array.isArray(row.tool_calls) ? (row.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) : [];
  const toolCalls = rawCalls.map((c) => ({ id: c.id ?? '', name: c.function?.name ?? '', arguments: c.function?.arguments ?? '' }));
  return {
    role,
    content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(typeof row.tool_call_id === 'string' ? { toolCallId: row.tool_call_id } : {}),
  };
}

/**
 * The state to resume the one agent from, or undefined for a fresh run. A cursor that already carries `run` resumes as it is; a
 * legacy cursor is converted field for field. `trustedApprovals` are the legacy gate keys the execution's approval record confirms
 * (see `trustedLegacyApprovals`); with none, a legacy cursor resumes with NO call pre-approved.
 */
export function toRunState(saved: CloudLoopState | undefined, trustedApprovals: readonly string[] = []): RunState | undefined {
  if (!saved) return undefined;
  if (saved.run) return saved.run;
  if (!Array.isArray(saved.messages)) return undefined;
  // A cursor older than the model policy carried only the locked model id: it resumes on that model with the
  // run-start defaults (lock after first success, a releasable pin, a declining head), exactly as it always did.
  const model = saved.modelPolicy?.policy ?? initialModelRunState({ pick: { model: saved.pinnedModel ?? '', strict: false }, delegatedRole: undefined }).policy;
  const messages = saved.messages.map(toRunMessage).filter((m): m is RunMessage => m !== null);
  return {
    messages,
    step: saved.step ?? 0,
    guards: {
      ...(saved.progress ? { progress: saved.progress } : {}),
      ...(saved.cascade ? { cascade: saved.cascade as unknown as NonNullable<RunState['guards']['cascade']> } : {}),
      ...(saved.pendingPause ? { pendingPause: saved.pendingPause } : {}),
      ...(saved.checksNote ? { checksNote: saved.checksNote } : {}),
    },
    finish: {
      noDeliverableBlocked: saved.noDeliverableBlocked ?? false,
      reviewVerdictRecorded: saved.reviewVerdictRecorded ?? false,
      placeholderBlocks: saved.placeholderBlocks ?? 0,
      ciPendingBlocks: saved.ciPendingBlocks ?? 0,
      ciFailureBlocks: saved.ciFailureBlocks ?? 0,
      ciVerified: false,
      finishBlockedOnce: false,
    },
    model,
    memory: saved.runKnowledge ?? { memory: { created: [], edited: [], deleted: [], read: [], searched: [] }, tools: [] },
    compaction: { compactions: 0 },
    writtenPaths: saved.writtenPaths ?? [],
    askedGates: [],
    // TRANSITIONAL (drop with the legacy shape): the old engine recorded `policyAskedGates` at ASK time, so a key there does NOT mean
    // the call was approved - a cursor parked on a still-pending approval, or on one that was rejected, holds the key too. Only the
    // keys the execution's approval record confirms (`trustedLegacyApprovals`) resume as APPROVED calls.
    approvedCalls: [...trustedApprovals],
    // A cursor written before the cutover carried no tally: the run resumes counting from here, so its tally covers only the rest of
    // the run - PARTIAL, and its cost UNKNOWN (null: the turns before the cutover are not in it) - and the outcome row records no counts for it (absent, never a floor presented as the total).
    telemetry: { ...freshTally(), costMc: null, partial: true },
    ...(saved.modelPolicy?.forceToolChoice ? { forceToolChoice: saved.modelPolicy.forceToolChoice } : {}),
    ...(saved.taskState ? { taskState: saved.taskState } : {}),
    ...(saved.loadedTools ? { loadedTools: saved.loadedTools } : {}),
    reads: { served: {}, readsWithoutSpawn: { reads: 0, spawned: false, nudged: false } },
    ...(saved.modelPolicy ? { stall: { ...(model.model ? { model: model.model } : {}), recoveriesUsed: saved.modelPolicy.stallRecoveries ?? 0 } } : {}),
  };
}
