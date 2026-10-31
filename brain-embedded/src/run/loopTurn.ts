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
import { providerFailureTrace } from '../runPolicyTraces';
import { emit, nowIso, nowMs, pushTrace } from '../runStore/runCells';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { asLiveTurn } from '../runStore/turnPersistence';
import { recordTurn } from '../runStore/turnRecorder';
import { openLiveTurn } from '../runStore/turnStream';
import type { TurnObserver, TurnSession } from './modelTransport';

/** What the tail of the run reads about its last turn: the result (for the reply's provenance) and the model asked for. */
export interface LastTurn {
  result?: StreamChatResult;
  requested?: string;
  /** The number of the turn in flight (the steering port stamps `steer.applied` with it). */
  step: number;
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
          await recordTurn(run, {
            result, iter: step, llmStart, live, role: request.role ?? (tools.length > 0 ? 'code' : 'chat'),
            resolved, requested, advertised: tools, advertisedNames: new Set(tools.map((t) => t.function.name)),
          });
          last.result = result;
          last.requested = requested;
        },
        failed(error) {
          // A user Stop rejects the stream: that is not a failed turn, and it leaves no error step.
          if (!c.abort?.signal.aborted) {
            const broke = (error instanceof StreamInterruptedError && error.model) || request.model;
            pushTrace(c, providerFailureTrace(nowIso(), step, broke, error, nowMs() - llmStart));
          }
          return error;
        },
      };
    },
  };
  return { observer, last };
}
