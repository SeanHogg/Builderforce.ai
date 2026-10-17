import {
  RepetitionLoopError,
  providerFailureEvent,
  providerFailureTrace,
  transportRetryTrace,
  type ProviderFailureEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { reportToPolicy, type CanvasRun } from '@/lib/canvasAiRun';

/**
 * How a Creation Canvas turn RECOVERS when a model or its provider will not deliver —
 * the two moves every give-up path in the turn shares: hand the turn to a model that
 * already proved it can act, or report the provider failure to the run policy and do
 * what it says. Pure over the turn state ({@link CanvasRun}); the loop decides when.
 */

/**
 * Retire the model that just failed to produce a usable turn and continue on one
 * that already emitted valid tool calls in this same turn — the policy's stall
 * failover, drawing only on proven models.
 *
 * Shared by every give-up path (a command the model would not execute, an
 * empty/echoed answer, a stalled provider) — they differ only in what they tell the
 * replacement model. Returns false when no proven model is left, which is the
 * caller's signal to stop. With nothing to switch to the failure is NOT recorded: its
 * only purpose is routing around the model on a later turn, and a session with no
 * alternative gains nothing from it while paying the full price.
 */
export function switchToProvenModel(run: CanvasRun, failedModel: string | null | undefined, directive: string): boolean {
  const { options, messages } = run;
  const outcome = reportToPolicy(run, { type: 'stalled', ...(failedModel ? { resolvedModel: failedModel } : {}) }).outcome;
  if (outcome.kind !== 'failed_over') return false;
  const fallback = outcome.to;
  if (failedModel) options.onModelDisabled?.(failedModel);
  run.mutationRecoveries = 0;
  run.buildAuthoringRecoveries = 0;
  run.degenerateAnswerRecoveryUsed = false;
  run.interruptedTurnRecoveries = 0;
  options.onModelFallback?.(fallback);
  messages.push({ role: 'system', content: `${directive} Continue on ${fallback}, which already emitted valid tool calls in this turn.` });
  return true;
}

/**
 * The PROVIDER broke under this round-trip — route around it rather than end the turn
 * on the vendor's error. The canvas's one addition to the shared policy path: a model
 * that already ACTED in this turn takes over first (`preferProvenFailover`). With none,
 * the failure is reported to the run policy exactly as the Brain run store reports it,
 * and its outcome decides — a retry on the gateway's pool with the broken model left
 * out, or the end of the turn, after which the tail delivers whatever the turn already
 * has with a localized notice.
 */
export function rerouteAfterProviderFailure(
  run: CanvasRun,
  failure: ProviderFailureEvent,
  failedModel: string | null | undefined,
  message: string,
  step: number,
): { skip: true } | { failed: string } {
  const { options, messages } = run;
  run.providerFailures += 1;
  if (switchToProvenModel(run, failedModel, 'The prior model failed mid-request and has been disabled for this session.')) return { skip: true };
  const outcome = reportToPolicy(run, failure).outcome;
  if (outcome.kind === 'retry_turn') {
    options.onTrace?.(transportRetryTrace(new Date().toISOString(), step, outcome, message));
    messages.push({ role: 'system', content: 'The prior model failed mid-request, so this turn now continues on a different model. Continue the user\'s request from where it left off, building on the work already done.' });
    return { skip: true };
  }
  // Out of providers: stop, and let the tail deliver whatever the turn already has.
  run.abandonedMidTurn = true;
  return { failed: `provider failed: ${message}` };
}

/**
 * A round-trip's stream threw. The provider broke under it — an in-band error frame
 * ("Upstream error from Nvidia: Service temporarily overloaded"), a dropped, silent or
 * looping stream, a gateway that never answered, a reset, a rate limit or an outage
 * status. Classified by THE shared `providerFailureEvent`, exactly as the Brain run
 * store does; anything it does not recognise (a refusal, a user Stop) is rethrown as it
 * is. The vendor's text is a trace, never the user's answer (measured 2026-10-17, ui
 * 2026.10.52: a turn that had already put its diagram on the board ended on that
 * sentence). Returns what the model port hands the kernel.
 */
export function recoverFromProviderFailure(
  run: CanvasRun,
  error: unknown,
  askedModel: string | undefined,
  step: number,
): { skip: true } | { failed: string } {
  const failure = providerFailureEvent(error);
  if (!failure) throw error;
  run.throwIfStopped();
  const message = (error as Error).message;
  const failedModel = failure.model ?? askedModel;
  run.options.onTrace?.(providerFailureTrace(new Date().toISOString(), step, failedModel, error));
  run.finalText = '';
  const next = rerouteAfterProviderFailure(run, failure, failedModel, message, step);
  // Out of models: a model that LOOPED still said something real before the loop.
  if ('failed' in next && error instanceof RepetitionLoopError) run.finalText = error.kept;
  run.options.onText?.(run.finalText);
  return next;
}
