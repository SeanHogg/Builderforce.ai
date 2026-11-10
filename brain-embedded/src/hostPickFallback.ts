/**
 * Hybrid's pick fallback — when a failed pick may hand the turn to Auto, and the one
 * pick-first runner that does it. Split out of `hostModelStream.ts` (the routing step);
 * the host is told through {@link ModelFallbackEvent} so a fallback is never silent.
 */

import { BrainRequestError } from './chatError';
import { StreamInterruptedError, TransportError } from './streamErrors';
import type { StreamChatResult, StreamHandlers } from './streamChatCompletion';

/** What `HostModelStreamInput.onFallback` is told: the pick that failed, and why. */
export interface ModelFallbackEvent {
  /** The picked model ref (`local/…` or a gateway id). */
  from: string;
  /** The failure's message — for a log line; the notice names only the model. */
  reason: string;
  /**
   * Set when this is NOT a failure: `PIN_REMAPPED` — a built-in-model pin named another
   * vendor's model and runs on this browser's (`to`). Absent = a failed pick (above).
   */
  code?: 'PIN_REMAPPED';
  /** The model that answers instead, for `PIN_REMAPPED`. */
  to?: string;
}

/**
 * Whether a failed pick may fall back to Auto: TRANSPORT-CLASS failures only — nothing the
 * person could fix by acting on the error.
 *
 *  - a local pick's engine failing (any error from this device's runtime);
 *  - the gateway unreachable (`TransportError` — the connection never opened);
 *  - a timeout before any output (`StreamInterruptedError`, which `pickThenAuto` only
 *    sees uncommitted);
 *  - a 5xx from the gateway.
 *
 * Everything else is TERMINAL — a 401 (sign in again), 402 / plan limit (upgrade), 403, a
 * BYO-key error, any other 4xx — so the shared remedy banner offers the fix instead of a
 * different model quietly answering.
 */
export function isFallbackFailure(err: unknown, local: boolean): boolean {
  // This device's engine failing is never something a remedy fixes — the shim may answer
  // it as a 4xx (a model not downloaded, an oversized prompt), so `local` decides first.
  if (local) return true;
  if (err instanceof BrainRequestError) return err.status >= 500;
  return err instanceof TransportError || err instanceof StreamInterruptedError;
}

/**
 * Hybrid's pick-first rule: run the pick; if it fails before the person saw anything (no
 * text, no tool call), the turn was not stopped and the failure is transport-class
 * ({@link isFallbackFailure}), fall back to Auto and tell the host. Once it streamed, the
 * pick owns the turn — a fallback would answer twice.
 */
export async function pickThenAuto(
  pinned: (handlers: StreamHandlers) => Promise<StreamChatResult>,
  fallback: () => Promise<StreamChatResult>,
  handlers: StreamHandlers,
  signal: AbortSignal | undefined,
  pick: { from: string; local: boolean; onFallback?: (event: ModelFallbackEvent) => void },
): Promise<StreamChatResult> {
  let committed = false;
  const watched: StreamHandlers = {
    ...handlers,
    onTextDelta: (delta) => {
      committed = true;
      handlers.onTextDelta?.(delta);
    },
    onToolCallDelta: (index, partial) => {
      committed = true;
      handlers.onToolCallDelta?.(index, partial);
    },
  };
  try {
    return await pinned(watched);
  } catch (err) {
    if (committed || signal?.aborted || !isFallbackFailure(err, pick.local)) throw err;
    pick.onFallback?.({ from: pick.from, reason: err instanceof Error ? err.message : String(err) });
    return fallback();
  }
}
