/**
 * One turn's LIVE view while its completion streams: the cell's streaming text, the phase the
 * activity indicator shows (`thinking` until the first token, `writing` after, `composing` for a
 * tool call's arguments), the time to the first token, and the discard of an attempt a retry or
 * the coder re-ask starts over. Extracted from `completeTurn.ts` so the Brain's own loop and the
 * agent's model port (`run/modelTransport.ts`) stream a turn the same way - never a copy.
 */

import { createComposingActivity } from '../composingActivity';
import type { StreamHandlers } from '../streamChatCompletion';
import { emit, emitStreaming, nowMs, setActivity } from './runCells';
import { connectRetryStep, liveTurnModel } from './turnPersistence';
import type { RunCell } from './runCell';

export interface LiveTurn {
  /** The stream's handlers: wire these as the completion's `StreamHandlers`. */
  handlers: StreamHandlers;
  /** When the turn's first token (or first argument fragment) arrived, or undefined while none has. */
  firstTokenAt(): number | undefined;
  /** Argument bytes the turn has emitted so far (a tool-call-only turn streams these, not text). */
  argBytes(): number;
  /** Start the turn over on a clean slate - the discarded attempt's text already streamed. */
  restart(): void;
}

/** Open turn `step`: the activity says the model is thinking, and the stream's deltas land on the cell (the caller has cleared the last turn's text). */
export function openLiveTurn(c: RunCell, step: number): LiveTurn {
  setActivity(c, { phase: 'thinking', startedAt: Date.now(), step });
  let firstTokenAt: number | undefined;
  // A turn that emits a tool call streams its ARGUMENTS, not text - 21 KB of them took 3m 23s on chat #113
  // while the indicator sat on "writing the reply". See `composingActivity.ts`.
  const composing = createComposingActivity(
    { set: (a) => { c.activity = a; }, repaint: () => emit(c), coalescedRepaint: () => emitStreaming(c) },
    { step },
  );
  const handlers: StreamHandlers = {
    onModel: liveTurnModel(c),
    onConnectRetry: connectRetryStep(c, step),
    onTextDelta: (d) => {
      c.streamingText += d;
      if (firstTokenAt === undefined) {
        firstTokenAt = nowMs();
        // First token: the reply is visibly forming, so the indicator stops claiming the model is still thinking.
        // A PHASE change, so it repaints now (one repaint carrying the first token too); every later delta is text
        // only and coalesces into a frame.
        c.activity = { phase: 'writing', startedAt: Date.now(), step };
        emit(c);
        return;
      }
      emitStreaming(c);
    },
    // The first argument fragment is this turn's first token too: a tool-only turn recorded no ttft at all.
    onToolCallDelta: (index, partial) => {
      if (firstTokenAt === undefined) firstTokenAt = nowMs();
      composing.onDelta(index, partial);
    },
  };
  return {
    handlers,
    firstTokenAt: () => firstTokenAt,
    argBytes: () => composing.bytes(),
    restart: () => {
      c.streamingText = '';
      firstTokenAt = undefined;
      composing.reset();
      emit(c);
    },
  };
}
