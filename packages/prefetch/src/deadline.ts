/**
 * The ONE pre-turn deadline rule: a part (an executor, the logprob classifier, the
 * context pack's fan-out) is raced against its budget and replaced by a fallback when it
 * is late or fails — a slow part is left out, never waited on, never a run failure.
 *
 * Moved here from the VS Code context pack (`contextPack/withinMs.ts`, which re-exports
 * it) so the gate in brain-embedded enforces executor budgets with the same rule.
 */

/** `work`, or `fallback` once `ms` passes or `work` throws. The timer never outlives the race. */
export async function withinMs<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * An abort signal that fires on `parent`'s abort OR after `ms` — what an executor or the
 * tier-3 call is handed, so the work it started is killed at its deadline, not just
 * abandoned. `dispose` clears the timer and the listener once the work settled.
 */
export function deadlineSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const ctl = new AbortController();
  const onParent = () => ctl.abort(parent?.reason);
  if (parent?.aborted) ctl.abort(parent.reason);
  else parent?.addEventListener('abort', onParent, { once: true });
  const timer = setTimeout(() => ctl.abort(new Error('deadline')), Math.max(0, ms));
  return {
    signal: ctl.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParent);
    },
  };
}
