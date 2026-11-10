/**
 * ONE run's state — what `runPreamble.ts` resolves before the first turn and every
 * port of the agent's run (`run/runPrepared.ts`) reads and advances. The ports live in
 * their own modules; this object is what they share, so a counter or a cache can never
 * exist twice. Fields below `policy` change while the run runs; the rest are fixed once
 * the preamble returns.
 */

import { reduceRunPolicy, type RunPolicyEvent, type RunPolicyState } from '@builderforce/run-policy';
import { replayTextOf } from '@builderforce/agent-loop';
import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { BrainMessage } from '../types';
import type { BrainToolSpec, ChatCompletionMessage, CompletionMetadata, StreamChatResult } from '../streamChatCompletion';
import { isRepoStateReadTool } from '../localWorkspaceTools';
import { isReadOnlyPlatformTool } from '../chatWorkLinking';
import type { ReadCoverage } from '../readCoverage';
import type { RunKnowledgeLog } from '@builderforce/agent-tools';
import { failureReason, repeatedFailureAdvisory, type EvidenceLedger, type FailureTally, type WriteLedger } from '@builderforce/run-guards';
import type { PlaceholderLedger } from '../completionGuard';
import type { turnInterruption } from '../finishReason.js';
import type { RunWindowFit } from '../windowFit/runWindowFit';
import type { RunCell } from './runCell';
import type { PublishHold } from './publishHold';
import type { PendingCalls } from './pendingCalls';
import { nowIso, pushTrace, recordAppended } from './runCells';
import { canonicalTurnText, provenanceMetadata } from './turnPersistence';
import type { BrainRunRequest } from './runTypes';
import type { RunPipeline } from './pipelineRoute';
import type { CacheServedStreak, RunView } from '@builderforce/agent-run';
import type { RunProgressGuard } from './progressGuard';
import type { OutcomeReport } from '../run/eventSink';

/** Read-only, idempotent LOCAL file/search tools whose exact-repeat call within a run is
 *  suppressed (the result is already in context). Read-only PLATFORM (`builtin_*`) tools
 *  are covered separately by {@link isReadOnlyPlatformTool} — together they are the
 *  `isDedupableRead` set. Deliberately narrow — only tools that observe and can't mutate,
 *  so a stubbed repeat never hides a real change (a mutation clears the dedupe set anyway;
 *  see `readCoverage.ts`). The repeat key is the tool plus ALL its canonical args, so a
 *  `local_research` call is a repeat only when it asks the same question of the same
 *  files; a code change forgets it like any tree-wide read (`run-guards` readCoverage). */
const DEDUP_READ_TOOLS = new Set(['read_file', 'search_code', 'list_files', 'find_symbol', 'file_outline', 'semantic_search', 'repo_map', 'read_compressed', 'local_research']);

/** A tool whose identical-args repeat within a run is safe to suppress: a local file/search
 *  tool, a host read of repository state (`review_ticket_branches` — forgotten by every
 *  push / sync / platform write, see `REPO_STATE_READ_TOOLS`) OR a read-only platform tool. This is the fix for the "Brain re-checks the same
 *  roster / tickets / tasks every turn until it burns the iteration cap" loop — previously
 *  ONLY the 3 local file tools deduped, and any platform (MCP) call both went un-deduped
 *  AND wiped the cache, so repeated `builtin_*_list`/`_assignees` calls re-ran every turn. */
export const isDedupableRead = (name: string): boolean =>
  DEDUP_READ_TOOLS.has(name) || isRepoStateReadTool(name) || isReadOnlyPlatformTool(name);

