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
 * A GitHub Actions run is QUEUED before it is running: after `workflow_dispatch`
 * returns, GitHub must schedule a runner, boot it, check out the repo and install
 * Node before our runner script can send its first heartbeat. On a busy queue (or
 * a repo at its concurrency cap) that gap routinely exceeds five minutes with the
 * run perfectly healthy.
 *
 * So the long-lived ceiling would reap essentially every Actions run before it
 * ever started. This surface gets its own, much larger ceiling covering the
 * schedule + boot + checkout window plus a real step. The asymmetry is the whole
 * reason {@link cloudSilenceCeilingMs} takes an executor.
 */
export const CLOUD_GITHUB_ACTIONS_SILENCE_MS = 20 * 60_000;

/**
 * ── GitHub Actions: reconciled (not reaped) failures ─────────────────────────
 *
 * Every reason above is INFERRED from silence — the reaper knows only that
 * nothing reported in. On the Actions surface we can do materially better: GitHub
 * will tell us whether it ever scheduled a runner, and what happened to it. The
 * reconcile sweep ({@link ./githubActionsReconcile}) asks, so these reasons name
 * the actual root cause instead of the generic "this run went silent".
 *
 * They live here with the reaper's reasons for the same reason those do: one
 * place decides what a user is told about a run that never finished, so the
 * reconcile sweep and the 20-minute backstop can never contradict each other.
 */

/** GitHub accepted the `workflow_dispatch` (204) but never scheduled a run for it.
 *  The overwhelmingly common causes are Actions disabled for the repo/org, a
 *  spending limit reached, or a `workflow_dispatch` trigger that is not present on
 *  the DEFAULT branch (GitHub only honours the trigger definition there). */
export const GITHUB_ACTIONS_NEVER_SCHEDULED_REASON =
  'GitHub accepted the workflow dispatch but never scheduled a run for it, so no agent ever started. That almost always means Actions is disabled for this repository or organisation, the account has hit its Actions spending limit, or the Builderforce agent workflow is missing its workflow_dispatch trigger on the DEFAULT branch (GitHub only honours the trigger defined there). Check the repository\'s Actions tab, then re-run "Enable GitHub agent runs" from the project\'s Source control settings and re-run the task.';

/** We could not even LIST the repo's workflow runs — the credential lost access, or
 *  Actions is administratively disabled (GitHub answers 403 for both). */
export function githubActionsUnreachableReason(detail: string): string {
  const trimmed = (detail || '').trim();
  return `This run was queued on GitHub Actions, but Builderforce can no longer read the repository's Actions runs to confirm it started: ${trimmed || 'access denied'}. Either the linked credential lost access to the repository or Actions is disabled for it. Re-connect the repository credential (it needs the "workflow" scope, or "workflows: write" on the GitHub App installation), then re-run the task.`;
}

/** GitHub DID schedule the run and it reached a terminal state without the agent
 *  ever checking in — the job died in checkout/setup, was cancelled, or timed out.
 *  The run URL is the single most useful thing to hand over here: the failure is
 *  in GitHub's log, not ours. */
export function githubActionsRunEndedReason(conclusion: string | null, htmlUrl: string | null): string {
  const outcome = (conclusion || 'ended').trim();
  const where = htmlUrl ? ` See the run log: ${htmlUrl}` : '';
  return `The GitHub Actions job for this run ${outcome === 'success' ? 'finished' : `ended as "${outcome}"`} without the Builderforce agent ever checking in, so no steps were executed. The job stopped before or during checkout/setup — a cancelled or timed-out job, a runner that could not start, or a failing step ahead of the agent.${where} Fix the job on GitHub and re-run the task, or switch the agent to the durable cloud surface to run it on Builderforce infrastructure instead.`;
}

/**
 * The silence ceiling for the executor a run landed on (stamped on the payload by
 * dispatch; see {@link ../runtime/cloudDispatch.parseExecutor}).
 *
 * `durable` and `container` share {@link CLOUD_LONG_LIVED_SILENCE_MS}: both are
 * already-running processes, so silence really does mean "crashed or hung".
 * `github_actions` cannot assume that — see
 * {@link CLOUD_GITHUB_ACTIONS_SILENCE_MS}.
 *
 * Reaping a live run (false positive) is far worse than a few extra minutes
 * before failing a genuinely dead one (false negative), so the generous
 * long-lived ceiling remains the default for an UNKNOWN executor (older or
 * unstamped payloads).
 */
export function cloudSilenceCeilingMs(executor?: string | null): number {
  return executor === 'github_actions' ? CLOUD_GITHUB_ACTIONS_SILENCE_MS : CLOUD_LONG_LIVED_SILENCE_MS;
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
