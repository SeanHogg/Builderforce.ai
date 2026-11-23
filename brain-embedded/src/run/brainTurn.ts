/**
 * The agent's MODEL port over a Brain run: each turn's live view and record (PRD 35 §4 WS4, "the streamed turn").
 *
 * The streamed deltas, the activity indicator, the time to the first token, the `llm.complete` step, the usage, the BYO
 * banners and the failure ledger are the Brain's own, and they are the Brain's one implementation: `openLiveTurn`
 * (`runStore/turnStream.ts`) and `recordTurn` (`runStore/turnRecorder.ts`). This only joins them to the transport's per-turn
 * session. It decides nothing - which model, when to retry and what to offer are the agent's.
 *
 * A TURN is one kernel step, however many attempts it takes: a retry the model policy routes around, or the coder re-ask of an
 * analysis turn, is another request of the SAME turn - one number, one live view, one start time, one memory effect. And a turn
 * is RECORDED only once it is kept: the answer waits in {@link LastTurn.pending} until the agent reports anything about it but
 * its re-ask (`keepAnswered`, called by the event sink), so a discarded answer leaves no narration, no `llm.complete`, no usage,
 * no coder model, no note of its text and no terminal question behind.
 */

import type { BrainMessage } from '../types';
import type { ModelRequest } from '@builderforce/agent-run';
import { parseToolArgs } from '@builderforce/agent-loop';
import type { BrainToolSpec, CompletionMetadata, StreamChatResult } from '../streamChatCompletion';
import { StreamInterruptedError } from '../streamChatCompletion';
import { turnMaxTokens } from '../effort';
import { callMemoryEffect } from '../memorySavings';
import { coderReaskTrace, providerFailureTrace } from '../runPolicyTraces';
import { emit, nowIso, nowMs, pushTrace } from '../runStore/runCells';
import { stampOncePerCall } from '../runStore/compactionSaved';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { asLiveTurn } from '../runStore/turnPersistence';
import { recordTurn } from '../runStore/turnRecorder';
import { commitTurnNarration, terminalAskReply, type TurnCall } from '../runStore/turnToolCalls';
import { openLiveTurn, type LiveTurn } from '../runStore/turnStream';
import { providerFailureEvent } from '../providerFailure';
import { runBrief } from './brainTurnTail';
import { BrainTransportFailure } from './transportFailure';
import type { TurnObserver, TurnSession } from './modelTransport';

/** A turn the model answered that the agent has not yet gone on with: what recording it needs. */
interface Answered {
  result: StreamChatResult;
  step: number;
  llmStart: number;
  live: LiveTurn;
  /** The role the turn's last request asked as (analysis, code, chat). */
  role: string;
  tools: BrainToolSpec[];
  forcedFinish?: true;
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
  /** Record a classified failure if the shared model policy cannot recover the turn. */
  abandonedFailure?: () => void;
  /**
   * Recording a kept turn failed (its narration could not be saved). The agent's event stream swallows a sink's failure, so the
   * run is failed from the next place the agent asks the surface something (`terminalTurn`), so the run fails there.
   */
  keepFailed?: unknown;
  /** The reply the run's USD cap stopped it with, when it did: it is not an answer (`brainSettle.ts`). */
  contained?: string;
  /** The reply a stall with nothing left to try already saved, before it said why (`brainDelivery.ts`): the run settles on it. */
  settled?: BrainMessage;
  /**
   * A delivery rung sent the run's would-be final answer back (`brainDelivery.ts`, its `onRestate`; the text is already saved as a
   * block). Cleared when a later turn is kept. Should the re-prompt fail on the provider, the run keeps that answer (`brainSettle.ts`).
   */
  sentBackAnswer?: { step: number };
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
  /** The `tool_choice` the turn's first request asked for (a stall recovery's forced call): every request of the turn keeps it. */
  toolChoice?: 'auto' | 'required';
}

