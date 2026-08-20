/**
 * prMergeSweep — the PR merge loop as its OWN registry sweep.
 *
 * ── WHY IT LEFT THE MANAGER PASS ─────────────────────────────────────────────────
 * It used to be stage 4b of `runManagerForProject`, and the first pass that timed its
 * own stages said what that cost (project 11, 2026-07-30, api 2026.7.184):
 *
 *   stageMs {load:468, board_staffing:427, census:1154, pr:28839, …}  elapsed 30888
 *   stageMs {load:579, board_staffing:435, census:878,  pr:18982, …}  elapsed 20874
 *
 * 93% of a 20s pass, with everything else together under two seconds. The merge queue
 * (`manager/prMergeQueue.ts`) later bounded it to ~4s, which stopped the bleeding — but
 * the SHAPE was still wrong. This is mechanical, high-volume, provider-bound work: its
 * natural cadence is set by PR volume and provider latency, and has nothing whatever to
 * do with how often a backlog is worth re-ranking or a stall worth re-triaging. Leaving
 * it inside a judgement pass means the pass's budget is spent on whatever the provider
 * happens to cost that tick, and the guarantee that triage still runs is a tuned depth
 * (`MERGE_QUEUE_DEPTH`) rather than a structural fact.
 *
 * As its own sweep beside `runBoardSyncSweep` it has its OWN budget, so the manager pass
 * cannot be starved by PR volume BY CONSTRUCTION. The pass still REPORTS what landed —
 * it reads `countPrMergesSince` from the journal this sweep writes — but it no longer
 * does the work to be able to say it.
 *
 * ── WHAT DID NOT CHANGE, DELIBERATELY ────────────────────────────────────────────
 * Every invariant the queue was introduced for is carried over verbatim: the window is
 * oldest-first and STABLE, `MERGE_QUEUE_DEPTH` stays at ONE (only the head can merge, so
 * a deeper window buys provider round-trips against branches that go stale the instant
 * the head lands — the O(N²) of 349 conflicts against 2 merges), the three ceilings and
 * the `merge_blocked` dedupe still come from ONE grouped scan of `manager_actions`, and
 * the sign-off gate + `allowAutoMerge` authority are still both re-checked at the merge
 * itself. A faster cadence for this loop is NOT the point of moving it; not starving the
 * manager is.
 *
 * ── THE OPT-IN IS UNCHANGED TOO ──────────────────────────────────────────────────
 * Merging is manager AUTHORITY, so the sweep selects exactly the projects the manager
 * sweep does: an enabled `project_manager_configs` row of the project's own (an INNER
 * join, so the requirement is structural), plus at least one open pull request. A project
 * that never asked for a manager does not get its branches merged by one, and
 * `policy.prMergePolicy === 'queue'` / `policy.allowAutoMerge === false` still decide
 * whether anything is merged at all.
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { managerActions, projectManagerConfigs, pullRequests, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus } from '../../domain/shared/types';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  recordManagerAction, MERGE_BLOCKED_ACTION, MERGE_FAILED_ACTION, PR_CONFLICT_ACTION,
  PR_ACTION_TYPES,
} from '../manager/managerActionJournal';
import { getEffectiveManagerPolicy } from '../manager/managerPolicyStore';
import { planMergeQueue, summarizeMergeQueue } from '../manager/prMergeQueue';
import { MAX_REMEDY_ATTEMPTS } from '../manager/stallTriage';
import { createPassBudget, MIN_DISPATCH_WINDOW_MS, type PassBudget } from '../manager/passBudget';
import { resolveRequiredSignoffGate } from '../kanban/signoffGate';
import { mergeRecordedPullRequest, updateRecordedPullRequestBranch } from './mergeRecordedPr';
import { pollPrCiStatus } from './pollPrCiStatus';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { runBoundedPool } from '../runtime/boundedPool';
import {
  createTickDispatchBudget, tenantDispatchReserver,
  type DispatchReserver, type TickDispatchBudget,
} from '../runtime/tickDispatchBudget';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { EffectiveManagerPolicy } from '../manager/managerPolicy';
import type { Env } from '../../env';

/**
 * Wall-clock ONE project's merge queue may spend.
 *
 * The queue bounds a project to its single integration head, measured at ~4s including
 * the provider round-trips (update-branch, CI poll, merge). 8s is that with room for one
 * slow provider call, and no more: past it the head is left where it is and picked up on
 * the next tick, which costs at most one cadence rather than the whole sweep.
 *
 * This is a PROJECT budget, not the sweep's — the point of the extraction is that no
 * single project's PR volume can consume the tick.
 */
export const PR_MERGE_PROJECT_BUDGET_MS = 8_000;

/**
 * Wall-clock after which the sweep stops STARTING new projects.
 *
 * The frequent tick fires every 5 minutes, so running long saves nothing and risks
 * eviction partway through a merge. Stopping between projects is free: a project not
 * reached this tick is reported (`notReached`) and reached on the next one, and nothing
 * is half-applied because the deadline is checked before a project is claimed.
 */
