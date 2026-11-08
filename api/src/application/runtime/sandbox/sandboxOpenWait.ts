/**
 * sandboxOpenWait — how long a run waits for a container when the pool is full.
 *
 * The state is two numbers the run's cursor carries between durable ticks, so the wait survives
 * the Durable Object being evicted: when it began and how many attempts it has made. The delay
 * doubles from {@link CAPACITY_WAIT_BASE_MS} up to {@link CAPACITY_WAIT_CAP_MS}; once the run has
 * waited {@link CAPACITY_WAIT_MAX_MS} in all, the wait is exhausted and the run carries on without
 * a shell, as it always did for an open that failed.
 */
export interface SandboxOpenWait {
  /** When the first capacity refusal came (ms epoch). */
  since: number;
  /** Capacity refusals so far. */
  attempts: number;
}

export const CAPACITY_WAIT_BASE_MS = 15_000;
export const CAPACITY_WAIT_CAP_MS = 3 * 60_000;
export const CAPACITY_WAIT_MAX_MS = 10 * 60_000;

export type SandboxWaitStep =
  | { exhausted: false; wait: SandboxOpenWait; delayMs: number }
  | { exhausted: true; waitedMs: number };

/** The next step after a capacity refusal at `now`, given the wait so far (none on the first). */
export function nextCapacityWait(prev: SandboxOpenWait | undefined, now: number): SandboxWaitStep {
  const since = prev?.since ?? now;
  const waitedMs = Math.max(0, now - since);
  if (waitedMs >= CAPACITY_WAIT_MAX_MS) return { exhausted: true, waitedMs };
  const attempts = (prev?.attempts ?? 0) + 1;
  // Capped, and never past the deadline: the last retry lands AT it, so the wait ends when it says it does.
  const delayMs = Math.min(CAPACITY_WAIT_BASE_MS * 2 ** (attempts - 1), CAPACITY_WAIT_CAP_MS, CAPACITY_WAIT_MAX_MS - waitedMs);
  return { exhausted: false, wait: { since, attempts }, delayMs };
}
