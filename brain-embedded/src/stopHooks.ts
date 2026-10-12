/**
 * STOP HOOKS — a host's say over whether a run may end.
 *
 * The loop's own end-of-run gates (`selfReviewShip.ts`, `previewReview.ts`, …) are the
 * platform's contracts. This is the seam for the WORKSPACE's: a host (the VS Code
 * extension reads them from a committed `.builderforce/hooks.json`) can hold a run that
 * is about to settle and hand it one more instruction — "update README and DONE with what
 * you completed", or "the lint you were told to keep green failed, here is its output".
 *
 * The loop owns only the BOUND and the re-prompt; what the hook says is the host's. Asked
 * every time the run is about to end, so a hook that re-checks (a failing command) gets
 * to see the run's fix — but never more than {@link MAX_STOP_HOOK_ROUNDS} times per run:
 * a command that can never pass must not keep a run alive on the tenant's money.
 *
 * Runs BEFORE the ship gate on purpose: whatever a stop hook asks for (docs, a changelog
 * line, a formatter's fixes) is part of the change, so it lands in the same commit
 * instead of being left dirty after the push.
 */

/** What the host is told about a run that is about to end. */
export interface RunStopInput {
  /** The run changed code in this turn (or a resumed turn). */
  codeChanged: boolean;
  /** Workspace-relative files the run touched, in order. */
  touchedFiles: readonly string[];
  /** The user's request that started the run. */
  requestText: string;
  /** How many stop-hook re-prompts this run has already had. */
  round: number;
}

/**
 * A host's stop hook: a non-empty string holds the run and becomes its next user turn;
 * null / undefined / '' lets it settle.
 */
export type RunStopHook = (input: RunStopInput) => Promise<string | null | undefined>;

/** Re-prompts one run can receive from stop hooks before it is allowed to settle. */
export const MAX_STOP_HOOK_ROUNDS = 4;

/**
 * Ask the host's stop hook whether the run may end. Returns the nudge to re-prompt with,
 * or null to let it settle. Best-effort: a throwing hook never fails or holds the run.
 */
export async function askStopHook(hook: RunStopHook | undefined, input: RunStopInput): Promise<string | null> {
  if (!hook || input.round >= MAX_STOP_HOOK_ROUNDS) return null;
  try {
    const nudge = (await hook(input))?.trim();
    return nudge ? nudge : null;
  } catch {
    return null;
  }
}
