/**
 * Measured, not assumed (PRD 42 · Part F): the ONE wrapper that turns a port call into an
 * {@link OnDeviceTaskEvent}. Both port factories (`pageOnDeviceTasks`, `completionOnDeviceTasks`)
 * run every method through it, so a served / declined call is reported the same way everywhere
 * and the engine that served THIS call reaches the caller through `onServed` — per call, never
 * through shared "last call" state.
 */

import { approxTokens } from '../builtInAi/taskSession';
import type { OnDeviceObserver, OnDeviceTaskKind, ServedBy } from './onDeviceTasks';

export interface ObservedTaskContext {
  kind: OnDeviceTaskKind;
  /** The host's sink; absent ⇒ nothing is reported (the caller's own `onServed` still fires). */
  observe: OnDeviceObserver | undefined;
  /** The caller's per-call provenance hook (`ServedOption.onServed`). */
  onServed: ((by: ServedBy) => void) | undefined;
  /** The call's input text, for the token estimate. */
  input: string;
}

/** An estimate of the output's tokens: a string as is, anything else as its JSON. */
function outputTokens(result: unknown): number {
  return approxTokens(typeof result === 'string' ? result : JSON.stringify(result) ?? '');
}

/**
 * Run `run`, handing it a `served` callback to call with whoever answered. A non-null result
 * reports `served` (when someone said they served it); `null` reports `declined`. An abort is
 * rethrown unreported. Observer failures never reach the call.
 */
export async function observedTask<R>(
  ctx: ObservedTaskContext,
  run: (served: (by: ServedBy) => void) => Promise<R | null>,
): Promise<R | null> {
  const started = Date.now();
  let by: ServedBy | undefined;
  const served = (next: ServedBy): void => {
    by = next;
    ctx.onServed?.(next);
  };
  const result = await run(served);
  if (ctx.observe) {
    const ms = Date.now() - started;
    try {
      if (result === null) {
        ctx.observe({ kind: ctx.kind, engine: null, model: null, outcome: 'declined', ms });
      } else if (by) {
        ctx.observe({
          kind: ctx.kind, engine: by.engine, model: by.model, outcome: 'served', ms,
          promptTokens: approxTokens(ctx.input), completionTokens: outputTokens(result),
        });
      }
    } catch {
      /* an observer never fails a call */
    }
  }
  return result;
}
