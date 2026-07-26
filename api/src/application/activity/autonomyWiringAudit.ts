/**
 * autonomyWiringAudit — "CAN the autonomy machinery work?", not "did tickets move?".
 *
 * WHY THIS EXISTS (an honest post-mortem of the previous audit)
 * The ticket-lifecycle ledger measured OUTCOMES: it correctly reported that 0.7% of
 * tickets completed autonomously and that the recorded skip reason was `human_gate`.
 * It was still useless for finding the actual faults, because an outcome audit
 * confidently attributes a failure to whatever reason happens to be recorded. Every
 * real defect was found afterwards, by hand:
 *
 *   • `ticket_role_signoffs` was EMPTY tenant-wide — 487 required slots, 0 ever
 *     satisfied. The review loop had never once completed, so every sign-off gate
 *     downstream was unsatisfiable by construction.
 *   • `manager_actions` held 40,559 `sync_pr` against 10 `merge_pr` — the manager was
 *     livelocked re-syncing PR branches and deferring the merge forever.
 *   • 280 PRs sat open for up to 19 days with branches and code, while the outcome
 *     audit blamed a lane gate that had nothing to do with completion.
 *   • Role resolution read only `swimlane_requirements`, and 10 of 11 boards had none —
 *     so producer attribution silently returned early for essentially every ticket.
 *
 * None of those are visible in a funnel. All of them are visible as VIOLATED INVARIANTS:
 * "if required slots exist, sign-offs must be possible"; "merge attempts must converge";
 * "a lane that gates on approval must have a resolvable approver"; "a completed run must
 * advance something". So this module asserts invariants and fails loudly, with the
 * measured numbers and a concrete remedy attached to each one.
 *
 * Design rules for anything added here:
 *   1. Assert a MECHANISM invariant, never a business outcome (low throughput is not a
 *      wiring fault; an unsatisfiable gate is).
 *   2. Every check carries the numbers it judged on, so a verdict is never unfalsifiable.
 *   3. A check that cannot be evaluated reports `unknown` — never `pass`. Silence must
 *      not read as health; that is exactly how the first audit misled.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  boards, managerActions, projectManagerConfigs, projects, pullRequests,
  swimlaneAgentAssignments, swimlaneRequirements, swimlanes, taskStatusTransitions,
  ticketParticipants, ticketRoleSignoffs, tasks, executions,
} from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { activityLogVersionKey } from './activityLog';
import { liveExecution } from '../rehearsal/executionMode';
import { isParticipantSatisfied } from '../kanban/participantStates';
import { expectsCodeDeliverable } from '../manager/evaluateTicketReadiness';
import { ExecutionStatus, TaskStatus } from '../../domain/shared/types';

/** How bad a violation is. `critical` = autonomy CANNOT complete work in this state. */
export type WiringSeverity = 'critical' | 'warning' | 'info';

/** `unknown` is deliberately distinct from `pass` — see the header. */
export type WiringVerdict = 'pass' | 'fail' | 'unknown';

export interface WiringCheck {
  id: string;
  title: string;
  severity: WiringSeverity;
  verdict: WiringVerdict;
  /** The invariant being asserted, in one sentence. */
  invariant: string;
  /** What was measured — always present so the verdict is falsifiable. */
  measured: Record<string, number | string | null>;
  /** What the numbers mean, and what breaks because of them. */
  detail: string;
  /** The concrete next action when this fails. */
  remedy: string | null;
}

export interface AutonomyWiringAudit {
  generatedAt: string;
  /** Highest severity among failing checks, or null when everything passes. */
  worstSeverity: WiringSeverity | null;
  /** True when NO critical invariant is violated — i.e. autonomy can actually complete. */
  canCompleteAutonomously: boolean;
  checks: WiringCheck[];
  summary: { pass: number; fail: number; unknown: number };
}

/** A livelock signal: this many sync actions per merge means the loop is not converging. */
export const SYNC_TO_MERGE_LIVELOCK_RATIO = 20;
/** An open PR older than this is not "in review", it is stranded. */
export const STALE_PR_DAYS = 3;

function check(c: WiringCheck): WiringCheck { return c; }

/**
 * Run every wiring invariant for a tenant. Set-based queries only — this is an audit,
 * so it must not itself become the slow thing that stops being run.
 */
