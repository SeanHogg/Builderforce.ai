/**
 * Record a denied platform call so the attempt stays replayable.
 *
 * `decide` is the only allow check. A result that does not proceed is pushed
 * onto the sink as `{ capability, replayable: true }`. A proceed result pushes
 * nothing. This module does not fetch, open a socket, or mutate the policy.
 */

import { decide } from './enforcePlatform.js';

export interface DeniedCallRecord {
  readonly capability: unknown;
  readonly replayable: true;
}

/** Anything with `push`. A plain array is the usual sink. */
export interface DeniedCallSink {
  push(record: DeniedCallRecord): unknown;
}

export type RecordIfDeniedResult =
  | { readonly recorded: true }
  | { readonly recorded: false };

/**
 * Call `decide`. Record the capability when the call must not proceed.
 * Does not write to `policy` and does not call the network.
 */
export function recordIfDenied(
  policy: unknown,
  capability: unknown,
  sink: DeniedCallSink,
): RecordIfDeniedResult {
  const decision = decide(policy, capability);
  if (decision.proceed === true) return { recorded: false };
  sink.push({ capability, replayable: true });
  return { recorded: true };
}
