/**
 * githubActionsReconcile — close the loop on a dispatch GitHub never turned into a run.
 *
 * WHY THIS EXISTS
 * `workflow_dispatch` returns **204 with no body**: "accepted into the queue", not
 * "a runner started", and not even "a run exists". Every other executor proves
 * itself at kickoff — the container answers a `/health` probe, the durable DO
 * accepts `/start` — but this one hands work to infrastructure we cannot call into
 * and cannot see. If GitHub then never schedules a runner (Actions disabled for
 * the repo or org, an Actions spending limit reached, the `workflow_dispatch`
 * trigger missing from the DEFAULT branch, a repo pinned at its concurrency cap),
 * NOTHING happens and nothing says so. The execution sits `pending` until a
 * generic reaper eventually fails it with a message about silence — which
 * describes the symptom and names none of the four causes above, all of which the
 * operator can actually fix.
 *
 * So this sweep asks GitHub the question the dispatch could not:
 * `GET /actions/workflows/<agent>/runs?event=workflow_dispatch`. That answer
 * separates the two states the reaper cannot tell apart:
 *
 *   • a run EXISTS and is queued / in progress   → healthy, just slow. Leave it.
 *     (Actions queues legitimately exceed five minutes; this is the normal case
 *      and the reason the surface has a 20-minute ceiling in the first place.)
 *   • no run exists at all                       → GitHub never scheduled it.
 *     Terminal, and now attributable to a precise cause.
 *
 * ── Correlation ──────────────────────────────────────────────────────────────
 * The runs list does not echo a run's `inputs`, so the execution id rides in
 * `run-name` → `display_title` ({@link ../runtime/githubActionsWorkflow.agentRunName}).
 * A repo whose workflow predates that carries no id, so its runs are
 * UNATTRIBUTABLE — and the classifier deliberately waits on those rather than
 * guessing. Failing a live run is far worse than taking the 20-minute backstop.
 *
 * ── Why it is not cached ─────────────────────────────────────────────────────
 * Every other GitHub read on this surface goes through `getOrSetCached`
 * (workflow presence is read on the dispatch hot path and changes only on write).
 * This one must NOT: it exists precisely to observe a state that is changing
 * underneath us, and a cached "no runs yet" would fail a run that started one
 * second later. It is a cron-driven write path, not a read endpoint, and it runs
 * at most once per repo per tick.
 */
import { and, eq, gte, inArray, isNull, like, lte } from 'drizzle-orm';
import { githubRequest, repoPath, resolveRepoAuth } from '../repos/githubClient';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { AGENT_WORKFLOW_PATH, parseExecutionIdFromRunName } from './githubActionsWorkflow';
import {
  GITHUB_ACTIONS_NEVER_SCHEDULED_REASON,
  githubActionsRunEndedReason,
  githubActionsUnreachableReason,
} from './orphanReasons';
import { parseExecutor } from './cloudDispatch';
import { QUEUED_DEADLINE_MS } from './staleExecutionReaper';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { executions, toolAuditEvents } from '../../infrastructure/database/schema';
import { ExecutionStatus } from '../../domain/shared/types';
import type { Env } from '../../env';

/** Just the workflow file's basename — the runs endpoint keys on it, exactly as
 *  the dispatch endpoint does. */
const WORKFLOW_FILE = AGENT_WORKFLOW_PATH.split('/').pop() as string;

/**
 * How long after dispatch a run may show no GitHub run at all before we call it
 * never-scheduled.
 *
 * Longer than one five-minute cron tick so a dispatch is never judged by the same
 * sweep that could have raced it, and comfortably inside `QUEUED_DEADLINE_MS` so the
 * precise verdict lands BEFORE the generic reaper's. GitHub creates the run row
 * within seconds of accepting a dispatch — the wait before a *runner* attaches is
 * what's long — so six minutes of no run row at all is already conclusive.
 */
export const ACTIONS_SCHEDULE_GRACE_MS = 6 * 60_000;

/** Never scan more than this many stranded Actions dispatches per tick. The sweep
 *  shares a Worker subrequest budget with every other cron job, and one GitHub
 *  call per distinct repo is the real cost. */
export const ACTIONS_RECONCILE_MAX_CANDIDATES = 25;

/** The subset of a GitHub workflow-run object this decision needs. */
export interface ActionsRunView {
  status: string | null;
  conclusion: string | null;
  displayTitle: string | null;
  htmlUrl: string | null;
}

/** A run GitHub has scheduled but not finished. `waiting`/`requested`/`pending`
 *  are the deployment-gate + queued-for-a-runner states; all mean "not our
 *  problem yet". */
const LIVE_RUN_STATUSES = new Set(['queued', 'waiting', 'requested', 'pending', 'in_progress']);