export async function auditAutonomyWiring(db: Db, args: { tenantId: number }): Promise<AutonomyWiringAudit> {
  const { tenantId } = args;
  const checks: WiringCheck[] = [];

  const projectIds = (await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))).map((r) => Number(r.id));

  // ── 1. Is the sign-off loop closed at all? ────────────────────────────────
  const [slotAgg] = await db
    .select({
      required: sql<number>`count(*) FILTER (WHERE ${ticketParticipants.required})::int`,
      satisfied: sql<number>`count(*) FILTER (WHERE ${ticketParticipants.required} AND ${ticketParticipants.state} IN ('completed','waived','skipped'))::int`,
      unstaffed: sql<number>`count(*) FILTER (WHERE ${ticketParticipants.required} AND ${ticketParticipants.state} = 'unstaffed')::int`,
    })
    .from(ticketParticipants)
    .where(eq(ticketParticipants.tenantId, tenantId));
  const [signoffAgg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ticketRoleSignoffs)
    .where(eq(ticketRoleSignoffs.tenantId, tenantId));

  const requiredSlots = Number(slotAgg?.required ?? 0);
  const satisfiedSlots = Number(slotAgg?.satisfied ?? 0);
  const unstaffedSlots = Number(slotAgg?.unstaffed ?? 0);
  const signoffRows = Number(signoffAgg?.n ?? 0);

  checks.push(check({
    id: 'signoff_loop_closed',
    title: 'Sign-off loop has completed at least once',
    severity: 'critical',
    invariant: 'If required participation slots exist, at least one sign-off must have been recorded — otherwise no sign-off-gated ticket can ever complete.',
    verdict: requiredSlots === 0 ? 'unknown' : (signoffRows > 0 ? 'pass' : 'fail'),
    measured: { requiredSlots, satisfiedSlots, signoffLedgerRows: signoffRows },
    detail: requiredSlots === 0
      ? 'No required participation slots exist yet, so the loop has nothing to close — this is unevaluated, not healthy.'
      : signoffRows > 0
        ? `${signoffRows} sign-off(s) recorded across ${requiredSlots} required slots.`
        : `${requiredSlots} required slots exist and the sign-off ledger is EMPTY — not one role has ever signed off, so every sign-off gate is unsatisfiable by construction.`,
    remedy: requiredSlots > 0 && signoffRows === 0
      ? 'Verify reviewers are actually dispatched with a sign-off instruction (laneRequirementGate / the manager\'s drive_signoff step) and that the lane has a resolvable approver.'
      : null,
  }));

  checks.push(check({
    id: 'slots_satisfiable',
    title: 'Required slots are capable of being satisfied',
    severity: 'critical',
    invariant: 'A required slot with no assignee (`unstaffed`) can never be satisfied, so it deadlocks its ticket permanently.',
    verdict: requiredSlots === 0 ? 'unknown' : (unstaffedSlots === 0 ? 'pass' : 'fail'),
    measured: { requiredSlots, unstaffedSlots },
    detail: unstaffedSlots === 0
      ? 'Every required slot has a resolvable assignee.'
      : `${unstaffedSlots} required slot(s) are unstaffed — those tickets can never reach unanimous sign-off.`,
    remedy: unstaffedSlots > 0 ? 'Staff the missing roles (board lane agents or an explicit resource assessment), or waive the role with a recorded reason.' : null,
  }));

  // ── 2. Does the merge loop converge? (the livelock that stranded 280 PRs) ──
  const mergeActions = await db
    .select({ actionType: managerActions.actionType, n: sql<number>`count(*)::int` })
    .from(managerActions)
    .where(eq(managerActions.tenantId, tenantId))
    .groupBy(managerActions.actionType);
  const actionCount = new Map(mergeActions.map((r) => [r.actionType, Number(r.n)]));
  const syncPr = actionCount.get('sync_pr') ?? 0;
  const mergePr = actionCount.get('merge_pr') ?? 0;
  const ratio = mergePr === 0 ? (syncPr > 0 ? Infinity : 0) : syncPr / mergePr;

  checks.push(check({
    id: 'merge_loop_converges',
    title: 'PR merge attempts converge',
    severity: 'critical',
    invariant: 'Branch-sync passes must terminate in a merge. A sync count vastly exceeding the merge count means the manager is deferring the merge every pass and never completing it.',
    verdict: syncPr === 0 ? 'unknown' : (Number.isFinite(ratio) && ratio < SYNC_TO_MERGE_LIVELOCK_RATIO ? 'pass' : 'fail'),
    measured: {
      syncPrActions: syncPr,
      mergePrActions: mergePr,
      syncPerMerge: Number.isFinite(ratio) ? Math.round(ratio) : 'infinite',
      livelockThreshold: SYNC_TO_MERGE_LIVELOCK_RATIO,
    },
    detail: syncPr === 0
      ? 'The manager has not attempted a branch sync yet — unevaluated.'
      : Number.isFinite(ratio) && ratio < SYNC_TO_MERGE_LIVELOCK_RATIO
        ? `${syncPr} syncs to ${mergePr} merges — the loop is converging.`
        : `${syncPr} branch-syncs produced only ${mergePr} merges. The manager is re-syncing and deferring forever instead of merging (a livelock, not slowness).`,
    remedy: (syncPr > 0 && (!Number.isFinite(ratio) || ratio >= SYNC_TO_MERGE_LIVELOCK_RATIO))
      ? 'Check updatePullRequestBranch: an indeterminate provider mergeability state must not be reported as "branch updated", or the caller defers on every pass.'
      : null,
  }));

  // ── 3. Are PRs stranded? ──────────────────────────────────────────────────
  const staleCutoff = new Date(Date.now() - STALE_PR_DAYS * 86_400_000);
  const [prAgg] = await db
    .select({
      open: sql<number>`count(*) FILTER (WHERE ${pullRequests.status} = 'open')::int`,
      stale: sql<number>`count(*) FILTER (WHERE ${pullRequests.status} = 'open' AND ${pullRequests.createdAt} < ${staleCutoff.toISOString()})::int`,
      oldestDays: sql<number>`COALESCE(MAX(EXTRACT(DAY FROM (now() - ${pullRequests.createdAt}))) FILTER (WHERE ${pullRequests.status} = 'open'), 0)::int`,
    })
    .from(pullRequests)
    .where(eq(pullRequests.tenantId, tenantId));
  const openPrs = Number(prAgg?.open ?? 0);
  const stalePrs = Number(prAgg?.stale ?? 0);

  checks.push(check({
    id: 'prs_not_stranded',
    title: 'Open PRs are progressing',
    severity: 'warning',
    invariant: `An autonomously-opened PR should reach a decision within ${STALE_PR_DAYS} days; older open PRs indicate the completion path is stuck rather than busy.`,
    verdict: openPrs === 0 ? 'pass' : (stalePrs === 0 ? 'pass' : 'fail'),
    measured: { openPrs, stalePrs, oldestOpenPrDays: Number(prAgg?.oldestDays ?? 0), staleAfterDays: STALE_PR_DAYS },
    detail: stalePrs === 0
      ? `${openPrs} open PR(s), none stale.`
      : `${stalePrs} of ${openPrs} open PRs are older than ${STALE_PR_DAYS} days (oldest ${Number(prAgg?.oldestDays ?? 0)} days) — the merge path is not clearing them.`,
    remedy: stalePrs > 0 ? 'Inspect the merge convergence check above and whether merge authority (allowAutoMerge) is actually granted.' : null,
  }));

  // ── 4. Is a completed run advancing anything? (silent attribution no-op) ──
  // `liveExecution()`: rehearsals (0372) run the real loop but ship nothing, so
  // counting them here would report probes as completed delivery.
  const [runAgg] = await db
    .select({ completed: sql<number>`count(*)::int` })
    .from(executions)
    .where(and(eq(executions.tenantId, tenantId), eq(executions.status, ExecutionStatus.COMPLETED), liveExecution()));
  const completedRuns = Number(runAgg?.completed ?? 0);

  checks.push(check({
    id: 'run_attribution_effective',
    title: 'Completed runs advance the participation manifest',
    severity: 'critical',
    invariant: 'A completed run must advance at least one manifest slot. Many completed runs with zero satisfied slots means attribution is silently returning early.',
    verdict: (completedRuns === 0 || requiredSlots === 0) ? 'unknown' : (satisfiedSlots > 0 ? 'pass' : 'fail'),
    measured: { completedRuns, requiredSlots, satisfiedSlots },
    detail: (completedRuns === 0 || requiredSlots === 0)
      ? 'Not enough completed runs or manifest slots to evaluate attribution.'
      : satisfiedSlots > 0
        ? `${satisfiedSlots} slot(s) satisfied across ${completedRuns} completed runs.`
        : `${completedRuns} runs completed yet NOT ONE of ${requiredSlots} required slots advanced — run attribution is failing silently (typically role resolution returning null).`,
    remedy: (completedRuns > 0 && requiredSlots > 0 && satisfiedSlots === 0)
      ? 'Check attributeRunToManifest role resolution: it must fall back beyond swimlane_requirements (lane agent, then the ticket action_type) or it no-ops on unconfigured boards.'
      : null,
  }));

  // ── 5. Can every gating lane resolve an approver? ─────────────────────────
  const laneRows = projectIds.length
    ? await db
      .select({
        laneId: swimlanes.id,
        laneKey: swimlanes.key,
        gate: swimlanes.gate,
        isTerminal: swimlanes.isTerminal,
        projectId: boards.projectId,
        requirementCount: sql<number>`(SELECT count(*)::int FROM ${swimlaneRequirements} WHERE ${swimlaneRequirements.swimlaneId} = ${swimlanes.id})`,
        agentCount: sql<number>`(SELECT count(*)::int FROM ${swimlaneAgentAssignments} WHERE ${swimlaneAgentAssignments.swimlaneId} = ${swimlanes.id})`,
      })
      .from(swimlanes)
      .innerJoin(boards, eq(boards.id, swimlanes.boardId))
      .where(inArray(boards.projectId, projectIds))
    : [];
  // A lane needs an approver when it gates on a human OR declares requirements. A lane
  // can resolve one from its requirement rows or from a staffed agent.
  const gatingLanes = laneRows.filter((l) => !l.isTerminal && (l.gate === 'human' || Number(l.requirementCount) > 0));
  const unresolvableLanes = gatingLanes.filter((l) => Number(l.requirementCount) === 0 && Number(l.agentCount) === 0);

  checks.push(check({
    id: 'gating_lane_has_approver',
    title: 'Every gating lane has a resolvable approver',
    severity: 'critical',
    invariant: 'A lane that requires approval must resolve an approver from its role requirements or its staffed agents; otherwise tickets entering it can never leave autonomously.',
    verdict: gatingLanes.length === 0 ? 'unknown' : (unresolvableLanes.length === 0 ? 'pass' : 'fail'),
    measured: {
      gatingLanes: gatingLanes.length,
      unresolvableLanes: unresolvableLanes.length,
      lanes: laneRows.length,
      examples: unresolvableLanes.slice(0, 5).map((l) => `project ${l.projectId}:${l.laneKey}`).join(', ') || null,
    },
    detail: unresolvableLanes.length === 0
      ? `${gatingLanes.length} gating lane(s), all with a resolvable approver.`
      : `${unresolvableLanes.length} gating lane(s) have neither role requirements nor a staffed agent — anything entering them stops permanently and needs a human.`,
    remedy: unresolvableLanes.length > 0 ? 'Staff an agent on those lanes, or set the lane gate to auto, or add a role requirement so an approver can be resolved.' : null,
  }));

  // ── 6. Review tickets that were supposed to produce code but did not ──────
  const reviewRows = projectIds.length
    ? await db
      .select({
        id: tasks.id, taskType: tasks.taskType, actionType: tasks.actionType,
        gitBranch: tasks.gitBranch, githubPrUrl: tasks.githubPrUrl,
      })
      .from(tasks)
      .where(and(
        inArray(tasks.projectId, projectIds),
        eq(tasks.status, TaskStatus.IN_REVIEW),
        eq(tasks.archived, false),
      ))
    : [];
  const noDeliverable = reviewRows.filter((t) =>
    expectsCodeDeliverable(t.taskType, t.actionType) && !t.gitBranch && !t.githubPrUrl);

  checks.push(check({
    id: 'review_has_deliverable',
    title: 'Tickets in review have the deliverable their type implies',
    severity: 'warning',
    invariant: 'Code work sitting in review must have a branch or PR. Reviewing nothing is not review — the ticket is unstarted and should have been returned to implementation.',
    verdict: reviewRows.length === 0 ? 'unknown' : (noDeliverable.length === 0 ? 'pass' : 'fail'),
    measured: { inReview: reviewRows.length, missingDeliverable: noDeliverable.length },
    detail: noDeliverable.length === 0
      ? `All ${reviewRows.length} in-review ticket(s) carry a deliverable.`
      : `${noDeliverable.length} of ${reviewRows.length} in-review tickets are implementation work with no branch or PR — they are stranded, not awaiting review.`,
    remedy: noDeliverable.length > 0 ? 'The manager review pass should return these to implementation (evaluateTicketReadiness → return_to_implementation) and restart their agent.' : null,
  }));

  // ── 7. Is autonomy actually moving lanes, or only humans? ─────────────────
  const hopRows = await db
    .select({ actorKind: taskStatusTransitions.actorKind, n: sql<number>`count(*)::int` })
    .from(taskStatusTransitions)
    .where(eq(taskStatusTransitions.tenantId, tenantId))
    .groupBy(taskStatusTransitions.actorKind);
  const systemHops = hopRows.filter((r) => r.actorKind !== 'human').reduce((a, r) => a + Number(r.n), 0);
  const humanHops = hopRows.filter((r) => r.actorKind === 'human').reduce((a, r) => a + Number(r.n), 0);
  const doneHops = await db
    .select({ actorKind: taskStatusTransitions.actorKind, n: sql<number>`count(*)::int` })
    .from(taskStatusTransitions)
    .where(and(eq(taskStatusTransitions.tenantId, tenantId), eq(taskStatusTransitions.toStatus, TaskStatus.DONE)))
    .groupBy(taskStatusTransitions.actorKind);
  const systemDone = doneHops.filter((r) => r.actorKind !== 'human').reduce((a, r) => a + Number(r.n), 0);

  checks.push(check({
    id: 'autonomy_reaches_terminal',
    title: 'Autonomy can carry work all the way to Done',
    severity: 'critical',
    invariant: 'If autonomy moves lanes at all, some of those moves must reach a terminal lane. Many system hops with almost none landing in Done means the chain breaks at the last step.',
    verdict: systemHops === 0 ? 'unknown' : (systemDone > 0 && systemDone * 20 >= systemHops ? 'pass' : 'fail'),
    measured: { systemHops, humanHops, systemHopsToDone: systemDone },
    detail: systemHops === 0
      ? 'Autonomy has not moved any lane yet — unevaluated.'
      : systemDone > 0 && systemDone * 20 >= systemHops
        ? `${systemDone} of ${systemHops} autonomous hops reached Done.`
        : `${systemHops} autonomous lane moves produced only ${systemDone} arrival(s) at Done — work is being moved but not finished.`,
    remedy: (systemHops > 0 && !(systemDone > 0 && systemDone * 20 >= systemHops))
      ? 'Trace the LAST hop before Done: usually the review gate has no resolvable approver, sign-off is impossible, or merge authority is withheld.'
      : null,
  }));

  // ── 8. Config coverage + duplicate boards (orphaned lane configuration) ───
  const boardRows = projectIds.length
    ? await db
      .select({ projectId: boards.projectId, n: sql<number>`count(*)::int` })
      .from(boards)
      .where(inArray(boards.projectId, projectIds))
      .groupBy(boards.projectId)
    : [];
  const dupBoards = boardRows.filter((b) => Number(b.n) > 1);

  checks.push(check({
    id: 'single_board_per_project',
    title: 'Each project has exactly one board',
    severity: 'warning',
    invariant: 'Only one board per project is canonical. Extra boards make their lane gates and agent staffing dead configuration, and can flip which lifecycle engine runs.',
    verdict: boardRows.length === 0 ? 'unknown' : (dupBoards.length === 0 ? 'pass' : 'fail'),
    measured: {
      projectsWithBoards: boardRows.length,
      projectsWithDuplicateBoards: dupBoards.length,
      worstBoardCount: dupBoards.reduce((m, b) => Math.max(m, Number(b.n)), 0),
    },
    detail: dupBoards.length === 0
      ? 'Every project has a single board.'
      : `${dupBoards.length} project(s) have multiple boards (worst: ${dupBoards.reduce((m, b) => Math.max(m, Number(b.n)), 0)}). Configuration on the non-canonical boards is silently ignored.`,
    remedy: dupBoards.length > 0 ? 'Merge/retire the duplicate boards so lane gates and staffing live on the canonical board only.' : null,
  }));

  const [cfgAgg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectManagerConfigs)
    .where(eq(projectManagerConfigs.tenantId, tenantId));
  checks.push(check({
    id: 'manager_config_explicit',
    title: 'Manager autonomy is explicitly configured',
    severity: 'info',
    invariant: 'A project relying on inherited defaults for completion/merge authority is running on implicit policy — a deliberate setting is auditable, an inherited one is not.',
    verdict: boardRows.length === 0 ? 'unknown' : (Number(cfgAgg?.n ?? 0) >= boardRows.length ? 'pass' : 'fail'),
    measured: { projectsWithBoards: boardRows.length, projectsWithManagerConfig: Number(cfgAgg?.n ?? 0) },
    detail: `${Number(cfgAgg?.n ?? 0)} of ${boardRows.length} board-bearing project(s) have an explicit manager config; the rest inherit defaults.`,
    remedy: Number(cfgAgg?.n ?? 0) < boardRows.length ? 'Set manager enablement and merge authority per project (or a tenant default) so autonomy is granted deliberately.' : null,
  }));

  // ── 9. Are merges happening without a green build? ───────────────────────
  const [mergedAgg] = await db
    .select({
      merged: sql<number>`count(*)::int`,
      mergedGreen: sql<number>`count(*) FILTER (WHERE ${pullRequests.buildStatus} = 'success')::int`,
      mergedByManager: sql<number>`count(*) FILTER (WHERE ${pullRequests.mergedBy} LIKE 'manager:%')::int`,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.status, 'merged')));
  const merged = Number(mergedAgg?.merged ?? 0);
  const mergedGreen = Number(mergedAgg?.mergedGreen ?? 0);

  checks.push(check({
    id: 'merges_were_verified',
    title: 'Autonomous merges had a passing build',
    severity: 'warning',
    invariant: 'A PR merged autonomously should have had a green build recorded. Merging without one ships unverified code with no human in the loop.',
    verdict: merged === 0 ? 'unknown' : (mergedGreen === merged ? 'pass' : 'fail'),
    measured: { mergedPrs: merged, mergedWithGreenBuild: mergedGreen, mergedByManager: Number(mergedAgg?.mergedByManager ?? 0) },
    detail: merged === 0
      ? 'No merged PRs to evaluate.'
      : mergedGreen === merged
        ? `All ${merged} merged PR(s) had a green build.`
        : `${merged - mergedGreen} of ${merged} merged PRs had no recorded green build — the default merge policy does not wait for CI.`,
    remedy: mergedGreen < merged ? "Set the project's PR merge policy to 'on_green' so the manager polls CI before merging." : null,
  }));

  const summary = checks.reduce(
    (a, c) => { a[c.verdict] += 1; return a; },
    { pass: 0, fail: 0, unknown: 0 } as { pass: number; fail: number; unknown: number },
  );
  const failing = checks.filter((c) => c.verdict === 'fail');
  const worstSeverity: WiringSeverity | null =
    failing.some((c) => c.severity === 'critical') ? 'critical'
      : failing.some((c) => c.severity === 'warning') ? 'warning'
        : failing.length > 0 ? 'info' : null;

  return {
    generatedAt: new Date().toISOString(),
    worstSeverity,
    // The headline: can this tenant complete work autonomously at all? A single critical
    // violation means no, regardless of how healthy the throughput charts look.
    canCompleteAutonomously: !failing.some((c) => c.severity === 'critical'),
    checks,
    summary,
  };
}

/**
 * Cached read. Version-token keyed off the activity-log version so board/ticket writes
 * invalidate it, with a short KV backstop — a wiring audit that lags reality by an hour
 * is how a regression hides.
 */
export async function getAutonomyWiringAudit(
  env: Env, db: Db, args: { tenantId: number },
): Promise<AutonomyWiringAudit> {
  const version = await getCacheVersion(env, activityLogVersionKey(args.tenantId));
  return getOrSetCached(
    env,
    `autonomy-wiring:tenant:${args.tenantId}:v:${version}`,
    () => auditAutonomyWiring(db, args),
    { kvTtlSeconds: 120 },
  );
}
