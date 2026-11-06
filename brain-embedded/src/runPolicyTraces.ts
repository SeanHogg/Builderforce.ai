/**
 * The timeline steps the Brain run records when `@builderforce/run-policy` moves
 * the run — a role hand-off, a turn retried around a broken model.
 *
 * The policy decides; this module only SAYS what it decided, in the labels and wording
 * the triage and diagnostics readers already key on (`llm.role_handoff`,
 * `llm.stream_interrupted`, `llm.transport_error`, and the
 * `llm.complete` error a failed completion records). The turn observer (`run/brainTurn.ts`)
 * and the call preflight (`runStore/callPreflight.ts`) call it, so they report the event
 * rather than carry the prose of every outcome inline. Pure: the caller stamps `ts`.
 */

import type { RunPolicyOutcome } from '@builderforce/run-policy';
import type { BrainTraceEvent } from './brainTriage';
import { StreamInterruptedError } from './streamChatCompletion';

/** The implicit hand-off: the planning turn reached for its first code change. */
export function coderReaskTrace(ts: string, step: number, plannerModel: string | undefined): BrainTraceEvent {
  return {
    ts,
    category: 'message',
    label: 'llm.role_handoff',
    args: { from: plannerModel ?? 'default', step },
    result: `Analysis on ${plannerModel ?? 'the planning model'} reached its first code change — handing the edit to the strongest connected coding model.`,
  };
}

/** The explicit hand-off: the planner called `hand_off` with its task list. */
export function handOffTrace(ts: string, step: number, tasks: number, via: string): BrainTraceEvent {
  return {
    ts,
    category: 'message',
    label: 'llm.role_handoff',
    args: { step, tasks, via },
    result: `Planning handed off ${tasks} task${tasks === 1 ? '' : 's'} to the coding model.`,
  };
}

/** A turn re-asked after a transport failure the policy routes around. */
export function transportRetryTrace(
  ts: string,
  step: number,
  outcome: Extract<RunPolicyOutcome, { kind: 'retry_turn' }>,
  message: string,
): BrainTraceEvent {
  if (outcome.broken) {
    return {
      ts,
      category: 'message',
      label: 'llm.stream_interrupted',
      args: { model: outcome.broken, step },
      result: `${message} — retrying this turn on another connected model. ${outcome.broken} is left out for the rest of this run.`,
    };
  }
  return {
    ts,
    category: 'message',
    label: 'llm.transport_error',
    args: { step },
    result: `${message} — retrying this turn on another connected model.`,
  };
}

/**
 * A completion that FAILED — the `llm.complete` error step every browser loop records
 * before it routes around the failure or surfaces it. `model` is the model that broke
 * (what the stream named, else the one asked for); under auto-routing that is `default`.
 * The result keeps the error's class, so triage can tell an interruption from a reset.
 */
export function providerFailureTrace(ts: string, step: number, model: string | undefined, error: unknown, durationMs?: number): BrainTraceEvent {
  const failure = error instanceof StreamInterruptedError ? error.detail : undefined;
  return {
    ts,
    category: 'error',
    label: 'llm.complete',
    ...(durationMs !== undefined ? { durationMs } : {}),
    args: { model: model || 'default', step, ...(failure ? { failure } : {}) },
    result: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    isError: true,
  };
}
