/**
 * THE classification of a failed completion for the run policy.
 *
 * Every browser agent loop (the Brain run store, the Creation Canvas) catches the same
 * errors from `streamChatCompletion` and must tell `@builderforce/run-policy` the same
 * thing about them. That translation used to be written once per host, and the hosts
 * drifted: the run store routed an in-band "Upstream error … overloaded" frame around
 * the broken model while the canvas rethrew it and showed the vendor's sentence as its
 * answer (2026-10-17, ui 2026.10.52). One function, so a new failure shape reaches
 * every loop at once.
 *
 * Pure: the host reports the event and acts on the outcome (its own traces, re-asks and
 * transcript handling stay with it).
 */

import type { RunPolicyEvent } from '@builderforce/run-policy';
import { StreamInterruptedError, TransportError } from './streamChatCompletion';

/** The policy event a provider failure is reported as. */
export type ProviderFailureEvent = Extract<RunPolicyEvent, { type: 'transport_failed' }>;

/**
 * The run-policy event for `error`, or null when it is not a provider/transport failure
 * (a refusal, a bug, a user Stop) and must surface as it is.
 *
 *  - The model broke AFTER the gateway committed to it — an in-band error frame, a
 *    dropped or silent stream, a repetition loop, a gateway that never answered —
 *    `interrupted`, naming the model to route around when the stream knew it.
 *  - The gateway was reached and the request reset or timed out — `transport`.
 *  - The gateway was never reached through every backoff retry — `unreachable`.
 */
export function providerFailureEvent(error: unknown): ProviderFailureEvent | null {
  if (error instanceof StreamInterruptedError) {
    return { type: 'transport_failed', kind: 'interrupted', ...(error.model ? { model: error.model } : {}) };
  }
  if (error instanceof TransportError) {
    return { type: 'transport_failed', kind: error.unreachable ? 'unreachable' : 'transport' };
  }
  return null;
}
