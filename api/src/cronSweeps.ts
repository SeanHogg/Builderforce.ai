/**
 * CRON_SWEEPS — the platform's scheduled work, declared ONCE.
 *
 * Every sweep the `scheduled()` handler used to invoke through its own inline
 * `ctx.waitUntil(...)` branch is one entry here: its cadence, whether it can start
 * billable runs, and how to summarise what it did. Two callers consume this list
 * and neither can drift from the other:
 *
 *   • `scheduled()` (src/index.ts) — the real Cloudflare cron trigger. Selects by
 *     cadence and dispatches fire-and-forget.
 *   • `POST /api/admin/cron/:target` — the superadmin force-run, so a cron-path
 *     change can be verified in seconds instead of waiting out the KV gate's floor
 *     interval, and "is the scheduled sweep reaching this project?" has an answer
 *     inside the product.
 *
 * Lives at the composition root (beside index.ts / buildRuntimeService.ts) rather
 * than under application/ because one entry needs `buildScheduledReport` from the
 * presentation layer — wiring, not domain logic. The runner it feeds
 * (`application/runtime/cronSweepRunner.ts`) holds no imports of its own and is
 * where the invocation semantics (isolation, timeouts, logging) are tested.
 *
 * ADDING A SWEEP: append an entry with the right cadence. Nothing else changes —
 * the cron handler and the operator control both pick it up.
 */
import type { Env } from './env';
import { buildDatabase } from './infrastructure/database/connection';
import type { CronSweepDef } from './application/runtime/cronSweepRunner';

import { runVendorHealthCron } from './application/llm/vendorHealthCron';
import { runByoCredentialHealthCron } from './application/llm/byoCredentialHealthCron';
import { runRetentionPurge } from './application/maintenance/retentionPurge';
import { runEvalDriftSweep } from './application/eval/runEvalDriftSweep';
import { runAlertSweep } from './application/alerts/runAlertSweep';
import { runValidatorReviewSweep } from './application/validation/validationDispatch';
import { demoAccountsEnabled, reseedDemoTenants } from './application/demo/demoSeedService';
import { runSecurityAuditSweep } from './application/security/securityDispatch';
import { runWebScanSweep } from './application/security/webSecurityScan';
import { runReleaseDigest } from './application/email/releaseDigest';
import { runDueTriggers } from './application/workflow/runDueTriggers';
import { processPendingCloudWorkflows } from './application/workflow/cloudExecutor';
import { reapStaleExecutions } from './application/runtime/staleExecutionReaper';
import { reconcileGithubActionsRuns } from './application/runtime/githubActionsReconcile';
import { runExecutionLifecycleOutboxSweep } from './application/runtime/executionLifecycleOutbox';
import { runApprovalExpirySweep } from './application/approvals/runApprovalExpirySweep';
import { runEscalationSweep } from './application/incident/runEscalationSweep';
import { runMonitorSweep } from './application/monitoring/runMonitorSweep';
import { runAutonomousExecutionSweep } from './application/runtime/autonomousExecutionSweep';
import { runManagerSweep } from './application/manager/runManagerSweep';
import { runWebhookRetrySweep } from './application/seams/webhookService';
import { runBoardSyncSweep } from './application/boardsync/runBoardSyncSweep';
import { runParkedWorkflowSweep } from './application/swimlane/resumeParkedWorkflows';
import { runQaExplorationSweep } from './application/qa/runQaExplorationSweep';
import { runRepoActivitySweep } from './application/contributors/runRepoActivitySweep';
import { runDueReports } from './application/reports/runDueReports';
import { dueSnapshots } from './application/reports/lensSnapshots';
import { runDueCeremonies, runCeremonyReaper } from './application/ceremony/runDueCeremonies';
import { buildScheduledReport } from './presentation/routes/reportRoutes';
import { runPrReconciliationSweep } from './application/reconciliation/runPrReconciliationSweep';
import { cronSweepEnabled } from './application/runtime/cronControls';

