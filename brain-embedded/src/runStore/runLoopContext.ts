/**
 * ONE run's loop state — what `runPreamble.ts` resolves before the first turn and every
 * hook and port of the loop (`runLoop.ts`) reads and advances. The loop's parts live in
 * their own modules; this object is what they share, so a counter or a cache can never
 * exist twice. Fields below `policy` change while the run runs; the rest are fixed once
 * the preamble returns.
 */

import { reduceRunPolicy, type RunPolicyEvent, type RunPolicyState } from '@builderforce/run-policy';
import { replayTextOf, type LoopTurn } from '@builderforce/agent-loop';
import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { BrainMessage } from '../types';
import type { BrainToolSpec, ChatCompletionMessage, CompletionMetadata, StreamChatResult } from '../streamChatCompletion';
import { isRepoStateReadTool } from '../localWorkspaceTools';
import { isReadOnlyPlatformTool } from '../chatWorkLinking';
import type { ReadCoverage } from '../readCoverage';
import type { RunKnowledgeLog } from '@builderforce/agent-tools';
import { failureReason, repeatedFailureAdvisory, type FailureTally, type WriteLedger } from '@builderforce/run-guards';
import type { PlaceholderLedger } from '../completionGuard';
import type { turnInterruption } from '../finishReason.js';
import type { RunWindowFit } from '../windowFit/runWindowFit';
import type { RunCell } from './runCell';
import { nowIso, pushTrace, recordAppended } from './runCells';
import { canonicalTurnText, provenanceMetadata } from './turnPersistence';
import type { BrainRunRequest } from './runTypes';

/** Read-only, idempotent LOCAL file/search tools whose exact-repeat call within a run is
 *  suppressed (the result is already in context). Read-only PLATFORM (`builtin_*`) tools
 *  are covered separately by {@link isReadOnlyPlatformTool} — together they are the
 *  `isDedupableRead` set. Deliberately narrow — only tools that observe and can't mutate,
 *  so a stubbed repeat never hides a real change (a mutation clears the dedupe set anyway;
 *  see `readDedupe.ts`). */
const DEDUP_READ_TOOLS = new Set(['read_file', 'search_code', 'list_files', 'find_symbol', 'file_outline', 'semantic_search', 'repo_map']);

/** A tool whose identical-args repeat within a run is safe to suppress: a local file/search
 *  tool, a host read of repository state (`review_ticket_branches` — forgotten by every
 *  push / sync / platform write, see `REPO_STATE_READ_TOOLS`) OR a read-only platform tool. This is the fix for the "Brain re-checks the same
 *  roster / tickets / tasks every turn until it burns the iteration cap" loop — previously
 *  ONLY the 3 local file tools deduped, and any platform (MCP) call both went un-deduped
 *  AND wiped the cache, so repeated `builtin_*_list`/`_assignees` calls re-ran every turn. */
export const isDedupableRead = (name: string): boolean =>
  DEDUP_READ_TOOLS.has(name) || isRepoStateReadTool(name) || isReadOnlyPlatformTool(name);

/** Per-turn facts BOTH the tool path and the final-answer path read, carried on the turn. */
export interface TurnMeta { result: StreamChatResult; resolved: string; requested: string; advertised: number; advertisedNames: Set<string> }
export const metaOf = (turn: LoopTurn): TurnMeta => turn.meta as TurnMeta;

export interface RunLoopContext {
  /** The chat's key in the host's persistence — where the run's turns are written. */
  chatId: number;
  /** The server chat the run's server-addressed work names (`resolveServerChatId`);
   *  null on an unbound local chat, whose id never leaves the machine. */
  serverChatId: number | null;
  /** The run's OWN cell key — a sub-agent's differs from the chat it lives in. */
  runKey: number;
  c: RunCell;
  req: BrainRunRequest;
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
  /** The previous turn's reply — what a restated final answer is compared against. */
  priorReply: string;
  /** The request every turn's tool selection scores against. */
  requestQuery: string;
  /** The window-fit gate every request passes through. */
  windowFit: RunWindowFit;
  readCoverage: ReadCoverage;
  /** The run's ONE record of what it did and read — the source of each turn's ledger. */
  knowledge: RunKnowledgeLog;
  failures: FailureTally;
  writeLedger: WriteLedger;
  placeholderLedger: PlaceholderLedger;

  /** THE model hand-off policy's state — advanced only through {@link reportToPolicy}. */
  policy: RunPolicyState;
  /** A one-shot forced tool choice from stall recovery, consumed by the next turn. */
  forceToolChoice: 'required' | undefined;
  /** The current streak of narration-only turns the stall recovery has re-prompted. */
  announcementRecoveries: number;
  /** One re-prompt each per run (see the final-answer gates). */
  shipRecoveryUsed: boolean;
  reviewRecoveryUsed: boolean;
  delegationRecoveryUsed: boolean;
  restateRecoveryUsed: boolean;
  /** Re-prompts this run has had from the host's stop hook (bounded in `stopHooks.ts`). */
  stopHookRounds: number;
  /** Carries the undelegated-request decision from `beforeToolCalls` to the `ask_user`
   *  dispatch it answers. */
  redirectAskToDelegation: boolean;
  /** A replayed read waits for its row to be pushed so the cache can anchor to it. */
  pendingReplay: { name: string; args: unknown; result: unknown; served?: unknown } | null;
  /** What dispatch learned about the call it just ran — for the durable step + the read cache.
   *  `served` is the `read_file` window the model was handed (before the advisory), which
   *  read coverage records instead of the untrimmed `out`. */
  pendingRun: { out: unknown; toolStart: number; isReadTool: boolean; threw: boolean; bytes?: number; truncated?: boolean; served?: unknown } | null;
  /** The finish reason of the turn that produced the call being dispatched. A malformed
   *  call is either the tail of a response that hit the output ceiling or JSON the model
   *  simply got wrong, and the advice for the two is opposite. */
  lastTurnInterruption: ReturnType<typeof turnInterruption>;
}

/** Report an event to the run policy; the new state is the run's. */
export function reportToPolicy(run: RunLoopContext, event: RunPolicyEvent): RunPolicyState {
  return (run.policy = reduceRunPolicy(run.policy, event));
}

/**
 * Record a failed call and return the advisory the MODEL should read with it, or null
 * while a retry is still reasonable. The intervention is its own trace step — exactly
 * as the revisit guard's is — so triage can see the loop was fought rather than
 * inferring it from the repetition.
 */
export function failureAdvisoryFor(run: RunLoopContext, name: string, args: unknown, out: unknown, step: number): string | null {
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
export async function settleReply(run: RunLoopContext, rawText: string, result: StreamChatResult, requested?: string): Promise<BrainMessage> {
  const { c, chatId, convo } = run;
  const text = canonicalTurnText(rawText);
  convo.push({ role: 'assistant', content: replayTextOf(text) });
  const meta = provenanceMetadata(result, requested);
  const [assistantMsg] = await run.req.persistence.sendMessages(chatId, [{ role: 'assistant', content: text, ...(meta ? { metadata: meta } : {}) }]);
  c.streamingText = '';
  recordAppended(c, assistantMsg);
  return assistantMsg;
}
