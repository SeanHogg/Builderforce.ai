/**
 * The loop-breaker for FAILING calls.
 *
 * `readCoverage.ts` guards the successful read that keeps coming back — the model
 * circling one file until its budget is gone. It deliberately records nothing about a
 * FAILED call, and that is correct on its own terms: a read that failed has no result
 * sitting in the transcript to reuse, so stubbing a retry would strand the run on a
 * transient error.
 *
 * The consequence is that identical FAILURES get no pushback at all. Measured on a real
 * run: `git_status` was called three times with the same arguments and answered three
 * times with the same "not a git repository at the workspace root" remedy — a remedy
 * that names the exact retry (`repo: "…"`) — and the model made the same bare call
 * again each time. Same for a platform read answered `HTTP 502` twice. Nothing in the
 * loop distinguished "retrying a flake", which is right, from "asking a question that
 * has already been answered the same way twice", which is a stall wearing the costume
 * of persistence.
 *
 * So: the FIRST retry of a failed call passes silently — flakes are real, and a tool
 * that failed on a network blip deserves another go. From the SECOND identical failure
 * the result the model reads carries the count and the error it already got, and the
 * only two moves that can work: change an argument (the remedy usually names which), or
 * stop and say what is blocking. From the third it is an instruction, not a suggestion.
 *
 * "Identical" is the same fingerprint the exact-repeat read guard uses — same tool, same
 * arguments in any key order — so a genuine change of arguments starts a fresh count and
 * is never nagged. A SUCCESS clears the tally for that call outright.
 *
 * Pure and self-contained: a small tally with one method to record a failure and one to
 * clear it. No clock, no I/O — the same shape, and the same reasons, as `ReadCoverage`.
 */

import { stableStringify } from './stableStringify';

/**
 * Identical failures before the model is told it is repeating itself. The first retry
 * is free: a tool that failed once may well have failed on a flake, and a run that
 * refuses to try again is worse than one that tries twice.
 */
export const FAILURE_NUDGE_AT = 2;

/**
 * Identical failures after which the advisory stops asking and starts instructing. By
 * the third the evidence that another go will help is gone.
 */
export const FAILURE_HARD_AT = 3;

/** Per-run tally of which exact calls have FAILED, and how often. One instance per run;
 *  the run loop owns it and drops it when the run ends. */
export class FailureTally {
  private readonly failures = new Map<string, number>();

  private static key(tool: string, args: unknown): string {
    return `${tool}:${stableStringify(args ?? {})}`;
  }

  /** Record a FAILED call. Returns how many times this exact call has now failed,
   *  including this one. */
  record(tool: string, args: unknown): number {
    const key = FailureTally.key(tool, args);
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    return attempts;
  }

  /** This exact call SUCCEEDED. Its earlier failures were transient after all, so they
   *  are no longer evidence of anything — a later failure starts counting from one. */
  clear(tool: string, args: unknown): void {
    this.failures.delete(FailureTally.key(tool, args));
  }
}

/** The error text a failed tool result carries, if it names one — quoted back to the
 *  model so the advisory argues from the answer it already got rather than in the
 *  abstract. Bounded: a stack trace pasted into an advisory buries the advisory. */
export function failureReason(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const error = (result as { error?: unknown }).error;
  return typeof error === 'string' && error.trim() ? error.trim().slice(0, 400) : undefined;
}

/**
 * The advisory to attach to a failed tool result once the identical call has failed
 * enough times to be a loop rather than a retry. Null below the threshold — the first
 * retry of anything carries nothing extra.
 *
 * Written the same way the revisit advisory is: a diagnosis, the evidence, and the
 * moves that remain. A model told only "this failed again" retries again.
 */
export function repeatedFailureAdvisory(tool: string, attempts: number, reason?: string): string | null {
  if (attempts < FAILURE_NUDGE_AT) return null;
  const got = reason ? ` Both times it answered: "${reason}".` : '';
  if (attempts >= FAILURE_HARD_AT) {
    const said = reason ? ` It has answered "${reason}" every time.` : '';
    return `STOP CALLING \`${tool}\` WITH THESE ARGUMENTS. This is failure ${attempts} of the identical call in this run.${said} The arguments are the problem, not the timing — repeating them will fail again and will spend the rest of this run's tool budget. Do ONE of these now: (a) re-read the error above and change the argument it names (a failing tool usually says exactly what to pass instead — a scope, a path, an id — so pass it); (b) reach the same goal with a different tool; (c) stop and tell the user plainly what is blocking you and what you need from them. Do not issue this call again.`;
  }
  return `\`${tool}\` has now failed ${attempts} times in this run with these exact arguments.${got} Another identical attempt will not behave differently — this is not a flake. Read the error above and change what it names (most failures state the argument to pass instead), use a different tool to reach the same goal, or say plainly what is blocking you. Do not simply repeat the call.`;
}