export interface BrainRunContext {
  /** The chat's key in the host's persistence — where the run's turns are written. */
  chatId: number;
  /** The server chat the run's server-addressed work names (`resolveServerChatId`);
   *  null on an unbound local chat, whose id never leaves the machine. */
  serverChatId: number | null;
  /** The run's OWN cell key — a sub-agent's differs from the chat it lives in. */
  runKey: number;
  c: RunCell;
  req: BrainRunRequest;
  /** Told the run's uniform outcome row (PRD 35 §8.2) once, when it ends: `startRun` holds it and merges the coder's grade in. Not part of the host's request. */
  reportRunRow?: OutcomeReport;
  /** The cell's working transcript (`c.transcript`), appended to as the run goes. */
  convo: ChatCompletionMessage[];
  /** `ask_user` / `hand_off` are advertised (a runner AND a non-empty host catalog). */
  canAskUser: boolean;
  /** The catalog the model is shown, plus the conversational tools. */
  allTools: BrainToolSpec[] | undefined;
  /** The tools this host advertised for the run, by name. */
  catalogToolNames: string[];
  /** Tool names every turn's selection must keep (see `runPreamble.ts`). */
  alwaysAdvertised: string[];
  /** Tools this run has actually called — pinned into every later turn's selection. */
  usedTools: Set<string>;
  /** The run's system prompt, every directive folded in. */
  systemPrompt: string;
  /** Caller provenance for the gateway's audit emit, shared by every model-facing turn. */
  metadata: CompletionMetadata;
  /** The pre-turn Evermind recall, and the prompt tokens its block adds to every call. */
  recalled: EvermindRecallResult | null;
  recallBlockTokens: number;
  /** May memory answer this turn, and may its answer be stored (`memoryReplayable`). */
  memoryReplay: boolean;
  /** The user's OWN request for this run, captured before the loop writes any nudge. */
  userRequest: string;
  /** This chat's PUBLISH HOLD ({@link publishHold}), or null while the chat may ship. */
  publishHold: PublishHold | null;
  /** The goal a hand-off states to its coders — {@link userRequest} plus the chat's earlier asks. */
  goal: string;
  /** The previous turn's reply — what a restated final answer is compared against. */
  priorReply: string;
  /** The request every turn's tool selection scores against. */
  requestQuery: string;
  /** The window-fit gate every request passes through. */
  windowFit: RunWindowFit;
  readCoverage: ReadCoverage;
  /** Consecutive calls the read cache answered — the no-progress breaker (`cacheServedStreak.ts`). */
  cacheStreak: CacheServedStreak;
  /** The A3 progress detector, bound to this run (`progressGuard.ts`). */
  progress: RunProgressGuard;
  /** The run's ONE record of what it did and read — the source of each turn's ledger. */
  knowledge: RunKnowledgeLog;
  failures: FailureTally;
  writeLedger: WriteLedger;
  placeholderLedger: PlaceholderLedger;
  /** The run's evidence ledger (PRD 45 §4.2): checks the HOST ran, keyed by the bytes
   *  on disk. The ship gates read it; the model's prose can never write to it. One
   *  run's lifetime — a resumed run re-checks (the host verifier caches). */
  evidence: EvidenceLedger;

  /** The run's pipeline route (`pipelineRoute.ts`), or null when the run was not routed. */
  pipeline: RunPipeline | null;

  /** THE model hand-off policy's state — advanced only through {@link reportToPolicy}. */
  policy: RunPolicyState;
  /** The agent's live run, when it drives this one (`run/runPrepared.ts`): the policy is ITS state, and events go to it. */
  view?: RunView;
  /** One re-prompt each per run (see the final-answer gates). */
  shipRecoveryUsed: boolean;
  reviewRecoveryUsed: boolean;
  delegationRecoveryUsed: boolean;
  restateRecoveryUsed: boolean;
  /** The planner was already told once that its `hand_off` tasks overlap (`handOffParallelism.ts`); the next plan is carried out as is. */
  handOffClashRefused?: boolean;
  /** Re-prompts this run has had from the host's stop hook (bounded in `stopHooks.ts`). */
  stopHookRounds: number;
  /** Carries the undelegated-request decision from `beforeToolCalls` to the `ask_user`
   *  dispatch it answers. */
  redirectAskToDelegation: boolean;
  /**
   * The auto-answer the host's `answerQuestion` resolved for the `ask_user` question this
   * turn settled on (Auto mode). Carried to the `ask_user` dispatch, which returns it as the
   * call's result so the run continues with the answer as the next user turn instead of
   * stalling on the question card. Undefined when the question settled normally (Auto off,
   * or the resolver returned null).
   */
  pendingAskAutoAnswer?: string;
  /** What each in-flight call carries from preflight / dispatch to its post step, keyed by call id — the calls of one read-only
   *  batch run concurrently (D8), so no state of "the" call in flight may be shared (`pendingCalls.ts`). */
  pending: PendingCalls;
  /** The finish reason of the turn that produced the call being dispatched. A malformed
   *  call is either the tail of a response that hit the output ceiling or JSON the model
   *  simply got wrong, and the advice for the two is opposite. */
  lastTurnInterruption: ReturnType<typeof turnInterruption>;
}

