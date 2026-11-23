/**
 * What marks a run's closing reply as NOT a settled answer — a reply the run was forced into, saved as the chat's last message so
 * the person sees why it stopped, but never something the run concluded. A reader that wants "what did this run conclude" (the
 * editor's run-end memory) must not adopt the reply of a run that ended this way.
 *
 * Both ends are steps the loop ALREADY records (the parity snapshots are that oracle; nothing new is persisted for this):
 *   - the USD cap stopped it: {@link BUDGET_CONTAINED_STEP};
 *   - the consecutive-failure breaker stopped it: the Brain turn recorder logs the shared driver's closing turn as an `llm.complete`
 *     step with `args.forcedFinish: true` ({@link isForcedFinishStep}), only when that forced reply was produced.
 *
 * ONE reader for a run's trace slice: {@link isUnsettledAnswer}.
 */

/** The run's USD cap stopped it; its reply says why (`runSpendBudget.ts`, `run/eventSink.ts`). */
export const BUDGET_CONTAINED_STEP = 'run.budget_contained';

/** The tools-free closing turn of a run the failure breaker stopped. */
export function isForcedFinishStep(event: { label: string; args?: unknown }): boolean {
  return event.label === 'llm.complete' && (event.args as { forcedFinish?: unknown } | undefined)?.forcedFinish === true;
}

/** Does this trace slice (pass THIS run's steps) show the run ending on a reply it was forced into? */
export function isUnsettledAnswer(trace: ReadonlyArray<{ label: string; args?: unknown }>): boolean {
  return trace.some((event) => event.label === BUDGET_CONTAINED_STEP || isForcedFinishStep(event));
}
