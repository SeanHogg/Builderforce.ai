/**
 * What a turn that ended WITHOUT calling a tool earns — the whole stall step every
 * agent loop takes, in one place.
 *
 * Detection and wording live in `@builderforce/agent-stall`; the model swap is the run
 * policy's `stalled` event. The ORDER between them is the part each host used to write
 * for itself: spend the re-prompt budget on THIS model first (a model that narrates once
 * usually acts when told to), and only once that is exhausted ask the policy for a
 * different model — then stop and say so when there is none. The server addressed
 * reply, the cloud durable loop, the container `llm` op and the on-prem runtime each
 * carried a copy of that sequence; they now all take this one. Pure.
 */

import {
  isExhaustedStall,
  modelFailoverNotice,
  shouldRecoverStalledTurn,
  stallExhaustedNotice,
  stallRecoveryNudge,
  stallRecoveryToolChoice,
  stallShape,
  MAX_ANNOUNCEMENT_RECOVERIES,
  type ModelFallbackSurface,
  type StallShape,
} from '@builderforce/agent-stall';
import { reduceRunPolicy, type RunPolicyState } from './policy.js';

/** What the loop knows about the turn that just ended. */
export interface StallTurn {
  /** Visible assistant text — what the user was left holding. */
  text: string;
  /** Tool calls the turn made. Non-zero means it acted — never a stall. */
  toolCallCount: number;
  /** The tools the turn was offered. Empty means it had nothing to call. */
  availableToolNames: readonly string[];
  /** The request the run was given — never a nudge the loop wrote itself. */
  requestText?: string;
  /** The model that answered, as the gateway resolved it (the only id under auto-select). */
  resolvedModel?: string;
}

/** Where a replacement model comes from — see the policy's `stalled` event. */
export interface StallFailoverSource {
  surface?: ModelFallbackSurface | null;
  pick?: (tried: readonly string[]) => string | undefined;
}

/** The loop's next move. Every acting step carries `shape`, so the host can record WHAT
 *  the model did without re-deriving it, and `toolChoice` for the next request. */
export type StallStep =
  | { kind: 'none' }
  /** Re-prompt the SAME model with `nudge`. */
  | { kind: 'nudge'; nudge: string; toolChoice?: 'required'; recoveriesUsed: number; shape: StallShape | null }
  /** The policy swapped models: re-prompt on `to` with `nudge`; `notice` explains the swap.
   *  The new model starts with a full re-prompt budget (`recoveriesUsed: 0`). */
  | {
      kind: 'failover';
      nudge: string;
      toolChoice?: 'required';
      notice: string;
      from: string | undefined;
      to: string;
      attempt: number;
      of: number;
      recoveriesUsed: 0;
      shape: StallShape | null;
    }
  /** Nothing left to try — the run stops; `notice` explains why it produced nothing. */
  | { kind: 'exhausted'; notice: string; tried: readonly string[]; shape: StallShape | null };

/**
 * Decide what a turn earns: nothing, another re-prompt, a different model, or an
 * explained stop. `recoveriesUsed` is the host's re-prompt count against the CURRENT
 * model (it resets on a failover — take it from the returned step).
 */
export function resolveStallStep(
  policy: RunPolicyState,
  turn: StallTurn,
  recoveriesUsed: number,
  source: StallFailoverSource = {},
): { policy: RunPolicyState; step: StallStep } {
  const input = {
    text: turn.text,
    toolCallCount: turn.toolCallCount,
    availableToolCount: turn.availableToolNames.length,
    recoveriesUsed,
    availableToolNames: turn.availableToolNames,
    ...(turn.requestText !== undefined ? { requestText: turn.requestText } : {}),
  };
  const shape = stallShape(input);
  const toolChoice = stallRecoveryToolChoice(input);
  if (shouldRecoverStalledTurn(input)) {
    const used = recoveriesUsed + 1;
    return {
      policy,
      step: {
        kind: 'nudge',
        nudge: stallRecoveryNudge(used >= MAX_ANNOUNCEMENT_RECOVERIES, shape, input),
        ...(toolChoice ? { toolChoice } : {}),
        recoveriesUsed: used,
        shape,
      },
    };
  }
  if (!isExhaustedStall(input)) return { policy, step: { kind: 'none' } };

  const next = reduceRunPolicy(policy, {
    type: 'stalled',
    ...(turn.resolvedModel ? { resolvedModel: turn.resolvedModel } : {}),
    ...(source.surface !== undefined ? { surface: source.surface } : {}),
    ...(source.pick ? { pick: source.pick } : {}),
  });
  const outcome = next.outcome;
  if (outcome.kind === 'failed_over') {
    return {
      policy: next,
      step: {
        kind: 'failover',
        // The incoming model gets the FIRST nudge, not the last-chance one: the outgoing
        // model's failures say nothing about it.
        nudge: stallRecoveryNudge(false, shape, input),
        ...(toolChoice ? { toolChoice } : {}),
        notice: modelFailoverNotice(outcome.from, outcome.to, shape),
        from: outcome.from,
        to: outcome.to,
        attempt: outcome.attempt,
        of: outcome.of,
        recoveriesUsed: 0,
        shape,
      },
    };
  }
  const tried = outcome.kind === 'failover_exhausted' ? outcome.tried : next.tried;
  const spent = turn.resolvedModel ?? policy.model;
  return { policy: next, step: { kind: 'exhausted', notice: stallExhaustedNotice(spent, tried, shape), tried, shape } };
}