export type ActionsVerdict =
  /** Nothing conclusive — leave the run alone (the 20-minute ceiling is the backstop). */
  | { action: 'wait'; why: string }
  /** Terminal, with a reason naming the actual cause. */
  | { action: 'fail'; reason: string };

/**
 * Decide the fate of one dispatched-but-never-started execution. Pure, so every
 * branch below is testable without GitHub or a database — which matters because
 * three of them FAIL a user's run and the fourth must not.
 */
export function classifyActionsDispatch(args: {
  /** The workflow run whose `display_title` carries this execution's id, if any. */
  matched: ActionsRunView | null;
  /** How many runs of the agent workflow exist that we could NOT attribute to an
   *  execution (an older workflow with no `run-name`). Non-zero means the repo is
   *  running the legacy workflow, so "no match" proves nothing. */
  unattributedRuns: number;
  /** Why the runs list could not be read, when it could not. */
  listError: { code: string; reason: string } | null;
}): ActionsVerdict {
  if (args.listError) {
    // 403 (`unauthorized`) is the actionable one: Actions administratively
    // disabled, or a credential that lost repo access. 404 means the workflow is
    // no longer on the default branch — the dispatch could not have produced a
    // run either. Anything else (rate limit, 5xx, a network blip) is OUR problem,
    // not the tenant's: waiting costs minutes, failing costs their run.
    if (args.listError.code === 'unauthorized' || args.listError.code === 'not_found') {
      return { action: 'fail', reason: githubActionsUnreachableReason(args.listError.reason) };
    }
    return { action: 'wait', why: `transient GitHub error: ${args.listError.code}` };
  }

  if (args.matched) {
    if (LIVE_RUN_STATUSES.has((args.matched.status ?? '').toLowerCase())) {
      return { action: 'wait', why: `run is ${args.matched.status}` };
    }
    // Terminal on GitHub's side while our execution never left `pending` — the job
    // died before the agent's first callback (checkout, setup-node, a cancelled or
    // timed-out job, a runner that never came up). GitHub's log has the detail we
    // don't, so the reason carries the URL.
    return { action: 'fail', reason: githubActionsRunEndedReason(args.matched.conclusion, args.matched.htmlUrl) };
  }

  // No run carries this execution's id. Conclusive ONLY if every run we can see is
  // attributable — otherwise the repo is on the pre-`run-name` workflow and its
  // runs are anonymous, so this execution's run may well be among them.
  if (args.unattributedRuns > 0) {
    return { action: 'wait', why: 'repo has runs from a workflow without run-name — cannot attribute' };
  }
  return { action: 'fail', reason: GITHUB_ACTIONS_NEVER_SCHEDULED_REASON };
}

export interface ActionsReconcileResult {
  /** Stranded Actions dispatches examined this tick. */
  checked: number;
  /** Failed with a precise, GitHub-derived reason instead of being left to the reaper. */
  failed: number;
  /** Confirmed alive on GitHub (queued behind a cap, or running) and left alone. */
  stillQueued: number;
}

/** A dispatched execution that has not yet reported in. */
interface StrandedRow {
  id: number;
  tenantId: number;
  taskId: number | null;
  payload: string | null;
  cloudAgentRef: string | null;
}

/**
 * Reconcile every GitHub Actions dispatch that is past its grace window and still
 * has not reported in. Best-effort throughout: any failure degrades to "leave it
 * to the reaper", which is exactly the behaviour that existed before this sweep.
 */
export async function reconcileGithubActionsRuns(env: Env, nowMs = Date.now()): Promise<ActionsReconcileResult> {
  const db = buildDatabase(env);
  const result: ActionsReconcileResult = { checked: 0, failed: 0, stillQueued: 0 };

  const candidates = await loadStrandedDispatches(db, nowMs);
  if (candidates.length === 0) return result;

  // One GitHub call per REPO, not per execution: a project auto-running a backlog
  // strands several executions against the same repository, and they are all
  // answered by the same runs list.
  const runsByRepo = new Map<string, Awaited<ReturnType<typeof listAgentRuns>>>();

  for (const row of candidates) {
    result.checked += 1;

    const repo = await resolveDefaultRepoForTask(db, row.tenantId, row.taskId).catch(() => null);
    if (!repo || repo.provider !== 'github') continue;

    const cacheKey = `${row.tenantId}:${repo.repoId}`;
    let runs = runsByRepo.get(cacheKey);
    if (!runs) {
      runs = await listAgentRuns(env, db, row.tenantId, repo.repoId);
      runsByRepo.set(cacheKey, runs);
    }

    const matched = runs.runs.find((r) => parseExecutionIdFromRunName(r.displayTitle) === row.id) ?? null;
    const unattributedRuns = runs.runs.filter((r) => parseExecutionIdFromRunName(r.displayTitle) == null).length;

    const verdict = classifyActionsDispatch({ matched, unattributedRuns, listError: runs.error });
    if (verdict.action === 'wait') {
      result.stillQueued += 1;
      continue;
    }

    if (await failStrandedDispatch(db, row, verdict.reason)) result.failed += 1;
  }

  return result;
}

