/**
 * The agent's MODEL port over a Brain run: each turn's live view and record (PRD 35 §4 WS4, "the streamed turn").
 *
 * The streamed deltas, the activity indicator, the time to the first token, the `llm.complete` step, the usage, the BYO
 * banners and the failure ledger are the Brain's own, and they are the SAME code the Brain's loop runs: `openLiveTurn`
 * (`runStore/turnStream.ts`) and `recordTurn` (`runStore/turnRecorder.ts`). This only joins them to the transport's per-turn
 * session. It decides nothing - which model, when to retry and what to offer are the agent's.
 */

import type { ModelRequest } from '@builderforce/agent-run';
import type { BrainToolSpec, StreamChatResult } from '../streamChatCompletion';
import { StreamInterruptedError } from '../streamChatCompletion';
import { turnMaxTokens } from '../effort';
import { coderReaskTrace, providerFailureTrace } from '../runPolicyTraces';
import { emit, nowIso, nowMs, pushTrace } from '../runStore/runCells';
import type { BrainTraceEvent } from '../brainTriage';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { asLiveTurn } from '../runStore/turnPersistence';
import { recordTurn } from '../runStore/turnRecorder';
import { commitTurnNarration, terminalAskReply, type TurnCall } from '../runStore/turnToolCalls';
import { openLiveTurn } from '../runStore/turnStream';
import { providerFailureEvent } from '../providerFailure';
import type { TurnObserver, TurnSession } from './modelTransport';

/** What the tail of the run reads about its last turn: the result (for the reply's provenance) and the model asked for. */
export interface LastTurn {
  result?: StreamChatResult;
  requested?: string;
  /** The reply a turn that ended the run on a question settles with, taken once by the extension's `terminalTurn`. */
  terminal?: string;
  /** Where the last recorded turn's trace rows begin (the coder re-ask discards them). */
  traceFrom?: number;
  /** The number of the turn in flight (the steering port stamps `steer.applied` with it). */
  step: number;
  /**
   * The error step of a failed completion the model policy may still route around: recorded only if the turn is abandoned
   * (`brainDelivery.ts`), as the Brain's loop records a failure only when the retry fails too.
   */
  failure?: BrainTraceEvent;
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

/** The observer over one Brain run, and a view of its last turn. */
export function loopTurnObserver(run: RunLoopContext): { observer: TurnObserver; last: LastTurn } {
  const { c, req } = run;
  const last: LastTurn = { step: 0 };
  let iter = 0;
  const observer: TurnObserver = {
    open(request: ModelRequest): TurnSession {
      iter += 1;
      const step = iter;
      last.step = step;
      c.streamingText = '';
      emit(c);
      const live = openLiveTurn(c, step);
      const llmStart = nowMs();
      const tools = (request.tools ?? []) as unknown as BrainToolSpec[];
      return {
        handlers: live.handlers,
        metadata: run.metadata,
        call: { prompt_cache_key: `brain:${run.serverChatId ?? req.clientChatId ?? 'local'}`, conversationKey: run.chatId },
        fit: (messages) => run.windowFit.prepare({ messages, ...(request.model ? { model: request.model } : {}), tools, maxTokens: turnMaxTokens(req.maxTokens, tools.length > 0), step }),
        around: (stream) => asLiveTurn(c, stream),
        async completed(result) {
          const resolved = result.resolvedModel ?? request.model ?? 'default';
          const requested = request.model ?? 'default';
          run.windowFit.served(result.resolvedModel ?? request.model);
          if (result.toolCalls.length > 0) run.announcementRecoveries = 0;
          last.traceFrom = c.trace.length;
          await recordTurn(run, {
            result, iter: step, llmStart, live, role: request.role ?? (tools.length > 0 ? 'code' : 'chat'),
            resolved, requested, advertised: tools, advertisedNames: new Set(tools.map((t) => t.function.name)),
          });
          last.result = result;
          last.requested = requested;
          if (result.toolCalls.length > 0) {
            // What the turn SAID it would do, judged against what its calls do (`progressGuard.ts`).
            run.progress.noteTurnText(result.text);
            const calls = result.toolCalls.map((tc) => parsedCall(tc.name, tc.args));
            // A question ends the run as its reply; any other turn's narration is kept as its own block (`turnToolCalls.ts`).
            last.terminal = terminalAskReply(run, result, calls, step);
            if (last.terminal === undefined) await commitTurnNarration(run, result, requested);
          }
        },
        failed(error) {
          // A user Stop rejects the stream: that is not a failed turn, and it leaves no error step.
          if (!c.abort?.signal.aborted) {
            const broke = (error instanceof StreamInterruptedError && error.model) || request.model;
            const entry = providerFailureTrace(nowIso(), step, broke, error, nowMs() - llmStart);
            if (providerFailureEvent(error)) last.failure = entry;
            else pushTrace(c, entry);
          }
          return error;
        },
      };
    },
  };
  return { observer, last };
}

/**
 * The coder re-ask replaced the analysis model's answer: the Brain's loop never recorded it, so neither does the run's trace.
 * Removes the `llm.complete` (and narration) rows the discarded turn left, then says the re-ask the way the loop does.
 */
export function retractLastTurn(run: RunLoopContext, last: LastTurn, step: number, model: string | undefined): void {
  const { c } = run;
  if (last.traceFrom !== undefined) c.trace.splice(last.traceFrom);
  last.traceFrom = undefined;
  pushTrace(c, coderReaskTrace(nowIso(), step, model));
}
