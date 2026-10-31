/**
 * Whether an idle run container is kept alive for a background job.
 *
 * `AgentContainerDO.sleepAfter` (20m) counts requests. A background job (`run_command`
 * `background`, a dev server, a long build) can keep running with no request arriving for
 * longer than that, and the idle reap would kill it mid-work. So when the timer expires the
 * DO asks the container whether a job is running, and this decides what to do with the answer.
 *
 * The keep-alive is CAPPED. A job nobody polls or stops (the model forgot it, the run
 * parked, the run ended without its close reaching the box) would otherwise renew the timer
 * forever and bill the container for as long as the process lives. Past the cap the container
 * is stopped and the job ends with it; a job that legitimately needs longer is restarted by
 * the model on its next sandbox call, which reopens the box.
 */

/** Longest a running background job alone may hold an otherwise-idle container (cost bound
 *  for an abandoned job). Measured from the first renewal for it, reset by a job-free check. */
export const JOB_KEEPALIVE_MAX_MS = 60 * 60_000;

export interface KeepAliveDecision {
  /** Renew the activity timer (true) or stop the container (false). */
  keep: boolean;
  /** The keep-alive start to persist; null = clear it. */
  since: number | null;
}

/**
 * @param active   whether the container reports a running background job
 * @param since    when this keep-alive began (persisted), if one is in effect
 * @param now      the clock
 */
export function decideJobKeepAlive(active: boolean, since: number | undefined, now: number): KeepAliveDecision {
  if (!active) return { keep: false, since: null };
  const started = since ?? now;
  if (now - started >= JOB_KEEPALIVE_MAX_MS) return { keep: false, since: null };
  return { keep: true, since: started };
}