/**
 * Executions dispatched to GitHub Actions that are past the grace window and have
 * never been flipped to RUNNING (the runner's `spec` call is what does that, so
 * `pending`/`submitted` here means no runner ever spoke to us).
 *
 * The upper bound matters as much as the lower one: past `QUEUED_DEADLINE_MS` the
 * generic reaper owns the row, and racing it would produce two terminal writes for
 * one run. This sweep only ever acts inside the window the reaper has not reached.
 */
async function loadStrandedDispatches(db: Db, nowMs: number): Promise<StrandedRow[]> {
  const graceCutoff = new Date(nowMs - ACTIONS_SCHEDULE_GRACE_MS);
  const reaperCutoff = new Date(nowMs - QUEUED_DEADLINE_MS);
  const rows = await db
    .select({
      id: executions.id,
      tenantId: executions.tenantId,
      taskId: executions.taskId,
      payload: executions.payload,
      cloudAgentRef: executions.cloudAgentRef,
    })
    .from(executions)
    .where(and(
      inArray(executions.status, [ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED]),
      isNull(executions.agentHostId),
      lte(executions.createdAt, graceCutoff),
      gte(executions.createdAt, reaperCutoff),
      // `executor` is stamped onto the payload by orchestrate(); an unstamped
      // payload never landed on this surface. A cheap SQL prefilter — the
      // canonical `parseExecutor` below is what actually decides, so the two can
      // never disagree about what "github_actions" means.
      like(executions.payload, '%"executor":"github_actions"%'),
    ))
    .orderBy(executions.createdAt)
    .limit(ACTIONS_RECONCILE_MAX_CANDIDATES)
    .catch(() => []);

  return rows
    .filter((r) => parseExecutor(r.payload) === 'github_actions')
    .map((r) => ({ id: r.id, tenantId: r.tenantId, taskId: r.taskId, payload: r.payload, cloudAgentRef: r.cloudAgentRef }));
}

/** List the agent workflow's `workflow_dispatch` runs for a repo. Never throws —
 *  a failure becomes a `listError` the classifier decides on. */
async function listAgentRuns(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
): Promise<{ runs: ActionsRunView[]; error: { code: string; reason: string } | null }> {
  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
  const auth = await resolveRepoAuth(env, db, secret, tenantId, repoId).catch(() => null);
  if (!auth || !auth.ok) {
    // An unresolvable credential is not a verdict about GitHub — treat it as
    // transient so the reaper (not this sweep) owns the outcome.
    return { runs: [], error: { code: 'provider_error', reason: auth && !auth.ok ? auth.error : 'credential unresolved' } };
  }

  const res = await githubRequest<{ workflow_runs?: Array<Record<string, unknown>> }>({
    coords: auth.auth.coords,
    token: auth.auth.token,
    // Scoped to OUR workflow and to dispatch-triggered runs: a busy repo's push /
    // PR runs are noise that would swamp the page and make `unattributedRuns`
    // permanently non-zero, wedging every verdict at "wait".
    path: repoPath(auth.auth.coords, `/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`),
  }).catch((e: unknown) => ({
    ok: false as const, status: 0, code: 'provider_error' as const,
    reason: e instanceof Error ? e.message : String(e),
  }));

  if (!res.ok) return { runs: [], error: { code: res.code, reason: res.reason } };

  const runs = (res.data?.workflow_runs ?? []).map((r) => ({
    status: str(r.status),
    conclusion: str(r.conclusion),
    displayTitle: str(r.display_title) ?? str(r.name),
    htmlUrl: str(r.html_url),
  }));
  return { runs, error: null };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Fail one stranded dispatch, guarded on it still being non-terminal so a runner
 * that checked in between the GitHub read and this write is never clobbered.
 * Mirrors the failure onto the Observability timeline exactly as the reaper does —
 * without it the run simply stops with no explanation there.
 */
async function failStrandedDispatch(db: Db, row: StrandedRow, reason: string): Promise<boolean> {
  const updated = await db
    .update(executions)
    .set({ status: ExecutionStatus.FAILED, errorMessage: reason, completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(executions.id, row.id),
      inArray(executions.status, [ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED]),
    ))
    .returning({ id: executions.id })
    .catch(() => []);
  if (updated.length === 0) return false;

  await db.insert(toolAuditEvents).values({
    tenantId: row.tenantId,
    agentHostId: null,
    cloudAgentRef: row.cloudAgentRef,
    executionId: row.id,
    sessionKey: `exec:${row.id}`,
    toolName: 'run.failed',
    category: 'error',
    result: reason,
    ts: new Date(),
  }).catch(() => { /* telemetry is best-effort — never break the sweep on it */ });

  return true;
}
