/**
 * The context pack's ONE deadline rule: every pre-turn part (the pack's fan-out, the
 * symbol lookups behind its areas, the pre-search hits, the where-answer) is raced
 * against its budget and replaced by a fallback when it is late or fails — a slow part
 * is left out, never waited on, never a run failure.
 *
 * Pure (no `vscode` import).
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