export const PR_MERGE_SWEEP_BUDGET_MS = 45_000;

/** Projects one tick may work; a larger fleet paces across ticks. */
export const MAX_PROJECTS_PER_TICK = 200;

/**
 * Project merge queues worked AT ONCE.
 *
 * A queue is almost entirely I/O (Postgres round-trips and provider API calls), so this
 * is real parallelism rather than CPU contention. Bounded because neon-http opens a
 * connection per query, and an unbounded fan-out over 200 projects would replace a
 * starved sweep with a throttled database. Six, matching the manager sweep's pool: the
 * two run on the same tick against the same endpoint.
 */
export const MAX_CONCURRENT_PROJECT_QUEUES = 6;

/**
 * Open PRs one project's queue may EXAMINE per tick.
 *
 * Not the number it may WORK — that is `MERGE_QUEUE_DEPTH`, which is one. This is the
 * window the ordering and the ceilings are computed over, and it is bounded because the
 * grouped `manager_actions` scan behind it is paid for on every tick. Twenty is what the
 * loop has always used; it is carried over unchanged so the queue's measured behaviour
 * carries over with it.
 */
export const PR_MERGE_WINDOW = 20;

/** What one project's queue did this tick. `queue` is the disposition breakdown. */
export interface PrMergeProjectResult {
  merged: number;
  dispatched: number;
  queue: ReturnType<typeof summarizeMergeQueue> | null;
  /** True when the project budget stopped the queue before the window was exhausted. */
  truncated: boolean;
}

export interface PrMergeSweepResult {
  /** Projects selected (opted in, with at least one open PR). */
  projects: number;
  /** Projects whose queue actually ran. */
  worked: number;
  merged: number;
  /** Conflict-resolution runs started (billable — drawn from the tick budget). */
  dispatched: number;
  /** PRs held behind the head this tick — the queue holding, not a failure. */
  queued: number;
  /** PRs retired to a human this tick (a spent ceiling) — the queue DRAINING. */
  retired: number;
  /** Projects never started because {@link PR_MERGE_SWEEP_BUDGET_MS} elapsed. */
  notReached: number;
}

interface QueueProject { projectId: number; tenantId: number; }

/**
 * The ticket fields a conflict recovery needs, loaded for the ONE head PR that is
 * actually conflicting.
 *
 * Bounded, not an N+1: `MERGE_QUEUE_DEPTH` is one, so at most one PR per project per
 * tick reaches this, and only on the conflict path. The pass used to find this row in
 * the 300-ticket `managed` window it already held — a window this sweep has no reason to
 * load, and could not rely on anyway (`pull_requests.task_id` can point outside it).
 */
