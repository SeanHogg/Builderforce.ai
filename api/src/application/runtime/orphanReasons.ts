/**
 * Terminal-failure reasons for runs reaped because they never reported completion.
 * Shared by the read-path repair ({@link ../runtime/RuntimeService}) and the cron
 * sweep ({@link ./staleExecutionReaper}) so both surface the *same* actionable
 * message for the same root cause.
 *
 * Both surviving cloud executors (the alarm-ticked durable CloudRunnerDO and the
 * Cloudflare Container) are long-lived and heartbeat `updated_at` as they work, but a
 * run can still die two very different ways, and the message MUST reflect which:
 *
 *   1. It died EARLY — before it ever heartbeated past the ~30s serverless wall. It
 *      never demonstrated it could sustain a multi-step run, so the actionable
 *      guidance is "this surface didn't get going; use a self-hosted or durable
 *      runtime and re-run". → CLOUD_ORPHAN_REASON.
 *
 *   2. It died LATE — it heartbeated for minutes, then went silent. It provably ran
 *      well past the ~30s wall, so no serverless limit was involved: its process
 *      crashed, a tool call hung, or the heartbeat was lost.
 *      → CLOUD_LONG_LIVED_ORPHAN_REASON.
 *
 * Stamping the early "background-execution limit" message on a run that ran 60-90s is
 * simply false (it never hit any such wall). {@link cloudOrphanReason} picks the right
 * one from how long the run actually made progress.
 */
/** A cloud run that went silent EARLY — it never heartbeated past the ~30s serverless
 *  wall, so it stopped before proving it could sustain a multi-step task (a failed
 *  kickoff, an immediate crash, or an executor that never really started). */
export const CLOUD_ORPHAN_REASON =
  'This cloud run stopped reporting progress almost immediately and never reached the point of running as a sustained multi-step task, so it was marked failed — only the steps above ran. Re-run the task; if it keeps dying this early, assign a self-hosted agent, which is the most reliable surface for long multi-step work.';

/** A long-lived cloud executor (durable CloudRunnerDO or Cloudflare Container) that
 *  ran past the serverless wall and then went silent — a crash / hung tool / lost
 *  heartbeat, NOT a 30s timeout. Re-running is the fix (the cron reaper also retries
 *  an orphan once on the durable executor); a container that keeps dying here points
 *  at an unstable image, and a self-hosted agent is the most reliable long-run surface. */
export const CLOUD_LONG_LIVED_ORPHAN_REASON =
  'This run executed on a long-lived cloud runtime (durable Object / container) and went silent mid-run after running well past the ~30s serverless wall — a process crash, a hung tool call, or a lost heartbeat, not a serverless timeout. Only the steps above ran. Re-run the task; if a container run keeps dying here the image is likely unstable, and a self-hosted agent is the most reliable surface for long multi-step work.';

/** Cloudflare's `waitUntil` background wall (~30s observed) + margin for the
 *  terminal-status write and clock skew. A cloud run whose last progress
 *  (`updated_at`) is more than this past its start demonstrably survived well beyond
 *  any serverless limit, so it died LATE (crash / hung tool / lost heartbeat) rather
 *  than early — which is exactly the distinction {@link cloudOrphanReason} makes. */
export const SERVERLESS_WALL_MS = 45_000;

/**
 * Silence ceiling for a cloud executor. BOTH of them — the durable CloudRunnerDO and
 * the Cloudflare Container — are long-lived, so this is the only ceiling. They
 * heartbeat `updated_at` exactly ONCE per alarm tick, and
 * a tick legitimately spans a single LLM step: a slow free coder (or a funded-backstop
 * failover chain) routinely runs 60-90s+ for ONE completion (observed 93s on
 * `@cf/moonshotai/kimi-k2.7-code`, execution #136). At the old 90s ceiling that live,
 * mid-completion tick was orphan-reaped ~2s before it returned. 5 min clears the
 * worst-case single step + failover with margin, so only a genuinely silent (crashed /
 * hung) long-lived run is reaped — while still surfacing a dead one in minutes.
 */
export const CLOUD_LONG_LIVED_SILENCE_MS = 5 * 60_000;

/**
 * The silence ceiling for the executor a run landed on (stamped on the payload by
 * dispatch; see {@link ../runtime/cloudDispatch.parseExecutor}). EVERY cloud executor
 * now gets {@link CLOUD_LONG_LIVED_SILENCE_MS}: there used to be a second, tight 90s
 * ceiling for an in-request serverless 'worker' loop, but that executor was never
 * reachable and has been removed, leaving only the two long-lived surfaces. Reaping a
 * live tick mid-completion (false positive) is far worse than a few extra minutes
 * before failing a genuinely dead run (false negative), so the generous ceiling is
 * also the right default for an UNKNOWN executor (older/unstamped payloads).
 *
 * `executor` is retained so call sites keep reading as "the ceiling FOR THIS RUN" and
 * a future per-surface ceiling needs no call-site churn — it is deliberately unused.
 */
export function cloudSilenceCeilingMs(_executor?: string | null): number {
  return CLOUD_LONG_LIVED_SILENCE_MS;
}

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

/**
 * How long a run PAUSED on an `ask_human` question may wait for an answer before it
 * is failed and its ticket unblocked.
 *
 * A paused run is legitimately long — the agent asked a real question and a human
 * answers it when they next sit down — so this must NOT be aggressive: 72h clears a
 * long weekend, so a question raised on Friday evening is still answerable Monday
 * morning. But it cannot be infinite either: `evaluateTaskAutoRun` and
 * `laneRequirementGate` both COUNT a paused run as LIVE, while nothing (neither
 * `RuntimeService.isOrphaned` nor the cron reaper) ever reaped one — so a single
 * unanswered question permanently blocked EVERY future auto-run on that ticket.
 *
 * Kept here with the other orphan policy so the read-path repair and the cron sweep
 * apply the identical deadline and message.
 */
export const PAUSED_DEADLINE_MS = 72 * 60 * 60_000; // 72h

/** A run that paused on an agent question nobody ever answered. Failing it is what
 *  releases the ticket: a paused run counts as LIVE for auto-run, so leaving it
 *  parked forever blocks all further autonomy on that ticket. */
export const PAUSED_ORPHAN_REASON =
  'This run paused on a question for a human and no answer arrived within 72 hours, so it was closed out and the ticket released for autonomy. Nothing was lost — re-run the task (answering the agent question inline) and it will continue from a fresh run.';

/** A self-hosted host run that lost its process/connection mid-run. */
export const HOST_ORPHAN_REASON =
  'Run did not report completion in time and was marked failed (orphaned run — the agent host stopped before writing a terminal status). Re-run the task.';
