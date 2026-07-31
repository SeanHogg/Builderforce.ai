import { isInfrastructureEviction } from './orphanReasons';

/**
 * WHY RUNS FAIL — the class of a terminal `executions.error_message`.
 *
 * ── THE BLIND SPOT THIS CLOSES ───────────────────────────────────────────────────
 * The daily digest reported `agent runs failed: 162` against `completed: 16` and said
 * nothing at all about why. That is the same shape of blind spot the pass budget had
 * before `PassBudget.mark`: a number that proves something is wrong and cannot say
 * what, which is diagnosed by guessing — and guessing from that report was wrong twice
 * in one session. A 91% failure rate is the single largest fact about a board where
 * nothing finishes, and "162" is not an actionable version of it.
 *
 * These classes are deliberately COARSE and mapped from the reason constants in
 * `orphanReasons.ts` rather than invented here, so the class a run is counted under is
 * the same distinction the platform already makes when it decides what to tell a human
 * and whether the autonomy breaker should count the failure at all.
 *
 * `unknown` is not a failure of this function — it is the useful answer. It means the
 * message came from somewhere that has no named reason yet, so the rollup carries a
 * verbatim sample and the NEXT capture names it. Never fold `unknown` into a neighbour
 * to make the table look tidy: a wrong class is worse than an unclassified one, because
 * it sends the reader to the wrong subsystem.
 */
export type RunFailureClass =
  /** A deploy or isolate teardown killed the run. Not the ticket's fault; the breaker
   *  already excludes these ({@link isInfrastructureEviction}). */
  | 'infra_eviction'
  /** Died before ever heartbeating past the serverless wall — never really started. */
  | 'orphan_early'
  /** Ran well past the wall, then went silent — crash, hung tool, lost heartbeat. */
  | 'orphan_late'
  /** The backplane caught its own crash and reported the real error. */
  | 'runtime_crash'
  /** GitHub accepted the dispatch and never scheduled a runner. */
  | 'actions_never_scheduled'
  /** We lost the ability to read the repo's Actions runs (credential or disabled). */
  | 'actions_unreachable'
  /** The Actions job ended without our agent ever checking in. */
  | 'actions_job_ended'
  /** Paused on a question for a human that nobody answered inside the deadline. */
  | 'paused_unanswered'
  /** A self-hosted host process/connection died mid-run. */
  | 'host_orphan'
  /** No model could be resolved, or every candidate was refused/unavailable. */
  | 'model_unavailable'
  /** A provider rate limit or capacity ceiling. */
  | 'rate_limited'
  /** A credential was rejected — BYO key, OAuth token, or provider auth. */
  | 'auth_failed'
  /** The tenant's token budget or run cap stopped it. */
  | 'quota_exhausted'
  /** The repo/branch/PR layer refused — clone, push, or branch protection. */
  | 'repo_error'
  /** Terminal, but the message matches no named reason. Carries a sample. */
  | 'unknown';

/** Human-readable label per class — one place, so the API and the report agree. */
export const RUN_FAILURE_LABEL: Record<RunFailureClass, string> = {
  infra_eviction: 'platform restart interrupted the run (not the ticket)',
  orphan_early: 'run died immediately — never got going',
  orphan_late: 'run went silent mid-way — crash, hung tool or lost heartbeat',
  runtime_crash: 'the runtime crashed and reported the error',
  actions_never_scheduled: 'GitHub never scheduled the Actions run',
  actions_unreachable: 'cannot read the repo’s Actions runs (credential or disabled)',
  actions_job_ended: 'the Actions job ended before the agent checked in',
  paused_unanswered: 'paused on a question nobody answered in 72h',
  host_orphan: 'the self-hosted agent stopped before reporting',
  model_unavailable: 'no model available — none resolved or all refused',
  rate_limited: 'provider rate limit or capacity ceiling',
  auth_failed: 'a credential was rejected',
  quota_exhausted: 'token budget or run cap reached',
  repo_error: 'the repository refused the operation',
  unknown: 'unclassified — see the sample message',
};

/**
 * True when the class means "the platform got in the way", not "this work failed".
 *
 * The distinction is load-bearing for a reader: a board whose failures are all
 * `infra_eviction` is healthy and being interrupted, and one whose failures are all
 * `runtime_crash` is not — and those two demand completely different responses. Kept
 * beside the classes so a new class must decide which side it is on.
 */
