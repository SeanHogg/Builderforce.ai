/**
 * The agent's MODEL port over a Brain run: each turn's live view and record (PRD 35 §4 WS4, "the streamed turn").
 *
 * The streamed deltas, the activity indicator, the time to the first token, the `llm.complete` step, the usage, the BYO
 * banners and the failure ledger are the Brain's own, and they are the SAME code the Brain's loop runs: `openLiveTurn`
 * (`runStore/turnStream.ts`) and `recordTurn` (`runStore/turnRecorder.ts`). This only joins them to the transport's per-turn
 * session. It decides nothing - which model, when to retry and what to offer are the agent's.
 *
 * A TURN is one kernel step, however many attempts it takes: a retry the model policy routes around, or the coder re-ask of an
 * analysis turn, is another request of the SAME turn - one number, one live view, one start time, one memory effect. And a turn
 * is RECORDED only once it is kept: the answer waits in {@link LastTurn.pending} until the agent reports anything about it but
 * its re-ask (`keepAnswered`, called by the event sink), so a discarded answer leaves no narration, no `llm.complete`, no usage,
 * no coder model, no note of its text and no terminal question behind.
 */

import type { ModelRequest } from '@builderforce/agent-run';
import { nextTurn } from '@builderforce/run-policy';
import type { BrainToolSpec, CompletionMetadata, StreamChatResult } from '../streamChatCompletion';
import { StreamInterruptedError } from '../streamChatCompletion';
import { turnMaxTokens } from '../effort';
import { callMemoryEffect } from '../memorySavings';
import { coderReaskTrace, providerFailureTrace, transportRetryTrace } from '../runPolicyTraces';
import { emit, nowIso, nowMs, pushTrace } from '../runStore/runCells';
import { stampOncePerCall } from '../runStore/compactionSaved';
import { reportToPolicy, type RunLoopContext } from '../runStore/runLoopContext';
import { asLiveTurn } from '../runStore/turnPersistence';
import { recordTurn } from '../runStore/turnRecorder';
import { commitTurnNarration, terminalAskReply, type TurnCall } from '../runStore/turnToolCalls';
import { openLiveTurn, type LiveTurn } from '../runStore/turnStream';
import { providerFailureEvent } from '../providerFailure';
import type { TurnObserver, TurnRetry, TurnSession } from './modelTransport';

/** A turn the model answered that the agent has not yet gone on with: what recording it needs. */
interface Answered {
  result: StreamChatResult;
  step: number;
  llmStart: number;
  live: LiveTurn;
  /** The role the turn's last request asked as (analysis, code, chat). */
  role: string;
  tools: BrainToolSpec[];
}

/** What the tail of the run reads about its last turn: the result (for the reply's provenance) and the model asked for. */
export interface LastTurn {
  result?: StreamChatResult;
  requested?: string;
  /** The reply a turn that ended the run on a question settles with, taken once by the extension's `terminalTurn`. */
  terminal?: string;
  /** The number of the turn in flight, or of the last one (the kernel's step; -1 before the first). */
  step: number;
  /** The turn the model answered and the agent has not gone on with yet. A coder re-ask replaces it, so it is never recorded. */
  pending?: Answered;
  /**
   * The error that failed the run's last completion, exactly as the stream threw it (its `status`, `unlock`, `requiredPlan` ...
   * intact). The settled outcome re-throws it, so `chatErrorAction` reads the original and never a message made from it.
   */
  error?: unknown;
  /** The reply the run's USD cap stopped it with, when it did: it is not an answer (`loopSettle.ts`). */
  contained?: string;
}

/** A call's arguments as the agent parses them: a string that is not a JSON object is a malformed call. */
function parsedCall(name: string, raw: string): TurnCall {
  try {
    const args = JSON.parse(raw || '{}') as unknown;
    return typeof args === 'object' && args !== null && !Array.isArray(args) ? { name, args: args as Record<string, unknown>, malformed: false } : { name, args: {}, malformed: true };
  } catch {
    return { name, args: {}, malformed: true };
  }
}

/** One kernel step across its attempts. */
interface OpenTurn {
  step: number;
  live: LiveTurn;
  llmStart: number;
  role: string;
  /** The turn's memory effect rides the FIRST request only: a retry or the re-ask is the same call's prompt again. */
  metadata: () => CompletionMetadata;
  /** The agent went on with the turn (it is recorded); the next request is a new turn. */
  kept: boolean;
}

