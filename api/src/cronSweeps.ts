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

import { projectRegistry } from './application/kernel/registryProjection';
import { METRIC_ROLLUPS } from './application/kernel/rollupRegistry';
import { runRollups } from './application/kernel/metricRollup';
import { runVendorHealthCron } from './application/llm/vendorHealthCron';
import { runByoCredentialHealthCron } from './application/llm/byoCredentialHealthCron';
import { runRetentionPurge } from './application/maintenance/retentionPurge';
import { runBloatReclaim, runTableVacuum } from './application/maintenance/tableMaintenance';
import { runEvalDriftSweep } from './application/eval/runEvalDriftSweep';
import { runAlertSweep } from './application/alerts/runAlertSweep';
import { runValidatorReviewSweep } from './application/validation/validationDispatch';
import { demoAccountsEnabled, reseedDemoTenants } from './application/demo/demoSeedService';
import { runSecurityAuditSweep } from './application/security/securityDispatch';
import { runWebScanSweep } from './application/security/webSecurityScan';
import { runReleaseDigest } from './application/email/releaseDigest';
import { runDueTriggers } from './application/workflow/runDueTriggers';
import { processPendingCloudWorkflows } from './application/workflow/cloudExecutor';
import { runCampaignSendSweep } from './application/marketing/campaignEngine';
import { runAdInsightsSweep } from './application/advertising/adInsightsSync';
import { runLedgerSyncSweep } from './application/finance/ledgerSync';
import { runSocialCampaignSweep } from './application/social/socialCampaignService';
import { runMailboxAutomationSweep } from './application/mailbox/mailboxAutomationService';
import { runCustomDomainSweep } from './application/ide/customDomain';
import { runSsoDomainSweep } from './application/auth/enterpriseSso';
import { purgeExpiredPasskeyChallenges } from './application/auth/PasskeyService';
import { runHostedListingSweep } from './application/marketplace/creationListings.hostedSweep';
import { runJobAlertSweep } from './application/marketplace/jobAlerts';
import { reapStaleExecutions } from './application/runtime/staleExecutionReaper';
import { sweepIdlePreviews } from './application/runtime/previewSessions';
import { reconcileGithubActionsRuns } from './application/runtime/githubActionsReconcile';
import { runAgentWorkflowRefreshSweep } from './application/runtime/agentWorkflowRefresh';
import { runExecutionLifecycleOutboxSweep } from './application/runtime/executionLifecycleOutbox';
import { runApprovalExpirySweep } from './application/approvals/runApprovalExpirySweep';
import { runEscalationSweep } from './application/incident/runEscalationSweep';
import { runMonitorSweep } from './application/monitoring/runMonitorSweep';
import { runAutonomousExecutionSweep } from './application/runtime/autonomousExecutionSweep';
import { runManagerSweep } from './application/manager/runManagerSweep';
import { runWebhookRetrySweep } from './application/seams/webhookService';
import { runBoardSyncSweep } from './application/boardsync/runBoardSyncSweep';
import { runPrMergeSweep } from './application/repos/prMergeSweep';
import { runParkedWorkflowSweep } from './application/swimlane/resumeParkedWorkflows';
import { runQaExplorationSweep } from './application/qa/runQaExplorationSweep';
import { runRepoActivitySweep } from './application/contributors/runRepoActivitySweep';
import { runRepoDeliverySweep } from './application/repos/repoDelivery';
import { runPublisherDomainSweep } from './application/developer/domainVerification';
import { runDueReports } from './application/reports/runDueReports';
import { dueSnapshots } from './application/reports/lensSnapshots';
import { runDueCeremonies, runCeremonyReaper } from './application/ceremony/runDueCeremonies';
import { buildScheduledReport } from './presentation/routes/reportRoutes';
import { runPrReconciliationSweep } from './application/reconciliation/runPrReconciliationSweep';
import { cronSweepEnabled } from './application/runtime/cronControls';
import { runStakeholderDigestSweep, runStakeholderReminderSweep } from './application/stakeholderAlignment/StakeholderMapService';
import { runTriggerSweep } from './application/canvas/runTriggerSweep';
import { runSignatureReminderSweep } from './application/signature/runSignatureReminderSweep';
import { runFormReminderSweep } from './application/collection/formInvitations';
import { runCollectionsSweep } from './application/finance/collectionsLadder';
import { runSequenceSweep } from './application/sales/sequenceRunner';

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
    key: 'object-registry',
    cadence: 'daily',
    description:
      'Register the principal entities into the `objects` registry and write each ' +
      "seat's daily item/event counts as metric_facts (PRD 20 §2, §7).",
    run: async ({ env }) => {
      const r = await projectRegistry(env);
      return `registered=${r.registered} facts=${r.facts}${r.skipped.length ? ` skipped=${r.skipped.length}` : ''}`;
    },
  },
  {
    key: 'metric-rollups',
    cadence: 'daily',
    // Runs AFTER `object-registry` and that ordering is load-bearing twice over:
    // every seat's surface reads `<domain>.items` beside these keys, and every
    // ATTRIBUTED fact resolves its `object_id` against the registry that sweep
    // just refreshed. An ordering swap would leave the two halves of one panel a
    // day apart and every attribution pointing at yesterday's registry.
    description:
      'Compute the domain-specific series every seat charts — growth leads and conversions, '
      + 'delivery throughput, agent runs and spend, hiring, finance burn/MRR/runway, revenue, '
      + 'commerce, identity, people, platform, governance, investor, support, canvas and '
      + 'integrations — into metric_facts. The WRITER for the 45 keys DOMAIN_MANIFEST declares '
      + 'and that, for fourteen of the seventeen domains, nothing populated.',
    run: async ({ env }) => {
      const results = await runRollups(buildDatabase(env), METRIC_ROLLUPS);
      const facts = results.reduce((sum, r) => sum + r.facts, 0);
      const skipped = results.reduce((sum, r) => sum + r.skipped.length, 0);
      const extra = results.flatMap((r) => Object.entries(r.extra)).filter(([, n]) => n > 0);
      if (facts === 0 && !extra.length) return null;
      return [
        `facts=${facts}`,
        `domains=${results.filter((r) => r.facts > 0).length}/${results.length}`,
        ...extra.map(([name, n]) => `${name}=${n}`),
        skipped ? `skipped=${skipped}` : '',
      ].filter(Boolean).join(' ');
    },
  },
  {
    key: 'canvas-triggers',
    cadence: 'daily',
    // Runs AFTER `metric-rollups` deliberately: a `liveMetric` bound to `growth.leads`
    // or `finance.runway_months` is refreshed from the facts that pass writes, so
    // evaluating first would compare today's threshold against yesterday's number and
    // report a stale all-clear — the same ordering argument the rollups make against
    // `object-registry`.
    description:
      'Evaluate every saved canvas `trigger` — numeric thresholds against a liveMetric, and '
      + 'deadlines (contract renewals, invoice/bill due dates, statutory obligations, policy '
      + 'reviews, offer expiries) — and log the state TRANSITIONS. The half that makes a '
      + 'trigger fire without someone opening the board first.',
    run: async ({ env }) => {
      const r = await runTriggerSweep(env, buildDatabase(env));
      if (!r.changed && !r.skipped) return null;
      return [
        `boards=${r.boards}`, `evaluated=${r.evaluated}`, `changed=${r.changed}`,
        r.breached ? `breached=${r.breached}` : '',
        r.resolved ? `rearmed=${r.resolved}` : '',
        r.unbound ? `unbound=${r.unbound}` : '',
        r.skipped ? `skipped=${r.skipped}` : '',
      ].filter(Boolean).join(' ');
    },
  },
  {
    key: 'signature-reminders',
    cadence: 'daily',
    // The third of the three call sites the contract's `isTerminalPartyStatus`
    // documents, and the one that could not exist while the signature engine did
    // not. `declined` is terminal and is NOT completion, so a `!== 'pending'`
    // test here would chase somebody who has already refused.
    description:
      'Expire signature requests past their date, then nudge every party who still owes '
      + 'an answer on one that has gone quiet for longer than it declared. The half that '
      + 'makes an unsigned contract chase itself instead of waiting for somebody to open '
      + 'the board it is sitting on.',
    run: async ({ env }) => {
      const r = await runSignatureReminderSweep(env);
      return r.expired || r.reminded || r.failed
        ? `expired=${r.expired} reminded=${r.reminded}${r.failed ? ` failed=${r.failed}` : ''}`
        : null;
    },
  },
  {
    key: 'collections',
    cadence: 'daily',
    // The receivable half of the same job, and the half a company actually needs:
    // an unsigned contract costs an opportunity, an unpaid invoice costs cash.
    // `notify` is the DEFAULT mode, so on most workspaces this records the rung
    // that is due and tells the board rather than emailing a customer — see the
    // ladder's own note on why an unattended send to somebody else's customer is
    // the line `runTriggerSweep` also refuses to cross.
    description:
      'Climb one rung of the collections ladder on every overdue invoice, and rewrite '
      + '`ageingDays` on every canvas invoice card from its own due date. The rung is '
      + 'recorded before it is sent and the (tenant, invoice, step) index is unique, so '
      + 'a re-run cannot chase the same customer twice for the same rung.',
    run: async ({ env }) => {
      const r = await runCollectionsSweep(env, buildDatabase(env));
      return r.sent || r.queued || r.failed || r.aged
        ? `sent=${r.sent} queued=${r.queued} aged=${r.aged}${r.failed ? ` failed=${r.failed}` : ''}${r.skipped ? ` skipped=${r.skipped}` : ''}`
        : null;
    },
  },
  {
    key: 'form-reminders',
    cadence: 'daily',
    // The form half of the same job. It was logged as blocked on a roster that
    // does not exist yet, and that was wrong: for `namedRecipients`,
    // `form_recipients` IS the roster and `responded_at` is the answer, so "who
    // still owes us" is one predicate rather than a feature waiting on a feature.
    description:
      'Chase every named recipient of an open form who has not answered it, on the '
      + 'cadence the form declared. Each reminder RE-ISSUES the recipient credential '
      + 'so the message can carry a link that opens — only the hash is ever stored, so '
      + 'the old link is the price of a working one.',
    run: async ({ env }) => {
      const r = await runFormReminderSweep(env);
      return r.chased || r.reminded || r.failed
        ? `chased=${r.chased} reminded=${r.reminded}${r.failed ? ` failed=${r.failed}` : ''}`
        : null;
    },
  },
  {
    key: 'job-alerts',
    cadence: 'daily',
    // DAILY, not frequent, and that is a product decision rather than a cost one: a
    // standing job search is a digest ("here is what appeared since yesterday"), and
    // firing it every five minutes would turn one useful notification into a stream of
    // single-posting pings — the failure mode the batching in `jobAlertBody` exists to
    // avoid, reintroduced at the cadence layer.
    description:
      'Evaluate every enabled job alert (`saved_searches`, scope=listing) against the '
      + 'postings created since it last ran, and notify the seeker. The half that was '
      + 'missing: the alerts were stored and managed but nothing ever ran them, so '
      + '`last_run_at`/`result_count` were always null.',
    run: async ({ env }) => {
      const r = await runJobAlertSweep(env, buildDatabase(env));
      return r.matched > 0 || r.failed > 0
        ? `alerts=${r.evaluated} matched=${r.matched} notified=${r.notified}${r.failed ? ` failed=${r.failed}` : ''}`
        : null;
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
    key: 'db-vacuum',
    cadence: 'daily',
    // Registered AFTER `retention` and that ordering is load-bearing: a vacuum run
    // before the purge has nothing to reclaim and leaves the freed pages untracked
    // for a whole day. Deleting a row does not return its page to the OS — it only
    // becomes reusable once vacuumed — which is how manager_actions ended up holding
    // 46k live rows inside a 593 MB relation despite retention already being in force.
    description: 'VACUUM (ANALYZE) every retention-swept log table so the pages the purge freed are reused instead of the relation extending.',
    run: async ({ env }) => {
      const r = await runTableVacuum(env);
      return r.failed.length > 0 ? `vacuumed=${r.vacuumed.length} failed=${r.failed.length}` : null;
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
    key: 'stakeholder-digest',
    cadence: 'daily',
    description: 'Generate the stakeholder alignment digest for required approvers and informed parties.',
    run: async ({ env }) => {
      const result = await runStakeholderDigestSweep(buildDatabase(env));
      return result.distributed > 0 ? `projects=${result.projects} distributed=${result.distributed}` : null;
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
    key: 'db-reclaim',
    cadence: 'weekly-mon',
    // The one operation that actually SHRINKS a relation, and the reason the platform
    // no longer depends on an operator running `VACUUM (FULL, ANALYZE)` by hand to
    // stay under the Neon Free 512 MB ceiling. It takes an ACCESS EXCLUSIVE lock, so
    // it is bounded hard: one relation per run, worst absolute bloat first, and only
    // from the SWEPT_TABLES registry — every member of which is a diagnostic log with
    // a best-effort writer. Weekly because a rewrite is not something to do daily.
    description: 'Rewrite the worst-bloated log table with VACUUM (FULL, ANALYZE) when it is past both the size and bloat-ratio thresholds.',
    run: async ({ env }) => {
      const r = await runBloatReclaim(env);
      if (r.reclaimed.length === 0 && r.failed.length === 0) return null;
      const freed = r.reclaimed.reduce((sum, x) => sum + Math.max(0, x.beforeBytes - x.afterBytes), 0);
      return `eligible=${r.eligible.length} reclaimed=${r.reclaimed.map((x) => x.relation).join(',') || 'none'} freedMb=${Math.round(freed / 1048576)}${r.failed.length ? ` failed=${r.failed.length}` : ''}`;
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
      // `complete=false` means the run hit its per-invocation send ceiling and
      // left the audience part-mailed. It is a normal outcome for a large base,
      // not an error — the next invocation resumes at the persisted cursor — but
      // it must be visible, because the notes stay unstamped until it drains.
      return r.notes > 0
        ? `notes=${r.notes} sent=${r.sent} suppressed=${r.suppressed} failed=${r.failed} complete=${r.complete}`
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
    key: 'sequence-cadence',
    cadence: 'frequent',
    description:
      'Advance every running sales `sequence` by whatever step each enrolled person is due — '
      + 'email, social post, or a task card for the manual channels. Stops on reply.',
    run: async ({ env }) => {
      const r = await runSequenceSweep(env);
      return r.sent > 0 || r.failed > 0 || r.stopped > 0
        ? `sequences=${r.sequences} sent=${r.sent} stopped=${r.stopped} failed=${r.failed}`
        : null;
    },
  },
  {
    key: 'campaign-send',
    cadence: 'frequent',
    description: 'Advance every in-flight marketing campaign by one batch of recipients.',
    run: async ({ env }) => {
      const r = await runCampaignSendSweep(env, buildDatabase(env));
      return r.sent > 0 || r.failed > 0
        ? `campaigns=${r.campaigns} sent=${r.sent} failed=${r.failed}`
        : null;
    },
  },
  {
    key: 'social-publish',
    cadence: 'frequent',
    description: 'Publish due scheduled social campaigns, and advance any still mid-publish.',
    run: async ({ env }) => {
      const r = await runSocialCampaignSweep(env, buildDatabase(env));
      return r.published > 0 || r.failed > 0
        ? `campaigns=${r.campaigns} published=${r.published} failed=${r.failed}`
        : null;
    },
  },
  {
    key: 'ad-insights',
    cadence: 'daily',
    description: 'Pull campaigns and daily spend/result delivery from every connected ad network.',
    run: async ({ env }) => {
      const r = await runAdInsightsSweep(env, buildDatabase(env));
      return r.daysWritten > 0 || r.failed > 0
        ? `tenants=${r.tenants} accounts=${r.accounts} days=${r.daysWritten} failed=${r.failed}`
        : null;
    },
  },
  {
    key: 'ledger-sync',
    cadence: 'daily',
    // `metric-rollups` reads the rows this sweep writes, and the two are dispatched
    // CONCURRENTLY — `dispatchCronSweeps` gives each its own `waitUntil` — so this
    // is deliberately NOT relied on to land first. The consequence is bounded and
    // acceptable: a book synced after a rollup pass is picked up by the next one,
    // so a figure is at worst one cycle behind. What is not acceptable is a person
    // connecting their books and seeing nothing change until tomorrow, and that is
    // what `POST /api/ledger/sync` exists for — the same function, called on demand.
    //
    // DAILY rather than frequent, for the ad sweep's reasoning verbatim: a book
    // reports on a daily grain and restates for weeks, so a five-minute cadence
    // would re-read the same unchanged month ~288 times a day against a Neon budget
    // that has to stay under $5/month, for numbers that cannot have moved.
    description:
      'Pull transactions and account balances from every connected set of books — QuickBooks, '
      + 'Xero, NetSuite, a Plaid bank feed, Stripe revenue — into the `ledger_entries` rows and '
      + '`ledger_accounts` balances that `financeRollup` reads. The half that makes burn, cash '
      + 'and runway live over a company\'s actuals instead of over what somebody typed.',
    run: async ({ env }) => {
      const r = await runLedgerSyncSweep(env, buildDatabase(env));
      return r.written > 0 || r.removed > 0 || r.failed > 0
        ? `tenants=${r.tenants} books=${r.connections} written=${r.written} removed=${r.removed} failed=${r.failed}`
        : null;
    },
  },
  {
    key: 'mailbox-automation',
    cadence: 'frequent',
    description: 'Evaluate unread connected-mailbox messages against AI response rules.',
    dispatches: true,
    run: async ({ env, budget }) => {
      const result = await runMailboxAutomationSweep(env, buildDatabase(env), undefined, budget);
      return result.matched > 0 || result.failed > 0
        ? `rules=${result.rules} matched=${result.matched} drafted=${result.drafted} approvals=${result.approvals} sent=${result.sent} failed=${result.failed}`
        : null;
    },
  },
  {
    key: 'custom-domains',
    cadence: 'frequent',
    description: 'Re-check custom domains waiting on their DNS proof or certificate; activate the ready ones.',
    run: async ({ env }) => {
      const r = await runCustomDomainSweep(env, buildDatabase(env));
      return r.activated > 0 ? `checked=${r.checked} activated=${r.activated}` : null;
    },
  },
  {
    key: 'sso-domains',
    // Same cadence as `custom-domains`, and for the same reason: a TXT record is
    // published by somebody else's administrator at a moment we cannot predict,
    // and the claim is worthless to the customer until we notice it landed.
    cadence: 'frequent',
    description: 'Re-check unverified SSO domain claims for their DNS proof; verify the ones that published it.',
    run: async ({ env }) => {
      const r = await runSsoDomainSweep(buildDatabase(env));
      return r.verified > 0 ? `checked=${r.checked} verified=${r.verified}` : null;
    },
  },
  {
    key: 'passkey-challenges',
    // Frequent, because the rows expire in five minutes and the table is on the
    // sign-in path: an unclaimed challenge past its expiry can never be used
    // again, so keeping it only slows down the index the next assertion reads.
    // CONSUMED rows are deliberately not swept here — a burst of
    // consumed-then-failed challenges is evidence, and the purge only takes rows
    // whose expiry has passed.
    cadence: 'frequent',
    description: 'Drop expired WebAuthn challenges so the sign-in path reads a small table.',
    run: async ({ env }) => {
      const removed = await purgeExpiredPasskeyChallenges(buildDatabase(env));
      return removed > 0 ? `removed=${removed}` : null;
    },
  },
  {
    key: 'hosted-listings',
    // Daily, not frequent, and the cadence IS the promise: abandonment is defined in
    // DAYS (14 of grace, 30 more of read-only), so asking every five minutes would
    // buy nothing but outbound requests against other people's infrastructure. One
    // observation a day is enough to place the first dark day correctly, which is the
    // only precision any of the four states depends on.
    cadence: 'daily',
    description:
      'Ask every published hosted listing’s address whether it is still serving, so a '
      + 'subscriber’s grace → read-only → released clock starts when the app goes dark '
      + 'rather than when somebody happens to look.',
    run: async ({ env }) => {
      const r = await runHostedListingSweep(buildDatabase(env), env);
      // Quiet when everything is up, which is the normal day. A log line per healthy
      // sweep is how the one that matters gets scrolled past.
      return r.dark > 0 ? `probed=${r.probed} dark=${r.dark} suspended=${r.suspended}` : null;
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
    key: 'preview-eviction',
    cadence: 'frequent',
    description: 'Stop container instances held open by a live preview nobody is watching (tighter than the DO sleepAfter, which is sized for runs).',
    run: async ({ env }) => {
      const r = await sweepIdlePreviews(env);
      return r.evicted > 0 ? `evicted=${r.evicted}` : null;
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
    key: 'publisher-domains',
    cadence: 'frequent',
    description: 'Resolve outstanding publisher domain claims over DNS and promote the ones whose TXT record is live.',
    run: async ({ env }) => {
      const r = await runPublisherDomainSweep(env);
      return r.pending > 0 ? `pending=${r.pending} verified=${r.verified} errors=${r.errors}` : null;
    },
  },
  {
    key: 'repo-delivery',
    cadence: 'frequent',
    description: 'Probe every connected repo (GitHub / GitLab / Bitbucket) for its build verdict + open pulls, so the dashboard reads them without calling a provider.',
    run: async ({ env }) => {
      const r = await runRepoDeliverySweep(env);
      return r.probed > 0 || r.errors > 0 ? `due=${r.due} probed=${r.probed} errors=${r.errors}` : null;
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
    key: 'gh-agent-workflow-refresh',
    cadence: 'daily',
    description: 'Re-commit the current agent workflow to enabled repos still carrying an older revision, so their runs carry an execution id the reconcile sweep can attribute.',
    run: async ({ env }) => {
      const r = await runAgentWorkflowRefreshSweep(env);
      return r.checked > 0
        ? `checked=${r.checked} refreshed=${r.refreshed} skipped=${r.skipped} deferred=${r.deferred} dropped=${r.dropped}`
        : null;
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
    key: 'stakeholder-escalations',
    cadence: 'frequent',
    description: 'Emit 24-hour/4-hour stakeholder escalation reminders and record SLA breaches.',
    run: async ({ env }) => {
      const result = await runStakeholderReminderSweep(buildDatabase(env));
      return result.reminders > 0 ? `reminders=${result.reminders} breached=${result.breached}` : null;
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
    key: 'pr-merge',
    cadence: 'frequent',
    description: "Work each opted-in project's PR merge queue: update the head from its base, poll CI, merge, or retire it to a human.",
    // Conflict recovery hands a branch back to its ticket's agent, which starts a
    // billable cloud run — so this sweep draws from the shared per-tick tenant ceiling
    // and the operator control confirms before firing it.
    dispatches: true,
    // ── WHY THIS IS NOT PART OF THE MANAGER PASS ────────────────────────────────
    // It was, and it was 93% of the pass's measured wall-clock (project 11,
    // 2026-07-30: `pr: 28839ms` of a 30888ms pass), starving every stage behind it —
    // including the triage stage that owns every remedy. Merging is mechanical,
    // high-volume, provider-bound work whose cadence is set by PR volume, not by how
    // often a backlog is worth re-ranking. With its own key and its own budget the
    // manager pass cannot be starved by PR volume BY CONSTRUCTION rather than by a
    // tuned queue depth. See `application/repos/prMergeSweep.ts`.
    run: async ({ env, budget, controls }) => {
      // The SAME switch that pauses the manager's PR work and the reconciler owns this
      // sweep too — one control for "PR management is paused", not a third.
      if (!cronSweepEnabled(controls ?? {}, 'pr-ticket-reconciler')) return null;
      const r = await runPrMergeSweep(env, budget);
      return r.worked > 0
        ? `projects=${r.projects} worked=${r.worked} merged=${r.merged} dispatched=${r.dispatched} queued=${r.queued} retired=${r.retired} notReached=${r.notReached}`
        : null;
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
        buildScheduledReport(db, s.reportType, s.tenantId, s.segmentId ?? '', now, {
          subjectKind: s.subjectKind ?? null,
          subjectRef: s.subjectRef ?? null,
        }),
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