/** Report an event to the run policy; the new state is the run's. */
export function reportToPolicy(run: BrainRunContext, event: RunPolicyEvent): RunPolicyState {
  if (run.view) return run.view.report(event);
  return (run.policy = reduceRunPolicy(run.policy, event));
}

/**
 * Record a failed call and return the advisory the MODEL should read with it, or null
 * while a retry is still reasonable. The intervention is its own trace step — exactly
 * as the revisit guard's is — so triage can see the loop was fought rather than
 * inferring it from the repetition.
 */
export function failureAdvisoryFor(run: BrainRunContext, name: string, args: unknown, out: unknown, step: number): string | null {
  const attempts = run.failures.record(name, args);
  const advisory = repeatedFailureAdvisory(name, attempts, failureReason(out));
  if (advisory) {
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'tools.repeat_failure_guard',
      args: { step, tool: name, attempts },
      result: advisory,
    });
  }
  return advisory;
}

/**
 * Commit a turn's text as THE reply of this run: into the model transcript, into
 * the durable message list (carrying the turn's provenance), and into the mounted
 * views. Returns the persisted message so the caller can hang the Evermind
 * learn/reconcile provenance off it.
 *
 * Shared by the two ways a run settles — the ordinary no-tool-calls final answer
 * and a TERMINAL `ask_user` question — because a question is a reply: it must be
 * attributed, learned from and broadcast exactly like any other, or the surface
 * that renders it loses the provenance chip and the memory steps for that turn.
 */
export async function settleReply(run: BrainRunContext, rawText: string, result: StreamChatResult, requested?: string): Promise<BrainMessage> {
  const { convo } = run;
  const text = canonicalTurnText(rawText);
  // The agent's store log already carries the final answer row, shaped as the agent settled it: one copy only - never two assistant rows
  // in a row - and it reads as the model is shown a past turn (`replayTextOf`). The loop never has an assistant row at its tail here.
  const tail = convo[convo.length - 1];
  if (tail?.role === 'assistant' && !tail.tool_calls) tail.content = replayTextOf(text);
  else convo.push({ role: 'assistant', content: replayTextOf(text) });
  return persistReply(run, rawText, result, requested);
}

/**
 * Persist a turn's text as a reply of the chat - the durable message with the turn's provenance, the mounted views told - without
 * touching the model transcript. The Brain's run end settles a reply with it ({@link settleReply}); the agent persists the reply of a model that
 * stalled out and was handed over (`run/brainDelivery.ts`), whose row its own transcript already holds.
 */
export async function persistReply(run: BrainRunContext, rawText: string, result: StreamChatResult, requested?: string): Promise<BrainMessage> {
  const { c, chatId } = run;
  const text = canonicalTurnText(rawText);
  const meta = provenanceMetadata(result, requested);
  const [assistantMsg] = await run.req.persistence.sendMessages(chatId, [{ role: 'assistant', content: text, ...(meta ? { metadata: meta } : {}) }]);
  c.streamingText = '';
  recordAppended(c, assistantMsg);
  return assistantMsg;
}
