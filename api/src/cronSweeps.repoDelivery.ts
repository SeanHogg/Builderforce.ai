/**
 * The repo + pull-request delivery sweeps of CRON_SWEEPS — one concern, declared here.
 *
 * Everything that keeps a connected repository's delivery state current and moves its
 * pull requests along: probing build verdicts and activity, reconciling dispatched
 * GitHub Actions runs, reconciling PRs against tickets, settling orphaned drafts, and
 * conducting / merging the PR queue (plus the merge-on-green security catch-up).
 *
 * Spread into `CRON_SWEEPS` (cronSweeps.ts), which stays the one registry both the
 * `scheduled()` handler and the superadmin force-run read. Position means nothing —
 * sweeps run concurrently; see the ORDER note in cronSweeps.ts.
 *
 * ONE PAUSE SWITCH: 'pr-merge' and 'pr-conduct' both honour the 'pr-ticket-reconciler'
 * operator control, so "PR management is paused" is one control, not three.
 */
import type { CronSweepDef } from './application/runtime/cronSweepRunner';
import { cronSweepEnabled } from './application/runtime/cronControls';
import { runPrReconciliationSweep } from './application/reconciliation/runPrReconciliationSweep';
import { runRepoDeliverySweep } from './application/repos/repoDeliverySweep';
import { runGithubActionsReconcile } from './buildGithubActionsReconcile';
import { runAgentWorkflowRefreshSweep } from './application/runtime/agentWorkflowRefresh';
import { sweepOrphanedDraftPullRequests } from './application/repos/sweepOrphanedDraftPrs';
import { runPrMergeSweep } from './application/repos/prMergeSweep';
import { runPrConductSweep } from './application/repos/prConductSweep';
import { runRepoActivitySweep } from './application/contributors/runRepoActivitySweep';
import { runSecurityVerdictCatchup } from './application/security/securityVerdictCatchup';

export const REPO_DELIVERY_SWEEPS: readonly CronSweepDef[] = [
  {
    key: 'pr-ticket-reconciler',
    cadence: 'frequent',
    description: 'Continuously reconcile open GitHub PRs against BuilderForce tickets; route active work and close only high-confidence stale PRs.',
    run: async ({ env, db }) => {
      const r = await runPrReconciliationSweep(env, db);
      return r.due > 0 || r.failed > 0
        ? `due=${r.due} completed=${r.completed} failed=${r.failed} prs=${r.prs} findings=${r.findings}`
        : null;
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
    run: async ({ env, db }) => {
      const r = await runGithubActionsReconcile(env, Date.now(), db);
      return r.failed > 0 ? `checked=${r.checked} failed=${r.failed} stillQueued=${r.stillQueued}` : null;
    },
  },
  {
    key: 'gh-agent-workflow-refresh',
    cadence: 'daily',
    description: 'Re-commit the current agent workflow to enabled repos still carrying an older revision, so their runs carry an execution id the reconcile sweep can attribute.',
    run: async ({ env, db }) => {
      const r = await runAgentWorkflowRefreshSweep(env, Date.now(), db);
      return r.checked > 0
        ? `checked=${r.checked} refreshed=${r.refreshed} skipped=${r.skipped} deferred=${r.deferred} dropped=${r.dropped}`
        : null;
    },
  },
  {
    key: 'orphaned-draft-prs',
    cadence: 'frequent',
    description: 'Settle the early draft PR of a run that never reached its finalize, judged by the run that opened it: mark it ready when that run succeeded and left commits, close it when the run failed or was cancelled or left nothing. A draft with a live run on the ticket is never touched.',
    run: async ({ env, db }) => {
      const r = await sweepOrphanedDraftPullRequests(env, db);
      return r.readied + r.closed > 0 ? `checked=${r.checked} readied=${r.readied} closed=${r.closed} skipped=${r.skipped}` : null;
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
    key: 'pr-conduct',
    cadence: 'frequent',
    description: "Conduct each opted-in project's review tickets: return unfinished work, ask for outstanding sign-offs, or complete and open the PR.",
    // Returning a ticket restarts its agent and a sign-off ask starts a reviewer run —
    // both billable — so this sweep draws from the shared per-tick tenant ceiling.
    dispatches: true,
    // The last PR work that lived inside the manager pass; split out beside 'pr-merge' for
    // the same reason (its own budget, so review volume cannot starve the pass). See
    // `application/repos/prConductSweep.ts`.
    run: async ({ env, budget, controls }) => {
      // The SAME switch that pauses 'pr-merge' and the reconciler: one control for
      // "PR management is paused".
      if (!cronSweepEnabled(controls ?? {}, 'pr-ticket-reconciler')) return null;
      const r = await runPrConductSweep(env, budget);
      return r.worked > 0
        ? `projects=${r.projects} worked=${r.worked} considered=${r.considered} conducted=${r.conducted} dispatched=${r.dispatched} notReached=${r.notReached}`
        : null;
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
    key: 'security-verdict-catchup',
    cadence: 'frequent',
    description: 'Safety net for merge-on-green: scan open green PRs whose latest head has no complete security verdict, then merge those CI is green on.',
    dispatches: false,
    run: async ({ env, db }) => {
      const r = await runSecurityVerdictCatchup(env, db);
      return r.considered > 0 ? `considered=${r.considered} merged=${r.merged}${r.stoppedForBudget ? ' budget-stopped' : ''}` : null;
    },
  },
];
