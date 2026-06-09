/**
 * Terminal-failure reasons for runs reaped because they never reported completion.
 * Shared by the read-path repair ({@link ../runtime/RuntimeService}) and the cron
 * sweep ({@link ./staleExecutionReaper}) so both surface the *same* actionable
 * message for the same root cause.
 *
 * Cloud runs execute in a Cloudflare `waitUntil` background task, which the
 * platform stops shortly after the HTTP response returns (~30s observed). A
 * multi-step agent loop physically cannot outlast that, so the right guidance is
 * "use a durable runtime", not "re-run and hope". (The durable fix is the planned
 * CloudRunnerDO — see the Consolidated Gap Register.)
 */
export const CLOUD_ORPHAN_REASON =
  'This cloud (serverless) run exceeded the background-execution time limit (~30s) before reporting completion, so it was stopped — only the steps above ran. Serverless cloud runs can perform just a few quick steps; for a multi-step coding task, assign a self-hosted agent (or a durable cloud runtime) and re-run, and it will run to completion.';

/** A self-hosted host run that lost its process/connection mid-run. */
export const HOST_ORPHAN_REASON =
  'Run did not report completion in time and was marked failed (orphaned run — the agent host stopped before writing a terminal status). Re-run the task.';
