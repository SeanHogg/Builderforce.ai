/**
 * The timeline steps the Brain run loop records when `@builderforce/run-policy` moves
 * the run — a role hand-off, a model failover, a turn retried around a broken model.
 *
 * The policy decides; this module only SAYS what it decided, in the labels and wording
 * the triage and diagnostics readers already key on (`llm.role_handoff`,
 * `loop.model_failover`, `llm.stream_interrupted`, `llm.transport_error`, and the
 * `llm.complete` error a failed completion records). Kept out of
 * `brainRunStore.ts` so the loop reads as "report the event, act on the outcome" rather
 * than carrying the prose of every outcome inline. Pure: the caller stamps `ts`.
 */

import { modelFailoverNotice, type StallShapeArg } from '@builderforce/agent-stall';
import type { RunPolicyOutcome } from '@builderforce/run-policy';
import type { BrainTraceEvent } from './brainTriage';

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

/** A spent model swapped for another after burning its whole stall budget. */
export function modelFailoverTrace(
  ts: string,
  step: number,
  from: string,
  outcome: Extract<RunPolicyOutcome, { kind: 'failed_over' }>,
  shape: StallShapeArg,
): BrainTraceEvent {
  return {
    ts,
    category: 'message',
    label: 'loop.model_failover',
    args: { step, from, to: outcome.to, attempt: outcome.attempt, of: outcome.of },
    result: modelFailoverNotice(from, outcome.to, shape),
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
  return {
    ts,
    category: 'error',
    label: 'llm.complete',
    ...(durationMs !== undefined ? { durationMs } : {}),
    args: { model: model || 'default', step },
    result: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    isError: true,
  };
}