/** The observer over one Brain run, a view of its last turn, and the call that keeps an answered turn. */
export function brainTurnObserver(run: BrainRunContext, savedTokens: () => number = () => 0): { observer: TurnObserver; last: LastTurn; keepAnswered: () => Promise<void> | undefined } {
  const { c, req } = run;
  const last: LastTurn = { step: -1 };
  let turn: OpenTurn | undefined;
  let turns = 0;

  const observer: TurnObserver = {
    open(request: ModelRequest): TurnSession {
      const tools = (request.tools ?? []) as unknown as BrainToolSpec[];
      // A request while the last answer is still unkept is that turn asked again (the coder re-ask): same number, same view.
      const reask = turn !== undefined && !turn.kept;
      if (turn && reask) {
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
          ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
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
        // The coder re-ask is asked of the SAME turn's menu with the run's record and the planner's brief, not the turn's forced brief or
        // steer, and keeps the turn's `tool_choice`: it is one more request, never a turn of its own.
        ...(reask ? { tail: [runBrief(run, tools.length)], ...(t.toolChoice ? { toolChoice: t.toolChoice } : {}) } : {}),
        call: { prompt_cache_key: `brain:${run.serverChatId ?? req.clientChatId ?? 'local'}`, conversationKey: run.chatId },
        fit: (messages, model) => run.windowFit.prepare({ messages, ...(model ? { model } : {}), ...(tools.length > 0 ? { tools } : {}), maxTokens, step: t.step }),
        around: (stream) => asLiveTurn(c, stream),
        completed(result) {
          last.error = undefined;
          last.abandonedFailure = undefined;
          last.pending = { result, step: t.step, llmStart: t.llmStart, live: t.live, role: t.role, tools, ...(request.forcedFinish ? { forcedFinish: true } : {}) };
        },
        failed(error) {
          // A user Stop rejects the stream: that is not a failed turn, and it leaves no error step.
          if (!c.abort?.signal.aborted) {
            const broke = (error instanceof StreamInterruptedError && error.model) || run.policy.model;
            last.error = error;
            const trace = providerFailureTrace(nowIso(), t.step, broke, error, nowMs() - t.llmStart);
            const failure = reask ? null : providerFailureEvent(error);
            if (failure) {
              last.abandonedFailure = () => pushTrace(c, trace);
              return new BrainTransportFailure(error, failure);
            }
            pushTrace(c, trace);
          }
          return error;
        },
      };
    },
  };

  /** The agent went on with the answered turn: record it, once. */
  const keepAnswered = (): Promise<void> | undefined => {
    const answered = last.pending;
    if (!answered) return undefined;
    last.pending = undefined;
    if (turn) turn.kept = true;
    return keep(run, last, answered).catch((error: unknown) => { last.keepFailed = error; });
  };
  return { observer, last, keepAnswered };
}

/** Record a kept turn: what it left on the run, then what a turn that calls tools settles before any call dispatches. */
async function keep(run: BrainRunContext, last: LastTurn, a: Answered): Promise<void> {
  // A later turn was kept: an answer a rung sent back before it is no longer the run's last word.
  last.sentBackAnswer = undefined;
  const { result } = a;
  run.windowFit.served(result.resolvedModel ?? run.policy.model);
  const resolved = result.resolvedModel ?? run.policy.model ?? 'default';
  const requested = run.policy.model ?? 'default';
  await recordTurn(run, {
    result, iter: a.step, llmStart: a.llmStart, live: a.live, role: a.role,
    resolved, requested, advertised: a.tools, advertisedNames: new Set(a.tools.map((t) => t.function.name)),
    ...(a.forcedFinish ? { forcedFinish: true } : {}),
  });
  last.result = result;
  last.requested = requested;
  // A host that advertised tools but cannot run them gets the turn as a final answer (`brainModelRules.ts`): nothing dispatches.
  if (result.toolCalls.length === 0 || !run.req.runTool) return;
  const calls: TurnCall[] = result.toolCalls.map((tc) => ({ name: tc.name, ...parseToolArgs(tc.args) }));
  // A question ends the run as its reply; any other turn's narration is kept as its own block (`turnToolCalls.ts`).
  last.terminal = terminalAskReply(run, result, calls, a.step);
  if (last.terminal === undefined) await commitTurnNarration(run, result, requested);
}

/**
 * The coder re-ask replaced the analysis model's answer: the Brain never records it, so neither does the run - the
 * answer is dropped unrecorded, and the re-ask is said on the trace.
 */
export function discardAnswered(run: BrainRunContext, last: LastTurn, step: number, model: string | undefined): void {
  last.pending = undefined;
  pushTrace(run.c, coderReaskTrace(nowIso(), step, model));
}
