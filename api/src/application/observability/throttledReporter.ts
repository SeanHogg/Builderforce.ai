import type { DurableErrorReporter } from './durableErrorReporter';

/**
 * A reporter that forwards a given `kind` of error at most once per `intervalMs`.
 *
 * For failures that repeat on every attempt (a save that always fails, a refusal that every
 * reconnect triggers): the first occurrence is what an operator needs, not one per attempt.
 */
export type ThrottledReporter = (kind: string, error: unknown, details: Parameters<DurableErrorReporter>[1]) => void;

export function createThrottledReporter(report: DurableErrorReporter, intervalMs: number, now: () => number = Date.now): ThrottledReporter {
  const lastReported = new Map<string, number>();
  return (kind, error, details) => {
    const at = now();
    const last = lastReported.get(kind);
    if (last !== undefined && at - last < intervalMs) return;
    lastReported.set(kind, at);
    report(error, details);
  };
}