/**
 * `null` from a sweep's `run` = nothing worth a log line. Preserved verbatim from
 * the old inline branches: the quiet sweeps (retention, triggers, reaper) logged
 * only on failure, and the loud ones only when they actually did something.
 */
export const CRON_SWEEPS: readonly CronSweepDef[] = [
  // ---------------------------------------------------------------------------
  // Daily — `0 9 * * *`
  // ---------------------------------------------------------------------------
  {
    key: 'llm-health',
    cadence: 'daily',
    description: 'Probe every LLM vendor and email operators on a change in status.',
    run: async ({ env }) => {
      const r = await runVendorHealthCron(env);
      return r.changes.length > 0 ? `changes=${r.changes.length} emailed=${r.emailed}` : null;
    },
  },
  {
    key: 'retention',
    cadence: 'daily',
    description: 'Purge the unbounded diagnostic/telemetry log tables past their retention window.',
    run: async ({ env }) => {
      await runRetentionPurge(env);
      return null;
    },
  },
  {
    key: 'byo-health',
    cadence: 'daily',
    description: "Probe each tenant's connected model providers on their own credential; email admins on breakage.",
    run: async ({ env }) => {
      const r = await runByoCredentialHealthCron(env);
      return r.newlyBroken > 0 || r.recovered > 0
        ? `newlyBroken=${r.newlyBroken} recovered=${r.recovered} emailed=${r.emailed}`
        : null;
    },
  },
  {
    key: 'eval-drift',
    cadence: 'daily',
    description: 'Flag per-(action, model) quality regressions over persisted eval scores.',
    run: async ({ env }) => {
      await runEvalDriftSweep(env);
      return null;
    },
  },
  {
    key: 'alerts',
    cadence: 'daily',
    description: 'Evaluate every enabled threshold-alert rule and fire the ones that trip.',
    run: async ({ env }) => {
      await runAlertSweep(env);
      return null;
    },
  },
  {
    key: 'validator',
    cadence: 'daily',
    description: "Re-review each tenant's Done items against the codebase; gaps become GAP tasks.",
    dispatches: true,
    run: async ({ env }) => {
      const r = await runValidatorReviewSweep(env);
      return r.dispatched > 0
        ? `tenantsWithValidator=${r.tenantsWithValidator} dispatched=${r.dispatched}`
        : null;
    },
  },
  {
    key: 'demo-reseed',
    cadence: 'daily',
    description: 'Reseed the demo tenants so a visitor-mutated demo never stays dirty.',
    available: (env: Env) => demoAccountsEnabled(env),
    run: async ({ env }) => {
      const r = await reseedDemoTenants(env);
      return `personas=${r.personas.length}`;
    },
  },

  // ---------------------------------------------------------------------------
  // Weekly Monday — `0 8 * * 1`
  // ---------------------------------------------------------------------------
  {
    key: 'security',
    cadence: 'weekly-mon',
    description: 'Dispatch a SOC 2 audit per tenant that has a Security agent; findings become restricted tasks.',
    dispatches: true,
    run: async ({ env }) => {
      const r = await runSecurityAuditSweep(env);
      return r.dispatched > 0
        ? `tenantsWithSecurityAgent=${r.tenantsWithSecurityAgent} dispatched=${r.dispatched}`
        : null;
    },
  },
  {
    key: 'webscan',
    cadence: 'weekly-mon',
    description: 'Re-scan every project with a website target so posture drift is caught unprompted.',
    run: async ({ env }) => {
      const r = await runWebScanSweep(env);
      return r.scanned > 0 || r.skippedOverCap > 0
        ? `projectsWithTarget=${r.projectsWithTarget} scanned=${r.scanned} findingsFiled=${r.findingsFiled} skippedOverCap=${r.skippedOverCap}`
        : null;
    },
  },

  // ---------------------------------------------------------------------------
  // Weekly Friday — `0 16 * * 5`
  // ---------------------------------------------------------------------------
  {
    key: 'release-digest',
    cadence: 'weekly-fri',
    description: 'Mail every published release note not yet sent to consenting users.',
    run: async ({ env }) => {
      const r = await runReleaseDigest(env);
      return r.notes > 0
        ? `notes=${r.notes} sent=${r.sent} suppressed=${r.suppressed} failed=${r.failed}`
        : null;
    },
  },

  // ---------------------------------------------------------------------------
  // Frequent — the every-5-minute tick. KV work-gated in scheduled(); a forced
  // run bypasses that gate deliberately (see the admin route).
  // ---------------------------------------------------------------------------
  {
    key: 'pr-ticket-reconciler',
    cadence: 'frequent',
    description: 'Continuously reconcile open GitHub PRs against BuilderForce tickets; route active work and close only high-confidence stale PRs.',
    run: async ({ env }) => {
      const r = await runPrReconciliationSweep(env);
      return r.due > 0 || r.failed > 0
        ? `due=${r.due} completed=${r.completed} failed=${r.failed} prs=${r.prs} findings=${r.findings}`
        : null;
    },
  },
  {
    key: 'wf-triggers',
    cadence: 'frequent',
    description: 'Fire due schedule/rss workflow triggers, then advance pending cloud workflows.',
    run: async ({ env }) => {
      await runDueTriggers(env);
      await processPendingCloudWorkflows(env);
      return null;
    },
  },
  {
    key: 'exec-events',
    cadence: 'frequent',
    description: 'Project durable execution lifecycle outbox events into each tenant audit log.',
    run: async ({ env }) => {
      const r = await runExecutionLifecycleOutboxSweep(env);
      return r.projected > 0 || r.retried > 0 || r.dead > 0
        ? `projected=${r.projected} retried=${r.retried} dead=${r.dead}`
        : null;
    },
  },
  {
    key: 'exec-reaper',
    cadence: 'frequent',
    description: 'Fail executions stranded in running/pending by a crashed host or dropped dispatch.',
    run: async ({ env }) => {
      await reapStaleExecutions(env);
      return null;
    },
  },
  {
    key: 'gh-actions-reconcile',
    cadence: 'frequent',
    description: 'Ask GitHub whether dispatched runs exist; fail the ones it never scheduled with the real cause.',
    run: async ({ env }) => {
      const r = await reconcileGithubActionsRuns(env);
      return r.failed > 0 ? `checked=${r.checked} failed=${r.failed} stillQueued=${r.stillQueued}` : null;
    },
  },
  {
    key: 'approval-expiry',
    cadence: 'frequent',
    description: 'Expire pending approvals past their deadline and escalate.',
    run: async ({ env }) => {
      const r = await runApprovalExpirySweep(env, buildDatabase(env));
      return r.escalated > 0 ? `escalated=${r.escalated} tenants=${r.tenants}` : null;
    },
  },
  {
    key: 'escalation',
    cadence: 'frequent',
    description: 'Page the next on-call tier for every unacknowledged incident whose timer elapsed.',
    run: async ({ env }) => {
      const r = await runEscalationSweep(env);
      return r.escalated > 0 ? `open=${r.openIncidents} escalated=${r.escalated}` : null;
    },
  },
  {
    key: 'monitors',
    cadence: 'frequent',
    description: 'Evaluate heartbeat/http/metric monitors; a breach opens an incident and pages on-call.',
    run: async ({ env }) => {
      const r = await runMonitorSweep(env);
      return r.breached > 0 || r.recovered > 0
        ? `evaluated=${r.evaluated} breached=${r.breached} recovered=${r.recovered}`
        : null;
    },
  },
  {
    key: 'auto-exec',
    cadence: 'frequent',
    description: 'Start every agent-owned non-terminal ticket that has no live run (token-gated).',
    dispatches: true,
    run: async ({ env, budget }) => {
      const r = await runAutonomousExecutionSweep(env, budget);
      return r.dispatched > 0 || r.tokenBlockedTenants > 0
        ? `dispatched=${r.dispatched} candidates=${r.candidates} tokenBlockedTenants=${r.tokenBlockedTenants} pendingUnderBlocked=${r.pendingUnderBlockedTenants} upgradeEmails=${r.upgradeEmailsSent}`
        : null;
    },
  },
  {
    key: 'manager',
    cadence: 'frequent',
    description: 'AI Manager pass: score + rank the backlog, assign unowned work, conduct PRs.',
    dispatches: true,
    run: async ({ env, budget, controls }) => {
      const r = await runManagerSweep(env, budget, {
        // One switch owns PR management across both paths. Core manager work
        // continues while the reconciler and the manager's PR stages are paused.
        prManagementEnabled: cronSweepEnabled(controls ?? {}, 'pr-ticket-reconciler'),
      });
      return r.managed > 0
        ? `projects=${r.projects} managed=${r.managed} notReached=${r.notReached} scored=${r.scored} ranked=${r.ranked} assigned=${r.assigned} prsConducted=${r.prsConducted} prsMerged=${r.prsMerged} dispatched=${r.dispatched} remediated=${r.remediated} remediationDeferred=${r.remediationDeferred} tokenBlocked=${r.tokenBlockedTenants}`
        : null;
    },
  },
  {
    key: 'webhook-retry',
    cadence: 'frequent',
    description: 'Redeliver failed outbound webhook deliveries with capped exponential backoff.',
    run: async ({ env }) => {
      const redelivered = await runWebhookRetrySweep(env);
      return redelivered > 0 ? `redelivered=${redelivered}` : null;
    },
  },
  {
    key: 'board-sync',
    cadence: 'frequent',
    description: 'Poll due external board connections and drain their reverse-sync outbox.',
    run: async ({ env }) => {
      await runBoardSyncSweep(env);
      return null;
    },
  },
  {
    key: 'wf-gate',
    cadence: 'frequent',
    description: 'Resume tickets parked on a run_workflow lane action whose workflow has settled.',
    run: async ({ env }) => {
      await runParkedWorkflowSweep(env);
      return null;
    },
  },
  {
    key: 'qa-sweep',
    cadence: 'frequent',
    description: 'Enqueue a heatmap-derived exploration for every due QA schedule.',
    dispatches: true,
    run: async ({ env }) => {
      const r = await runQaExplorationSweep(env);
      return r.enqueued > 0 ? `enqueued=${r.enqueued} rearmed=${r.rearmed}` : null;
    },
  },
  {
    key: 'repo-activity',
    cadence: 'frequent',
    description: "Poll each connected repo's commits / PRs / reviews into activity_events.",
    run: async ({ env }) => {
      const r = await runRepoActivitySweep(env);
      return r.due > 0 || r.errors > 0
        ? `due=${r.due} synced=${r.synced} inserted=${r.inserted} errors=${r.errors}`
        : null;
    },
  },
  {
    key: 'reports',
    cadence: 'frequent',
    description: 'Generate + email every due report schedule, advancing its next run.',
    run: async ({ env }) => {
      const r = await runDueReports(env, (db, s, now) =>
        buildScheduledReport(db, s.reportType, s.tenantId, s.segmentId ?? '', now),
      );
      return r.processed > 0 ? `processed=${r.processed}` : null;
    },
  },
  {
    key: 'lens-snapshots',
    cadence: 'frequent',
    description: 'Capture the rolling month/quarter/year lens snapshots per tenant.',
    run: async ({ env }) => {
      const r = await dueSnapshots(env);
      return r.captured > 0 ? `captured=${r.captured}` : null;
    },
  },
  {
    key: 'ceremonies',
    cadence: 'frequent',
    description: 'Open a session for every due ceremony schedule and re-arm its cron.',
    run: async ({ env }) => {
      const r = await runDueCeremonies(env);
      return r.opened > 0 || r.errors > 0
        ? `due=${r.due} opened=${r.opened} skipped=${r.skipped} errors=${r.errors}`
        : null;
    },
  },
  {
    key: 'ceremonies-reap',
    cadence: 'frequent',
    description: 'Close ceremony sessions nobody closed — one live session per board+kind blocks the next.',
    run: async ({ env }) => {
      const r = await runCeremonyReaper(env, buildDatabase(env));
      return r.due > 0
        ? `due=${r.due} completed=${r.completed} abandoned=${r.abandoned} errors=${r.errors}`
        : null;
    },
  },
];
