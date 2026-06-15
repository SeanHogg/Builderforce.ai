/**
 * Terminal-failure reasons for runs reaped because they never reported completion.
 * Shared by the read-path repair ({@link ../runtime/RuntimeService}) and the cron
 * sweep ({@link ./staleExecutionReaper}) so both surface the *same* actionable
 * message for the same root cause.
 *
 * A cloud run can die two very different ways, and the message MUST reflect which:
 *
 *   1. The interim Worker (serverless) loop runs in a Cloudflare `waitUntil`
 *      background task, which the platform stops shortly after the HTTP response
 *      returns (~30s observed). A multi-step agent loop physically cannot outlast
 *      that, so the guidance is "use a long-lived runtime". → CLOUD_ORPHAN_REASON.
 *
 *   2. A long-lived executor — the durable CloudRunnerDO (alarm-ticked) or a
 *      Cloudflare Container — heartbeats `updated_at` as it works and legitimately
 *      runs for minutes. When one of THOSE goes silent it ran well past the ~30s
 *      wall first, so it did NOT hit a serverless timeout: its process crashed, a
 *      tool call hung, or the heartbeat was lost. → CLOUD_LONG_LIVED_ORPHAN_REASON.
 *
 * Stamping the serverless "~30s, downgrade to a durable runtime" message on a
 * container/durable run that ran 60-90s is doubly wrong (it never hit 30s, and the
 * container is already MORE capable than durable). {@link cloudOrphanReason} picks
 * the right one from how long the run actually made progress.
 */
export const CLOUD_ORPHAN_REASON =
  'This cloud (serverless) run exceeded the background-execution time limit (~30s) before reporting completion, so it was stopped — only the steps above ran. Serverless cloud runs can perform just a few quick steps; for a multi-step coding task, assign a self-hosted agent (or a durable cloud runtime) and re-run, and it will run to completion.';

/** A long-lived cloud executor (durable CloudRunnerDO or Cloudflare Container) that
 *  ran past the serverless wall and then went silent — a crash / hung tool / lost
 *  heartbeat, NOT a 30s timeout. Re-running is the fix (the cron reaper also retries
 *  an orphan once on the durable executor); a container that keeps dying here points
 *  at an unstable image, and a self-hosted agent is the most reliable long-run surface. */
export const CLOUD_LONG_LIVED_ORPHAN_REASON =
  'This run executed on a long-lived cloud runtime (durable Object / container) and went silent mid-run after running well past the ~30s serverless wall — a process crash, a hung tool call, or a lost heartbeat, not a serverless timeout. Only the steps above ran. Re-run the task; if a container run keeps dying here the image is likely unstable, and a self-hosted agent is the most reliable surface for long multi-step work.';

/** Worker `waitUntil` wall (~30s observed) + margin for the terminal-status write
 *  and clock skew. A cloud run whose last progress (`updated_at`) is more than this
 *  past its start could NOT have been the serverless Worker loop — it heartbeated on
 *  a long-lived executor and then stalled. */
export const SERVERLESS_WALL_MS = 45_000;

/**
 * Pick the right cloud-orphan reason from how long the run actually made progress.
 * `startedAtMs` = when the run started; `lastActivityMs` = its last heartbeat
 * (`updated_at`). When that span exceeds the serverless wall the run provably ran on
 * a long-lived executor (durable/container) and crashed, so the serverless "~30s"
 * message would be false — use the long-lived reason instead. Falls back to the
 * serverless reason when the span is short or the timestamps are unknown (a run that
 * never heartbeated past start looks exactly like the dying Worker loop).
 */
export function cloudOrphanReason(startedAtMs: number | null | undefined, lastActivityMs: number | null | undefined): string {
  if (
    startedAtMs != null && Number.isFinite(startedAtMs) &&
    lastActivityMs != null && Number.isFinite(lastActivityMs) &&
    lastActivityMs - startedAtMs > SERVERLESS_WALL_MS
  ) {
    return CLOUD_LONG_LIVED_ORPHAN_REASON;
  }
  return CLOUD_ORPHAN_REASON;
}

/**
 * A cloud backplane (container / DO) caught its own crash and reported the real
 * error. This is STRICTLY better than the reaper's inferred reasons above — we know
 * exactly what failed — so prefer it whenever a backplane reports `onError` or the
 * container `fail` op. `detail` is the underlying error message.
 */
export function cloudCrashReason(detail: string): string {
  const trimmed = (detail || '').trim();
  return `This cloud run's runtime crashed before reporting completion: ${trimmed || 'unknown error'}. Only the steps above ran. The run is re-queued once on the durable executor automatically; if it still fails, re-run the task — and if a container run keeps crashing here, the image or a tool call is unstable.`;
}

/** A self-hosted host run that lost its process/connection mid-run. */
export const HOST_ORPHAN_REASON =
  'Run did not report completion in time and was marked failed (orphaned run — the agent host stopped before writing a terminal status). Re-run the task.';