/** The observer over one Brain run, a view of its last turn, and the call that keeps an answered turn. */
export function loopTurnObserver(run: RunLoopContext, savedTokens: () => number = () => 0): { observer: TurnObserver; last: LastTurn; keepAnswered: () => Promise<void> | undefined } {
  const { c, req } = run;
  const last: LastTurn = { step: -1 };
  let turn: OpenTurn | undefined;
  let turns = 0;

  const observer: TurnObserver = {
    open(request: ModelRequest): TurnSession {
      const tools = (request.tools ?? []) as unknown as BrainToolSpec[];
      // A request while the last answer is still unkept is that turn asked again (the coder re-ask): same number, same view.
      if (turn && !turn.kept) {
        turn.live.restart();
      } else {
        const step = turns;
        turns += 1;
        last.step = step;
        c.streamingText = '';
        emit(c);
        const effect = callMemoryEffect(savedTokens(), run.recallBlockTokens);
        turn = {
          step,
          live: openLiveTurn(c, step),
          llmStart: nowMs(),
          role: '',
          // What memory did to THIS call's prompt (compaction kept the folded part out of it, recall added its block) rides the metadata the
          // call already sends, so the gateway stamps it on this call's own usage row.
          metadata: stampOncePerCall<CompletionMetadata>(effect ? { ...run.metadata, memory: effect } : run.metadata, run.metadata),
          kept: false,
        };
      }
      const t = turn;
      t.role = request.role ?? (tools.length > 0 ? 'code' : 'chat');
      // Raised to the tool-turn floor when tools are on offer: a file write is output, and the Effort ceiling cut every one of them off mid-JSON.
      const maxTokens = turnMaxTokens(req.maxTokens, tools.length > 0);
      return {
        handlers: t.live.handlers,
        metadata: t.metadata,
        maxTokens,
        call: { prompt_cache_key: `brain:${run.serverChatId ?? req.clientChatId ?? 'local'}`, conversationKey: run.chatId },
        fit: (messages, model) => run.windowFit.prepare({ messages, ...(model ? { model } : {}), ...(tools.length > 0 ? { tools } : {}), maxTokens, step: t.step }),
        around: (stream) => asLiveTurn(c, stream),
        recover(error): TurnRetry | undefined {
          // The model broke AFTER the gateway committed to it, or the gateway was reached and the request reset, timed out or was answered
          // with a status the run policy routes around: the policy decides whether the turn is retried ONCE on another connected model
          // (and leaves the one that broke out of every later turn). Any other failure is not a transport failure at all.
          const failure = providerFailureEvent(error);
          const outcome = failure ? reportToPolicy(run, failure).outcome : null;
          if (!outcome || outcome.kind !== 'retry_turn') return undefined;
          pushTrace(c, transportRetryTrace(nowIso(), t.step, outcome, (error as Error).message));
          t.live.restart();
          // Re-read AFTER the event that caused the retry: the policy now asks for what it says.
          const ask = nextTurn(run.policy, { hasTools: tools.length > 0 });
          t.role = ask.role;
          return { ...(ask.model ? { model: ask.model } : {}), strict: ask.strict, role: ask.role, excludeModels: ask.excludeModels };
        },
        completed(result) {
          last.error = undefined;
          last.pending = { result, step: t.step, llmStart: t.llmStart, live: t.live, role: t.role, tools };
        },
        failed(error) {
          // A user Stop rejects the stream: that is not a failed turn, and it leaves no error step.
          if (!c.abort?.signal.aborted) {
            const broke = (error instanceof StreamInterruptedError && error.model) || run.policy.model;
            pushTrace(c, providerFailureTrace(nowIso(), t.step, broke, error, nowMs() - t.llmStart));
            last.error = error;
          }
          return error;
        },
      };
    },
  };

  /** The agent went on with the answered turn: record it, once, the way the Brain's loop does. */
  const keepAnswered = (): Promise<void> | undefined => {
    const answered = last.pending;
    if (!answered) return undefined;
    last.pending = undefined;
    if (turn) turn.kept = true;
    return keep(run, last, answered);
  };
  return { observer, last, keepAnswered };
}

/** Record a kept turn: what it left on the run, then what a turn that calls tools settles before any call dispatches. */
async function keep(run: RunLoopContext, last: LastTurn, a: Answered): Promise<void> {
  const { result } = a;
  run.windowFit.served(result.resolvedModel ?? run.policy.model);
  // The stall-recovery budget covers a STREAK of narration-only turns; a turn that called a tool proves the model is acting.
  if (result.toolCalls.length > 0) run.announcementRecoveries = 0;
  const resolved = result.resolvedModel ?? run.policy.model ?? 'default';
  const requested = run.policy.model ?? 'default';
  await recordTurn(run, {
    result, iter: a.step, llmStart: a.llmStart, live: a.live, role: a.role,
    resolved, requested, advertised: a.tools, advertisedNames: new Set(a.tools.map((t) => t.function.name)),
  });
  last.result = result;
  last.requested = requested;
  // A host that advertised tools but cannot run them gets the turn as a final answer (`brainModelRules.ts`): nothing dispatches.
  if (result.toolCalls.length === 0 || !run.req.runTool) return;
  // What the turn SAID it would do, judged against what its calls do (`progressGuard.ts`).
  run.progress.noteTurnText(result.text);
  const calls = result.toolCalls.map((tc) => parsedCall(tc.name, tc.args));
  // A question ends the run as its reply; any other turn's narration is kept as its own block (`turnToolCalls.ts`).
  last.terminal = terminalAskReply(run, result, calls, a.step);
  if (last.terminal === undefined) await commitTurnNarration(run, result, requested);
}

/**
 * The coder re-ask replaced the analysis model's answer: the Brain's loop never recorded it, so neither does the run - the
 * answer is dropped unrecorded, and the re-ask is said the way the loop says it.
 */
export function discardAnswered(run: RunLoopContext, last: LastTurn, step: number, model: string | undefined): void {
  last.pending = undefined;
  pushTrace(run.c, coderReaskTrace(nowIso(), step, model));
}