async function loadRecoveryTask(
  db: Db, tenantId: number, taskId: number,
): Promise<{ id: number; description: string | null; assignedAgentRef: string | null; assignedAgentHostId: number | null } | null> {
  const [row] = await db
    .select({
      id: tasks.id, description: tasks.description,
      assignedAgentRef: tasks.assignedAgentRef, assignedAgentHostId: tasks.assignedAgentHostId,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
    .limit(1);
  return row ?? null;
}

/**
 * Projects with an ENABLED manager config of their own AND at least one open pull
 * request.
 *
 * ── ORDERED BY THE OLDEST OPEN PR, NOT BY A ROTATION CURSOR ──────────────────────
 * The manager sweep rotates on `project_manager_configs.last_run_at`, which is the
 * MANAGER's stamp; reading it here would couple two independent cadences and let a
 * project that the manager reached this tick jump the merge queue. Oldest-open-PR-first
 * is the same thesis the queue itself runs on one branch further down: the project whose
 * head has been waiting longest goes first, the order is total (`projects.id` breaks
 * ties), and it is STABLE — the same project is at the front next tick, so its head
 * accumulates the attempts its ceiling needs instead of being diluted by fairness.
 *
 * Starvation of the tail is bounded by the pool rather than by the order: six queues at
 * ~4s each inside a 45s budget reaches ~60 projects a tick, and a project not reached is
 * reported rather than silently dropped.
 */
export async function loadPrQueueProjects(db: Db, limit: number): Promise<QueueProject[]> {
  const rows = await db
    .select({
      projectId: pullRequests.projectId,
      tenantId: pullRequests.tenantId,
      oldestOpenPrAt: sql<Date>`min(${pullRequests.createdAt})`.as('oldest_open_pr_at'),
    })
    .from(pullRequests)
    .innerJoin(projectManagerConfigs, and(
      eq(projectManagerConfigs.projectId, pullRequests.projectId),
      // Correlated on the tenant as well as the project: `project_manager_configs` is
      // tenant-owned, and a join on `project_id` alone is the shape that leaks rows
      // across tenants the moment ids collide.
      eq(projectManagerConfigs.tenantId, pullRequests.tenantId),
      eq(projectManagerConfigs.enabled, true),
    ))
    .where(and(
      eq(pullRequests.status, 'open'),
      isNotNull(pullRequests.projectId),
      // An unlinked provider PR is visible to reconciliation but cannot bring a project
      // into the sweep — it can never enter the queue below either (same predicate).
      isNotNull(pullRequests.taskId),
    ))
    .groupBy(pullRequests.projectId, pullRequests.tenantId)
    .orderBy(sql`min(${pullRequests.createdAt}) asc`, asc(pullRequests.projectId))
    .limit(limit);
  return rows.flatMap((r) => (r.projectId == null ? [] : [{ projectId: r.projectId, tenantId: r.tenantId }]));
}

/**
 * Work ONE project's merge queue to the head's conclusion, within its own budget.
 *
 * Exported so the operator force-run and the tests can drive a single project without
 * going through project selection — the same arrangement `runManagerForProject` has.
 */
export async function runPrMergeForProject(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: {
    tenantId: number;
    projectId: number;
    policy: EffectiveManagerPolicy;
    /** The tenant's shared per-tick RUN ceiling. Every billable start reserves first. */
    runs: DispatchReserver;
    /** Defaults to a fresh {@link PR_MERGE_PROJECT_BUDGET_MS} budget. */
    budget?: PassBudget;
  },
): Promise<PrMergeProjectResult> {
  const { tenantId, projectId, policy, runs } = ctx;
  const budget = ctx.budget ?? createPassBudget(Date.now(), PR_MERGE_PROJECT_BUDGET_MS, 0);
  const result: PrMergeProjectResult = { merged: 0, dispatched: 0, queue: null, truncated: false };
  // No manager "backlog management pass" card owns this work any more — it is its own
  // sweep — so its journal rows are unparented. The column is nullable for exactly this.
  const runTaskId: number | null = null;
  await runPrMergeQueueBody(env, db, runtimeService, { tenantId, projectId, policy, runs, budget, runTaskId, out: result });
  result.truncated = budget.truncated.includes('pr_merge');
  return result;
}

/**
 * The loop itself — moved verbatim from `ManagerService.coordinatePullRequests`'s merge
 * half, so every comment below is the measurement that shaped it. Kept as its own
 * function purely so the wrapper above owns the budget/result plumbing.
 */
async function runPrMergeQueueBody(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: {
    tenantId: number; projectId: number; policy: EffectiveManagerPolicy;
    runs: DispatchReserver; budget: PassBudget; runTaskId: number | null;
    out: PrMergeProjectResult;
  },
): Promise<void> {
  const { tenantId, projectId, policy, runs, budget, runTaskId, out } = args;
  // MERGE + CLOSE open PRs per policy.
  if (policy.prMergePolicy === 'queue') return;
  // ── WHO GETS A TURN, AND IN WHAT ORDER ──────────────────────────────────────────
  //
  // This query used to be an UNORDERED `limit(20)` over every open PR on the project.
  // With 386 of them (project 11, measured 2026-07-28) an unordered LIMIT returns
  // whatever the heap scan yields first, which in practice is the same twenty rows every
  // pass — so 366 PRs were never examined once, on any pass, ever.
  //
  // The fix is LEAST-RECENTLY-WORKED FIRST. One grouped scan of the manager's own PR
  // actions gives, per ticket, when this loop last did anything to it — never-touched
  // PRs sort first (NULL), then longest-since-touched. Every open PR therefore reaches
  // the window within ceil(386/20) ≈ 20 passes instead of never, and a PR the manager
  // keeps re-handling naturally sinks behind the ones it has been ignoring.
  //
  // The SAME scan carries the ceilings this loop enforces (syncs, failed merges,
  // unrecoverable conflicts) and the merge_blocked dedupe, which were previously THREE
  // separate grouped queries over the same table on every pass. It is index-backed by
  // `idx_manager_actions_pr_scope (tenant_id, project_id, action_type, pr_id)` — 0383
  // added it, because `manager_actions` grows by ~3.5k rows a day on one project and the
  // prior queries were sequential scans on a five-minute path.
  //
  // KEYED ON THE PULL REQUEST, NOT ITS TICKET (0383). 0381 grouped by `task_id` and
  // joined it to `pull_requests.task_id`, which is NULLABLE — so an orphan PR's own
  // journalled actions could never be counted back to it (`NULL = NULL` is never true in
  // a join), every `pr.taskId != null &&` guard below skipped it, and its NULL
  // `last_acted_at` pinned it to the front of a NULLS-FIRST rotation on every pass.
  // Measured on project 11, 2026-07-29: "Could not merge PR #29 … not mergeable" written
  // with `{"attempt":1,"maxAttempts":3}` six times in thirty minutes, attempt 1 every
  // time, while 381 open PRs queued behind it. The PR is also the right key on its own
  // terms — a replacement PR must not inherit a retired one's refusals.
  const prActivity = db
    .select({
      prId: managerActions.prId,
      syncs: sql<number>`count(*) filter (where ${managerActions.actionType} = 'sync_pr')::int`.as('syncs'),
      mergeFailures: sql<number>`count(*) filter (where ${managerActions.actionType} = ${MERGE_FAILED_ACTION})::int`.as('merge_failures'),
      conflicts: sql<number>`count(*) filter (where ${managerActions.actionType} = ${PR_CONFLICT_ACTION})::int`.as('conflicts'),
      lastConflictAt: sql<Date | null>`max(${managerActions.createdAt}) filter (where ${managerActions.actionType} = ${PR_CONFLICT_ACTION})`.as('last_conflict_at'),
      // A historical conflict_exhausted report is no longer terminal. Excluding it here
      // revives the existing backlog after deploy while retaining true authority,
      // provider-refusal and sync ceilings.
      blockedReports: sql<number>`count(*) filter (where ${managerActions.actionType} = ${MERGE_BLOCKED_ACTION} and coalesce(${managerActions.detail}, '') not like '%"reason":"conflict_exhausted"%')::int`.as('blocked_reports'),
      // `last_acted_at` was dropped with the least-recently-worked rotation it ordered:
      // the queue is oldest-first and stable, so when the manager last touched a PR is
      // no longer an input to anything. Selecting a `max()` nothing reads is a grouped
      // aggregate paid for on every pass.
    })
    .from(managerActions)
    .where(and(
      eq(managerActions.tenantId, tenantId),
      eq(managerActions.projectId, projectId),
      inArray(managerActions.actionType, [...PR_ACTION_TYPES]),
    ))
    .groupBy(managerActions.prId)
    .as('pr_activity');

  const openPrs = await db
    .select({
      id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId,
      buildStatus: pullRequests.buildStatus, repoId: pullRequests.repoId, updatedAt: pullRequests.updatedAt,
      syncs: prActivity.syncs,
      mergeFailures: prActivity.mergeFailures,
      conflicts: prActivity.conflicts,
      lastConflictAt: prActivity.lastConflictAt,
      blockedReports: prActivity.blockedReports,
    })
    .from(pullRequests)
    .leftJoin(prActivity, eq(prActivity.prId, pullRequests.id))
    .where(and(
      eq(pullRequests.tenantId, tenantId),
      eq(pullRequests.projectId, projectId),
      eq(pullRequests.status, 'open'),
      // An unlinked provider PR is visible to reconciliation but cannot bypass
      // ticket review/sign-off governance by entering the merge queue as an orphan.
      isNotNull(pullRequests.taskId),
      // ── HOW A PR LEAVES THE QUEUE ───────────────────────────────────────────────
      // Retiring a PR to a human writes `merge_blocked`; it does NOT close the pull
      // request, which stays `open` on the provider until a person deals with it. Under
      // the old rotation that was harmless — the window moved on regardless. Under a
      // STABLE oldest-first order it is fatal: the twenty oldest PRs exhaust their
      // ceilings, get reported once, and then sit at the head of the window forever, so
      // the queue deadlocks on its own retirements and PR 21 is never reached.
      //
      // The exit is RETIRED AND REPORTED, and both halves are load-bearing. Exhausted
      // but not yet reported must stay IN — that pass is what tells the human. And
      // reported alone must not evict, because `merge_blocked` also carries "ready, but
      // merge authority is withheld" (0363), which is a project POLICY rather than a
      // spent ceiling: those PRs have low counters, must keep their place, and must
      // merge on the next pass after a person grants the authority.
      sql`not (
        coalesce(${prActivity.blockedReports}, 0) > 0
        and greatest(
          coalesce(${prActivity.syncs}, 0),
          coalesce(${prActivity.mergeFailures}, 0)
        ) >= ${MAX_REMEDY_ATTEMPTS}
      )`,
    ))
    // OLDEST FIRST, AND STABLE — see `prMergeQueue.ts`. 0383 ordered this
    // least-recently-worked-first so every PR got a turn, which fixed one starvation and
    // caused a worse one: a turn every ~19 passes against a base that moves every few
    // minutes means no PR ever accumulates the three attempts its ceiling needs, so
    // nothing merges and nothing retires either (measured: `attempts=2` on row after row
    // of the stuck register after 16–28 days). A queue has to keep the same PR at its
    // head until that head reaches a conclusion. `id` breaks ties so the order is total.
    // Green/unknown rows first. Explicitly red or pending rows are retained for
    // CI remediation but cannot fill the bounded 20-row window ahead of ready work.
    .orderBy(
      sql`case when ${pullRequests.buildStatus} = 'success' then 0 when ${pullRequests.buildStatus} is null then 1 else 2 end`,
      asc(pullRequests.createdAt), asc(pullRequests.id),
    )
    .limit(PR_MERGE_WINDOW);
  const activePrRuns = openPrs.some((pr) => pr.taskId != null)
    ? await runtimeService.listActiveByTasks(openPrs.flatMap((pr) => pr.taskId == null ? [] : [pr.taskId])).catch(() => [])
    : [];
  const activePrTaskIds = new Set<number>(activePrRuns.map((e) => e.taskId as unknown as number));

  // ── THE TWO CEILINGS AND THE DEDUPE, all from the one scan above ────────────────
  //
  // SYNC: how many times a PR has been brought up to date with its base without ever
  // merging. Syncing a stale branch is a correct action; syncing the same branch forever
  // is the platform's largest measured livelock — 40,580 `sync_pr` actions against 10
  // merges all-time, still running at 13,549/week with ZERO merges when re-measured on
  // 2026-07-26. The remedy was never wrong; nothing ever asked whether it worked.
  //
  // MERGE: how many times the PROVIDER has refused the merge. This one had no ceiling at
  // all until 0381 — the refusal was journalled as a generic 'flag' and the loop simply
  // went round again, so "Could not merge PR #29: … not mergeable" fired once per pass
  // indefinitely. It is the same livelock as the sync, one branch further down the same
  // function, and it now obeys the same rule ({@link isActionExhausted}).
  //
  // CONFLICT: how many times the loop has found this branch conflicting with its base.
  // The third unbounded remedy on the same function, and the one still running when 0381
  // shipped: a conflicting PR whose recovery cannot START — its ticket has no agent to
  // hand the branch back to — journals `pr_conflict` and continues, every pass, with
  // nothing counting it. Measured on project 11, 2026-07-29: 102 `pr_conflict` decisions
  // in one day, including "Could not start conflict recovery for PR #46: merge conflict"
  // re-taken on every pass. A conflict handed back three times and still conflicting is
  // the same livelock the two ceilings above end, so it obeys the same rule.
  //
  // MERGE AUTHORITY (0363) withheld is a STATE that persists across passes, not an event,
  // so it is reported once per PR rather than every five minutes. All three ceilings
  // report through that same `merge_blocked` type and share its dedupe.
  //
  // KEYED BY PR ID (0383) — see the query above. Keyed by ticket, these maps held nothing
  // at all for an orphan PR, which is how one escaped every ceiling indefinitely.
  const alreadyReportedBlocked = new Set<string>();
  for (const pr of openPrs) if ((pr.blockedReports ?? 0) > 0) alreadyReportedBlocked.add(pr.id);

  // ── THE QUEUE ───────────────────────────────────────────────────────────────────
  // Three counters and the active-run check decide, in one pure pass, which PRs may
  // cost provider round-trips — see `prMergeQueue.ts` for why a window of 20 conflicting
  // branches all targeting one base is a QUEUE and not twenty independent repairs. The
  // counters are read straight off the PR row (the grouped scan above is keyed on
  // `pr_id`), so there is no intermediate map that could reintroduce a ticket key.
  const queue = planMergeQueue(openPrs, {
    hasActiveRun: (pr) => pr.taskId != null && activePrTaskIds.has(pr.taskId),
    requireGreen: policy.prMergePolicy === 'on_green',
  });
  out.queue = summarizeMergeQueue(queue);

  /**
   * Hand a conflicting PR back to the ticket's agent. A conflict can be found
   * either while updating the branch or by the final merge API (GitHub commonly
   * returns the latter as HTTP 405), so both paths must use the same recovery.
   */
  const startConflictRecovery = async (pr: (typeof openPrs)[number], mayRecover: boolean) => {
    const task = pr.taskId == null ? null : await loadRecoveryTask(db, tenantId, pr.taskId);
    const affordable = budget.canAfford(MIN_DISPATCH_WINDOW_MS);
    if (!affordable) budget.shed('pr_merge');
    // TWO REASONS TO HOLD A RECOVERY, and they are not the same reason. `pass_budget`
    // says this pass ran out of time; `merge_queue` says the work would be void — a
    // second resolution running beside the head's is invalidated the moment the head
    // merges, and it costs a billable run to find that out. Journalled apart so the
    // feed can never again read as "the manager tried" when it deliberately did not.
    const deferred = !affordable ? 'pass_budget' : !mayRecover ? 'merge_queue' : null;
    let recoveryStarted = false;
    if (deferred == null && task && (task.assignedAgentRef || task.assignedAgentHostId != null)) {
      const recoveryNote = `\n\n[Manager recovery] PR #${pr.number ?? '?'} conflicts with the latest base branch. Sync the latest base, resolve every conflict while preserving both sets of intended changes, run the relevant checks, and update the existing PR.`;
      await db.update(tasks).set({
        status: TaskStatus.IN_PROGRESS,
        completedAt: null,
        description: task.description?.includes('[Manager recovery]')
          ? task.description
          : `${task.description ?? ''}${recoveryNote}`.trim(),
        updatedAt: new Date(),
      }).where(scopedToTenant(tasks, tenantId, eq(tasks.id, task.id)));
      recoveryStarted = (await runs.spend(
        () => maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: task.id, status: TaskStatus.IN_PROGRESS,
          submittedBy: `manager:conflict-resolution:${policy.managerRef ?? 'system'}`,
        }),
        (v) => v === true,
      )).result === true;
      if (recoveryStarted) out.dispatched += 1;
    }
    return { deferred, recoveryStarted };
  };

  for (const { pr, disposition, mayRecover } of queue) {
    // The eviction point. Each iteration does provider round-trips (sync, poll, merge),
    // so this loop is where the pass dies on a project with hundreds of open PRs. Stop
    // at the budget, between PRs, and let the closing journal say so.
    if (budget.over()) { budget.shed('pr_merge'); break; }
    try {
      // A previous conflict-resolution run owns this branch until it finishes.
      if (disposition === 'running') continue;

      // BEHIND THE HEAD. Not skipped for lack of time — skipped because only the front
      // of the queue can merge, and every branch behind it goes stale the moment it
      // does. This is the branch that gives the pass its budget back: it costs nothing,
      // and it is where 17 of the 20 PRs in a window now land.
      if (disposition === 'queued') continue;

      // Red/pending CI is remediation work, not an integration head. Its ticket was
      // reopened by reconciliation/CI handling; do not let it consume queue depth.
      if (disposition === 'ci_blocked') continue;

      // Exhausted sync: this PR has been brought up to date with its base
      // MAX_REMEDY_ATTEMPTS times and still has not merged, so a further sync is not a
      // fix in progress — it is the livelock. Report it once (the `merge_blocked` dedupe
      // below is the same "state, not event" rule) and leave it for a human.
      if (disposition === 'sync_exhausted') {
        if (!alreadyReportedBlocked.has(pr.id)) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: MERGE_BLOCKED_ACTION,
            summary: `PR #${pr.number ?? '?'} has been synced with its base ${pr.syncs} times without merging — stopping the sync loop and handing it to a human.`,
            detail: { reason: 'sync_exhausted', syncAttempts: pr.syncs },
          });
          alreadyReportedBlocked.add(pr.id);
        }
        continue;
      }

      // EXHAUSTED MERGE (0381). The provider has refused this merge MAX_REMEDY_ATTEMPTS
      // times. Nothing the manager does between attempts changes the answer — a PR that
      // is not mergeable for a structural reason (a required review, a branch rule, a
      // merge queue, squash disabled on the repo) is not mergeable on the next tick
      // either, and re-asking is the same livelock the sync ceiling above exists to end.
      // Report the reason ONCE and leave it for a person, who is the only one who can
      // clear any of those.
      if (disposition === 'merge_exhausted') {
        if (!alreadyReportedBlocked.has(pr.id)) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: MERGE_BLOCKED_ACTION,
            summary: `PR #${pr.number ?? '?'} has been refused by the provider ${pr.mergeFailures} times — stopping the merge loop and handing it to a human. Open it on the provider for the exact block (required reviews, branch rules, a merge queue, or squash merges disabled).`,
            detail: { reason: 'merge_failed_exhausted', mergeFailures: pr.mergeFailures },
          });
          alreadyReportedBlocked.add(pr.id);
        }
        continue;
      }

      // A content conflict is recoverable work, not a permanent human terminal. Once
      // repeated attempts spend the fast-retry allowance, the queue holds its single
      // integration head for a bounded cooldown. It then retries autonomously; the
      // branches behind it remain untouched so they cannot invalidate one another.
      if (disposition === 'conflict_backoff') continue;

      // Always integrate the latest base first. This prevents a queue of agent PRs
      // from all being merged against the same stale main revision.
      const prepared = await updateRecordedPullRequestBranch(db, env, { tenantId, prId: pr.id });
      if (!prepared.ok) {
        // THE UNIT THAT OVERRAN THE PASS. This branch dispatches a cloud run, and a
        // dispatch is the most expensive thing a pass does — measured at 16.4s here, on a
        // 14s discretionary window. `budget.over()` at the top of the loop cannot stop a
        // unit that has not started yet, so this one asks whether it still FITS. With too
        // little window left the conflict is journalled without recovery and the stage is
        // shed, which hands the next pass to whatever this one starved (see
        // `passRotation.ts`) rather than silently running 7.6s past the whole budget.
        const recovery = prepared.code === 'conflict'
          ? await startConflictRecovery(pr, mayRecover)
          : { deferred: null, recoveryStarted: false };
        await recordManagerAction(db, {
          // PR_CONFLICT_ACTION, not 'flag' (0381): this is the only trace that the loop
          // touched a conflicting PR, and the rotation orders by it. Left as 'flag' it
          // was invisible to that ordering, so every conflicting PR read as "never acted
          // on" and held the front of the queue forever.
          tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: PR_CONFLICT_ACTION,
          summary: recovery.recoveryStarted
            ? `PR #${pr.number ?? '?'} conflicts with the latest base; started its ticket agent to resolve and update it.`
            : recovery.deferred === 'pass_budget'
              // "Could not update" would read as a provider failure. It is a scheduling
              // decision, and the honest version is the one that says the work is coming.
              ? `PR #${pr.number ?? '?'} conflicts with the latest base; deferred starting its resolution agent because this pass has too little time left to start a run — it goes out on the next pass.`
              : recovery.deferred === 'merge_queue'
                ? `PR #${pr.number ?? '?'} conflicts with the latest base; holding its resolution until the pull request ahead of it in the merge queue lands, because resolving against a base that is about to move would have to be redone.`
                : `Could not update PR #${pr.number ?? '?'} from the latest base: ${prepared.error}`,
          detail: {
            code: prepared.code,
            recoveryStarted: recovery.recoveryStarted,
            ...(recovery.deferred ? { deferred: recovery.deferred } : {}),
          },
        });
        continue;
      }
      if (prepared.updated) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: 'sync_pr',
          summary: `Updated PR #${pr.number ?? '?'} with the latest base branch before merge.`,
        });
        // Both GitHub updates and GitLab rebases are accepted asynchronously. Never
        // race the provider by merging the old head in this pass. The next manager
        // pass observes the current head; on-green also polls CI for that new commit.
        continue;
      }
      // 'on_green' waits for CI to pass. Don't depend on the inbound CI webhook — POLL
      // the provider's live status ourselves (self-trigger), persisting the verdict, so
      // an on_green PR merges even on a repo with no webhook installed. 'immediate'
      // policy skips the poll (it merges regardless of CI).
      if (policy.prMergePolicy === 'on_green') {
        const live = await pollPrCiStatus(env, db, tenantId, pr);
        if (live !== 'success') continue; // still pending or red — leave it for the next tick
      }

      // SELF-GOVERNANCE (0362), enforced again at the merge itself. CONDUCT above is not
      // the only way a PR reaches this loop — the inline run-end finalize, the Done-drag
      // finalize and board-sync can all record one — so gating only the completion step
      // would leave an unreviewed back door straight to a squash-merge. Re-checking here
      // costs one cached manifest read and makes "merged ⇒ signed off" an invariant
      // rather than a property of the path taken.
      //
      // Through the SAME policy-aware read as the conduct step, not a hand-rolled `if`:
      // the project setting is consulted in one place, so the two gates cannot disagree
      // about whether this project requires sign-off at all.
      if (pr.taskId != null) {
        const gate = await resolveRequiredSignoffGate(env, db, {
          tenantId, taskId: pr.taskId, requireSignoff: policy.requireSignoffToComplete,
        });
        if (!gate.satisfied) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: 'flag',
            summary: `Did not merge PR #${pr.number ?? '?'} — ${gate.detail}`,
            detail: {
              signoffGate: gate.reason,
              requiredCount: gate.requiredCount,
              satisfiedCount: gate.satisfiedCount,
              outstanding: gate.outstanding.map((o) => ({ roleKey: o.roleKey, roleName: o.roleName, state: o.state })),
            },
          });
          continue;
        }
      }
      // MERGE AUTHORITY (0363) — the last gate, and a different question from every check
      // above it. Those ask "is this change ready?"; this asks "may the manager act on
      // that answer unattended?". It used to be inferred from `prMergePolicy !== 'queue'`,
      // conflating HOW a merge happens with WHETHER one is permitted, and the inferred
      // answer for a default-configured project was yes. It is now granted explicitly at
      // the workspace or project tier, defaults to withheld, and — because a withheld
      // grant on a ready PR is a decision — it is journalled rather than skipped, so the
      // surface shows "waiting on a human to merge" instead of a PR that quietly never
      // moves. Both this and the sign-off gate above must pass.
      if (!policy.allowAutoMerge) {
        if (!alreadyReportedBlocked.has(pr.id)) {
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: MERGE_BLOCKED_ACTION,
            summary: `PR #${pr.number ?? '?'} is ready to merge, but autonomous merge authority is not granted — a human needs to approve & merge it.`,
            detail: {
              gate: 'allow_auto_merge',
              allowAutoMerge: false,
              prMergePolicy: policy.prMergePolicy,
              requireSignoffToComplete: policy.requireSignoffToComplete,
              grantAt: 'workspace manager defaults, or this project’s manager policy',
            },
          });
          alreadyReportedBlocked.add(pr.id);
        }
        continue;
      }

      const result = await mergeRecordedPullRequest(db, env, {
        tenantId, prId: pr.id, method: 'squash', mergedBy: `manager:${policy.managerRef ?? 'system'}`,
      });
      if (!result.ok) {
        // GitHub can discover a content conflict only at the final merge call and
        // reports it as HTTP 405. Treat it exactly like an update-branch conflict:
        // reopen the ticket and send its assigned agent to resolve the existing PR.
        if (result.code === 'conflict') {
          const recovery = await startConflictRecovery(pr, mayRecover);
          await recordManagerAction(db, {
            tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: PR_CONFLICT_ACTION,
            summary: recovery.recoveryStarted
              ? `PR #${pr.number ?? '?'} was refused at merge because it conflicts with the latest base; started its ticket agent to resolve and update it.`
              : recovery.deferred === 'pass_budget'
                ? `PR #${pr.number ?? '?'} was refused at merge because it conflicts with the latest base; deferred starting its resolution agent because this pass has too little time left.`
                : recovery.deferred === 'merge_queue'
                  ? `PR #${pr.number ?? '?'} was refused at merge because it conflicts with the latest base; holding its resolution until the pull request ahead of it in the merge queue lands.`
                  : `Could not start conflict recovery for PR #${pr.number ?? '?'}: ${result.error}`,
            detail: {
              code: result.code,
              detectedAt: 'merge',
              recoveryStarted: recovery.recoveryStarted,
              attempt: (pr.conflicts ?? 0) + 1,
              maxAttempts: MAX_REMEDY_ATTEMPTS,
              ...(recovery.deferred ? { deferred: recovery.deferred } : {}),
            },
          });
          continue;
        }
        // Journalled as MERGE_FAILED_ACTION, not 'flag' (0381) — the ceiling above counts
        // these, and a refusal buried among a project's ~1,770 daily flags is a refusal
        // nothing can count. The Nth failure is what retires the PR to a human.
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: MERGE_FAILED_ACTION,
          summary: `Could not merge PR #${pr.number ?? '?'}: ${result.error}`,
          detail: {
            code: result.code,
            attempt: (pr.mergeFailures ?? 0) + 1,
            maxAttempts: MAX_REMEDY_ATTEMPTS,
          },
        });
        continue;
      }
      out.merged += 1;
      // Ticket completion now happens inside mergeRecordedPullRequest (the shared
      // merge core), so the manager, the human "Approve & Merge" and the green-CI
      // auto-merge all complete the ticket via the ONE completeTaskOnMerge path —
      // which also records the lifecycle transition/DORA the old direct update skipped.
      await recordManagerAction(db, {
        tenantId, projectId, taskId: pr.taskId, prId: pr.id, runTaskId, actionType: 'merge_pr',
        summary: `Merged & closed PR #${pr.number ?? '?'}${result.merged ? '' : ' (already up to date)'} — ticket done.`,
        detail: { sha: result.sha },
      });
    } catch (error) { /* skip */ 
      reportCaughtError(error, { source: "application/repos/prMergeSweep.ts", operation: "runPrMergeForProject" });
    }
  }
}