export function isPlatformFailure(cls: RunFailureClass): boolean {
  return cls === 'infra_eviction' || cls === 'orphan_early' || cls === 'orphan_late'
    || cls === 'actions_never_scheduled' || cls === 'actions_unreachable'
    || cls === 'rate_limited' || cls === 'quota_exhausted';
}

/**
 * Classify one terminal error message. PURE — unit-tested directly.
 *
 * Order matters: the specific named reasons are matched BEFORE the generic keyword
 * probes, because the reason constants are prose that legitimately contains words like
 * "crash" and "limit". Matching the generic probe first would misfile every orphan
 * reason under whatever keyword happened to appear in its advice sentence.
 */
export function classifyRunFailure(message: string | null | undefined): RunFailureClass {
  const m = (message ?? '').trim();
  if (!m) return 'unknown';

  // 1. The platform's OWN named reasons, by their distinguishing phrase.
  if (isInfrastructureEviction(m)) return 'infra_eviction';
  if (/interrupted by a platform restart/i.test(m)) return 'infra_eviction';
  if (/never scheduled a run for it/i.test(m)) return 'actions_never_scheduled';
  if (/can no longer read the repository's Actions runs/i.test(m)) return 'actions_unreachable';
  if (/without the Builderforce agent ever checking in/i.test(m)) return 'actions_job_ended';
  if (/paused on a question for a human/i.test(m)) return 'paused_unanswered';
  if (/agent host stopped before writing a terminal status|orphaned run/i.test(m)) return 'host_orphan';
  if (/runtime crashed before reporting completion/i.test(m)) return 'runtime_crash';
  if (/went silent mid-run after running well past/i.test(m)) return 'orphan_late';
  if (/stopped reporting progress almost immediately/i.test(m)) return 'orphan_early';

  // 2. Generic provider / infrastructure probes, for messages that reach us verbatim
  //    from a vendor rather than through a reason constant.
  if (/\b429\b|rate.?limit|too many requests|over capacity|capacity limit/i.test(m)) return 'rate_limited';
  if (/\b40[13]\b|unauthorized|unauthenticated|invalid api key|authentication failed|credential/i.test(m)) return 'auth_failed';
  if (/token (budget|cap|limit) (reached|exhausted)|quota (exceeded|exhausted)|run cap/i.test(m)) return 'quota_exhausted';
  if (/no model|model not (found|available)|all models|no provider|unsupported model/i.test(m)) return 'model_unavailable';
  if (/merge conflict|could not clone|push (was )?rejected|branch protection|repository not found/i.test(m)) return 'repo_error';

  return 'unknown';
}

/** One row of the rollup: a class, how many runs it accounts for, and — crucially for
 *  `unknown` — a verbatim sample so the next capture can name it. */
export interface RunFailureTally {
  reason: RunFailureClass;
  label: string;
  count: number;
  /** A representative raw message, truncated. Null when the class is self-explanatory. */
  sample: string | null;
  /** Whether this class is the platform's fault rather than the work's. */
  platform: boolean;
}

/**
 * Roll distinct messages (with their counts) up into classes, largest first.
 *
 * Takes messages already GROUPED and counted by the database rather than one row per
 * run: a busy day is hundreds of failures over a handful of distinct messages, and
 * pulling every row to count them in memory would be the N+1 this codebase forbids.
 */
export function rollUpRunFailures(
  rows: ReadonlyArray<{ message: string | null; count: number }>,
  sampleLimit = 220,
): RunFailureTally[] {
  const byClass = new Map<RunFailureClass, { count: number; sample: string | null }>();
  for (const row of rows) {
    const reason = classifyRunFailure(row.message);
    const cur = byClass.get(reason) ?? { count: 0, sample: null };
    // Keep the sample from the LARGEST contributing message, not the first seen —
    // an unclassified tail of one-off messages must not hide the dominant one.
    const better = cur.sample === null || row.count > cur.count;
    byClass.set(reason, {
      count: cur.count + row.count,
      sample: better ? (row.message ?? '').trim().slice(0, sampleLimit) || null : cur.sample,
    });
  }
  return [...byClass.entries()]
    .map(([reason, v]) => ({
      reason,
      label: RUN_FAILURE_LABEL[reason],
      count: v.count,
      // Only carry the raw text where it adds something. A named reason's message is
      // three sentences of advice the reader does not need repeated per row; an
      // `unknown` is nothing BUT its message.
      sample: reason === 'unknown' || reason === 'runtime_crash' || reason === 'repo_error' ? v.sample : null,
      platform: isPlatformFailure(reason),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
