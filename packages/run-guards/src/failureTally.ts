/**
 * The loop-breaker for FAILING calls.
 *
 * The read guard deliberately records nothing about a FAILED call — a read that failed
 * has no result in the transcript to reuse. The consequence is that identical FAILURES
 * get no pushback at all: `git_status` answered three times with the same "not a git
 * repository" remedy (a remedy naming the exact retry), and the model made the same bare
 * call again each time.
 *
 * So: the FIRST retry of a failed call passes silently — flakes are real. From the
 * SECOND identical failure the result carries the count and the error it already got,
 * and the only two moves that can work; from the third it is an instruction.
 * "Identical" is {@link callFingerprint}; a SUCCESS clears the tally for that call.
 *
 * Pure; its state is plain JSON so a durable host can carry it between steps.
 */
import { callFingerprint } from "./fingerprint.js";

/** Identical failures before the model is told it is repeating itself. The first retry is free. */
export const FAILURE_NUDGE_AT = 2;

/** Identical failures after which the advisory stops asking and starts instructing. */
export const FAILURE_HARD_AT = 3;

/** The persisted form: `[fingerprint, attempts]` pairs. */
export type FailureTallyState = Array<[string, number]>;

/** Per-run tally of which exact calls have FAILED, and how often. */
export class FailureTally {
  private readonly failures: Map<string, number>;

  constructor(state?: FailureTallyState) {
    this.failures = new Map(state ?? []);
  }

  /** Record a FAILED call. Returns how many times this exact call has now failed, including this one. */
  record(tool: string, args: unknown): number {
    const key = callFingerprint(tool, args);
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    return attempts;
  }

  /** This exact call SUCCEEDED: its earlier failures were transient after all. */
  clear(tool: string, args: unknown): void {
    this.failures.delete(callFingerprint(tool, args));
  }

  /** Forget every recorded failure (the run changed course). */
  reset(): void {
    this.failures.clear();
  }

  snapshot(): FailureTallyState {
    return [...this.failures.entries()];
  }
}

/** The error text a failed tool result carries, bounded — quoted back to the model so
 *  the advisory argues from the answer it already got. */
export function failureReason(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim().slice(0, 400) : undefined;
}

/**
 * The advisory to attach to a failed tool result once the identical call has failed
 * enough times to be a loop rather than a retry. Null below the threshold.
 */
export function repeatedFailureAdvisory(tool: string, attempts: number, reason?: string): string | null {
  if (attempts < FAILURE_NUDGE_AT) return null;
  const got = reason ? ` Both times it answered: "${reason}".` : "";
  if (attempts >= FAILURE_HARD_AT) {
    const said = reason ? ` It has answered "${reason}" every time.` : "";
    return `STOP CALLING \`${tool}\` WITH THESE ARGUMENTS. This is failure ${attempts} of the identical call in this run.${said} The arguments are the problem, not the timing — repeating them will fail again and will spend the rest of this run's tool budget. Do ONE of these now: (a) re-read the error above and change the argument it names (a failing tool usually says exactly what to pass instead — a scope, a path, an id — so pass it); (b) reach the same goal with a different tool; (c) stop and tell the user plainly what is blocking you and what you need from them. Do not issue this call again.`;
  }
  return `\`${tool}\` has now failed ${attempts} times in this run with these exact arguments.${got} Another identical attempt will not behave differently — this is not a flake. Read the error above and change what it names (most failures state the argument to pass instead), use a different tool to reach the same goal, or say plainly what is blocking you. Do not simply repeat the call.`;
}