/**
 * The registered sweep: work every opted-in project's merge queue, bounded by
 * {@link PR_MERGE_SWEEP_BUDGET_MS}.
 */
export async function runPrMergeSweep(
  env: Env,
  /** Shared per-tick dispatch ceiling. Conflict-resolution runs are billable, and this
   *  sweep draws from the SAME tenant budget as the manager pass and the autonomous
   *  executor rather than granting itself a private one. */
  budget: TickDispatchBudget = createTickDispatchBudget(),
): Promise<PrMergeSweepResult> {
  const db = buildDatabase(env);
  const runtimeService = buildRuntimeService(env, db);
  const projects = await loadPrQueueProjects(db, MAX_PROJECTS_PER_TICK);

  const result: PrMergeSweepResult = {
    projects: projects.length, worked: 0, merged: 0, dispatched: 0,
    queued: 0, retired: 0, notReached: 0,
  };

  const startedAt = Date.now();
  const pool = await runBoundedPool(
    projects,
    { limit: MAX_CONCURRENT_PROJECT_QUEUES, deadlineAt: startedAt + PR_MERGE_SWEEP_BUDGET_MS },
    async (p) => {
      try {
        // A tenant that already spent its tick budget elsewhere gets no further
        // platform-initiated runs. Checked per project because one tenant can own many.
        if (!budget.hasRoom(p.tenantId)) return;
        const policy = await getEffectiveManagerPolicy(db, p.tenantId, p.projectId, env);
        if (!policy.enabled) return;
        const one = await runPrMergeForProject(env, db, runtimeService, {
          tenantId: p.tenantId, projectId: p.projectId, policy,
          runs: tenantDispatchReserver(budget, p.tenantId),
        });
        result.worked += 1;
        result.merged += one.merged;
        result.dispatched += one.dispatched;
        result.queued += one.queue?.queued ?? 0;
        result.retired += one.queue?.retired ?? 0;
      } catch (err) {
        reportCaughtError(err, {
          source: 'application/repos/prMergeSweep.ts', operation: 'runPrMergeSweep',
          context: { logMessage: `[cron:pr-merge] project=${p.projectId} tenant=${p.tenantId} failed`, details: err },
        });
      }
    },
  );
  result.notReached = pool.notReached;
  return result;
}
