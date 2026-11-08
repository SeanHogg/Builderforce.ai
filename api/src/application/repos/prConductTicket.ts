/**
 * prConductTicket — what PR CONDUCT does for ONE review-ready ticket, and the one cohort
 * read that serves a whole project's batch of them.
 *
 * Moved verbatim from `ManagerService.coordinatePullRequests` when conduct became its own
 * registry sweep (`prConductSweep.ts`). The loop and the budget live there; this file is
 * the per-ticket decision and its recorded action, so neither grows into a god module.
 *
 * SELF-GOVERNANCE (0362): this is where the manager exercises completion authority, so it
 * is where unanimous sign-off is enforced. `requireSignoffToComplete` demands every
 * REQUIRED participation slot be satisfied first, and a ticket whose manifest has no
 * required slots never qualifies (signoffGate fails closed). It is a PROJECT SETTING, off
 * by default since 0380; `resolveRequiredSignoffGate` is the one read that consults it.
 *
 * A ticket need not carry `gitBranch`: a decision, a doc or a non-code chore is real work
 * with nothing to merge. A fully-signed-off ticket with no branch is closed directly.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests, taskFileChanges } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { normalizeBuildStatus, pickCurrentPr } from '../../domain/task/buildStatus';
import { classifyDeliverablePaths } from '../delivery/deliverableEvidence';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';
import { recordManagerAction } from '../manager/managerActionJournal';
import { decideTicketReadiness, type CompletionShape, type TicketPrState } from '../manager/evaluateTicketReadiness';
import { describeReturnBlock, returnToImplementation } from '../manager/returnToImplementation';
import { closeTicketAutomatically, loadReviewLaneGates, type CloseContext } from '../manager/reviewGateAuthority';
import type { EffectiveManagerPolicy } from '../manager/managerPolicy';
import {
  classifySignoffOwnership, resolveRequiredSignoffGate, resolveRequiredSignoffGates, type SignoffGateResult,
} from '../kanban/signoffGate';
import { loadConductMarkers, stampConducted } from './conductMarker';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import { dispatchTaskFinalize } from '../task/taskFinalize';
import { routeLaneEntry } from '../swimlane/laneEntryTrigger';
import type { DispatchReserver } from '../runtime/tickDispatchBudget';
import type { RuntimeService } from '../runtime/RuntimeService';
import { composeDispatcherLabel } from '../runtime/dispatcherLabel';

/** The ticket columns the review evaluation reads. */
export interface ReviewTicket {
  id: number;
  title: string;
  status: string;
  gitBranch: string | null;
  githubPrUrl: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  /** Needed to answer "was this supposed to produce code?". */
  taskType: string | null;
  actionType: string | null;
}

/** What one project's conduct batch did. */
export interface ConductTally { conducted: number; dispatched: number; }

/** Everything the batch reads ONCE for the whole cohort, instead of once per ticket. */
export interface ConductCohort {
  liveTaskIds: Set<number>;
  closeContext: CloseContext;
  prByTask: Map<number, { state: TicketPrState; buildStatus: string | null }>;
  pathsByTask: Map<number, string[]>;
  /** Every ticket's sign-off gate, resolved ONCE for the project (not per ticket in the loop). */
  signoffByTask: Map<number, SignoffGateResult>;
  /** When the sweep last examined each ticket — see `conductMarker.ts`. Mutated as stamps are written. */
  markers: Map<number, Date>;
}

/**
 * One scan for in-flight runs, one for the review lane's gate, one for build statuses and
 * one for changed paths — never a round-trip per ticket (this runs across every project).
 */
export async function loadConductCohort(
  env: Env, db: Db, runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; policy: EffectiveManagerPolicy; tickets: readonly ReviewTicket[] },
): Promise<ConductCohort> {
  const { tenantId, projectId, policy, tickets } = args;
  const ids = tickets.map((t) => t.id);
  const [signoffByTask, markers] = await Promise.all([
    resolveRequiredSignoffGates(env, db, { tenantId, taskIds: ids, requireSignoff: policy.requireSignoffToComplete }),
    loadConductMarkers(db, { tenantId, projectId, taskIds: ids }),
  ]);
  const liveExecs = ids.length ? await runtimeService.listActiveByTasks(ids) : [];
  const liveTaskIds = new Set<number>(liveExecs.map((e) => e.taskId as unknown as number));
  // THE REVIEW LANE'S GATE (1153). Null when it cannot be read, and a null gate CLOSES
  // NOTHING: completing past a gate whose configuration is unknown is exactly the override
  // the setting exists to govern.
  const closeContext: CloseContext = {
    laneGates: ids.length ? await loadReviewLaneGates(db, tenantId, projectId).catch(reportedFallback(null, { source: 'application/repos/prConductTicket.ts', operation: 'loadReviewLaneGates', context: { tenantId, projectId } })) : new Map<string, string>(),
    managerMayCloseReviewedTickets: policy.managerMayCloseReviewedTickets,
  };
  const prRows = ids.length
    ? await db
      .select({ taskId: pullRequests.taskId, buildStatus: pullRequests.buildStatus, status: pullRequests.status })
      .from(pullRequests)
      .where(and(eq(pullRequests.tenantId, tenantId), inArray(pullRequests.taskId, ids)))
      // NEWEST FIRST, so the "no open PR left" fallback is the most recent settled one.
      .orderBy(desc(pullRequests.updatedAt))
    : [];
  const fileRows = ids.length
    ? await db.select({ taskId: taskFileChanges.taskId, path: taskFileChanges.path })
      .from(taskFileChanges)
      .where(and(eq(taskFileChanges.tenantId, tenantId), inArray(taskFileChanges.taskId, ids)))
    : [];
  const pathsByTask = new Map<number, string[]>();
  for (const row of fileRows) pathsByTask.set(row.taskId, [...(pathsByTask.get(row.taskId) ?? []), row.path]);

  // AN OPEN ROW WINS over every other row a ticket has: it is the live one that decides
  // both whether anything is left to land and whose build verdict matters. The rule is
  // `pickCurrentPr` — the same one the board card's build badge is derived through.
  const rowsByTask = new Map<number, typeof prRows>();
  for (const r of prRows) {
    if (r.taskId == null) continue;
    const list = rowsByTask.get(r.taskId);
    if (list) list.push(r);
    else rowsByTask.set(r.taskId, [r]);
  }
  const prByTask = new Map<number, { state: TicketPrState; buildStatus: string | null }>();
  for (const [taskId, rows] of rowsByTask) {
    const current = pickCurrentPr(rows);
    if (current) prByTask.set(taskId, { state: current.status === 'open' ? 'open' : 'settled', buildStatus: current.buildStatus });
  }
  return { liveTaskIds, closeContext, prByTask, pathsByTask, signoffByTask, markers };
}

export interface ConductTicketCtx {
  tenantId: number;
  projectId: number;
  policy: EffectiveManagerPolicy;
  /** The tenant's shared per-tick RUN ceiling. Every billable start reserves first. */
  runs: DispatchReserver;
  runTaskId: number | null;
  cohort: ConductCohort;
  out: ConductTally;
}

/**
 * THE EVALUATION. Four questions, one verdict, one recorded action — see
 * `decideTicketReadiness`. Every outcome that does something is journalled; the transient
 * waits and `await_merge` are not (the merge sweep is the single writer for a PR's fate).
 * Best-effort per ticket: one failure never costs the batch.
 */
export async function conductReviewTicket(
  env: Env, db: Db, runtimeService: RuntimeService, ctx: ConductTicketCtx, t: ReviewTicket,
): Promise<void> {
  const { tenantId, projectId, policy, runs, runTaskId, cohort, out } = ctx;
  try {
    // Stamp FIRST: every examined ticket is "conducted", including the no-op outcomes below.
    await stampConducted(db, { tenantId, projectId, taskId: t.id, title: t.title, now: Date.now() }, cohort.markers);
    // Resolved once per project in `loadConductCohort`; the direct read is only a fallback
    // for a ticket the cohort somehow lacks.
    const signoff = cohort.signoffByTask.get(t.id) ?? await resolveRequiredSignoffGate(env, db, {
      tenantId, taskId: t.id, requireSignoff: policy.requireSignoffToComplete,
    });
    const pr = cohort.prByTask.get(t.id);
    const paths = cohort.pathsByTask.get(t.id);
    const readiness = decideTicketReadiness({
      taskType: t.taskType,
      actionType: t.actionType,
      title: t.title,
      hasBranch: !!t.gitBranch,
      // The RECORDED pull request decides this, not `tasks.github_pr_url`: that column is
      // stamped when a PR opens and never cleared, so it cannot tell an open PR from one
      // that merged weeks ago. A URL with no row left is 'settled'.
      prState: pr?.state ?? (t.githubPrUrl ? 'settled' : 'none'),
      hasAssignee: !!t.assignedAgentRef || t.assignedAgentHostId != null,
      buildStatus: normalizeBuildStatus(pr?.buildStatus),
      hasLiveRun: cohort.liveTaskIds.has(t.id),
      deliverableEvidence: paths ? classifyDeliverablePaths(paths) : (!t.gitBranch && !pr ? 'none' : 'unknown'),
      signoff,
      requireSignoff: policy.requireSignoffToComplete,
      requireGreenBuild: policy.prMergePolicy === 'on_green',
    });

    // Transient by definition — re-evaluated next tick, no noise.
    if (readiness.action === 'wait_for_run' || readiness.action === 'wait_for_build') return;
    // An OPEN PR still has to land: the merge sweep is the single writer for its fate.
    if (readiness.action === 'await_merge') return;

    // Expected a deliverable and there is none, or the build is red: not reviewable, it is
    // unfinished. Send it BACK to implementation and start its agent.
    if (readiness.action === 'return_to_implementation' || readiness.action === 'return_build_failed') {
      // ONE return primitive: it holds a ticket whose repository is unavailable (no run
      // could land the deliverable) and otherwise records the reopen of the implementation
      // producer, which makes the rework run below dispatchable.
      const returned = await returnToImplementation(env, db, {
        tenantId, taskId: t.id, fromStatus: TaskStatus.IN_REVIEW,
        expectsCode: readiness.expectsCode,
        reason: readiness.detail,
        actor: { kind: 'agent', ref: policy.managerRef ?? null, name: 'AI Manager' },
      });
      if (!returned.returned) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
          summary: `Held "${t.title}" in review — ${describeReturnBlock(returned.blockedReason)}`,
          detail: { action: readiness.action, expectsCode: readiness.expectsCode, held: true, blockedReason: returned.blockedReason },
        });
        return;
      }
      // The RETURN is a state change and always happens; the restart is billable, so it
      // reserves first. A ticket returned but not restarted is picked up by the executor's
      // next tick.
      const restarted = (await runs.spend(
        () => routeLaneEntry(env, db, runtimeService, {
          tenantId, projectId, taskId: t.id, status: TaskStatus.IN_PROGRESS,
          submittedBy: composeDispatcherLabel('manager', 'review-return', policy.managerRef ?? 'system'),
        }).catch(reportedFallback(false, { source: 'application/repos/prConductTicket.ts', operation: 'routeLaneEntry.reviewReturn', context: { tenantId, projectId, taskId: t.id } })),
        (v) => v === true,
      )).result === true;
      if (restarted) out.dispatched += 1;
      await recordManagerAction(db, {
        tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
        summary: `Returned "${t.title}" to implementation — ${readiness.detail}`,
        detail: { action: readiness.action, expectsCode: readiness.expectsCode, restarted, reopenedRoles: returned.reopenedRoles },
      });
      return;
    }

    // Sign-offs outstanding: ASK for them. Dispatching the owing role closes the
    // accountability loop (measured: 487 required slots, 0 ever satisfied without it).
    if (readiness.action === 'drive_signoff') {
      // Asking a reviewer IS a billable run, so it reserves first; out of budget the ask
      // is deferred to the next tick and the journal says exactly that.
      const spend = await runs.spend(
        () => driveOutstandingSignoffs(env, db, runtimeService, {
          tenantId, projectId, task: t, signoff, managerRef: policy.managerRef,
        }),
        (d) => d.asked.length > 0,
      );
      const drive = spend.result ?? {
        asked: [] as string[],
        blockedDetail: 'The workspace has used its dispatch budget for this tick; the sign-off ask goes out on the next one.',
        ownership: classifySignoffOwnership(signoff.outstanding),
      };
      out.dispatched += drive.asked.length;
      await recordManagerAction(db, {
        tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
        summary: drive.asked.length
          ? `Requested sign-off on "${t.title}" from ${drive.asked.join(', ')} — ${readiness.detail}`
          // "Held in review" alone was indistinguishable from a ticket whose reviewer WAS
          // asked. Say why nothing was asked.
          : `Held "${t.title}" in review — ${readiness.detail}${drive.blockedDetail ? ` ${drive.blockedDetail}` : ''}`,
        detail: {
          action: readiness.action,
          signoffGate: signoff.reason,
          requiredCount: signoff.requiredCount,
          satisfiedCount: signoff.satisfiedCount,
          // The ASSIGNEE, not just the role: "Architect (nobody assigned)" is the fact.
          outstanding: signoff.outstanding.map((o) => ({
            roleKey: o.roleKey, roleName: o.roleName, state: o.state,
            assigneeKind: o.assigneeKind, assigneeName: o.assigneeName,
          })),
          unstaffedCount: drive.ownership.unstaffed.length,
          humanOwedCount: drive.ownership.humanOwed.length,
          dispatchableCount: drive.ownership.dispatchable.length,
          // Agent-owed but NO LONGER ASKABLE — reported apart because it is subtracted from
          // `dispatchableCount`, and a falling number with no reason reads as progress.
          exhaustedCount: drive.ownership.exhausted.length,
          dispatchedTo: drive.asked,
        },
      });
      return;
    }

    // readiness.action === 'complete' — every check passed, including "nothing left to
    // land". WHICH closure applies is decided by the pure evaluator (`CompletionShape`).
    // WHO MAY CLOSE IT (1153): `closeTicketAutomatically` is the ONE automatic-close path
    // (merge sweep, CI/deploy webhooks, delta merge, stage advance, security re-scan). Held
    // (or a gate that could not be read): nothing is closed and a person closes it.
    const close = await closeTicketAutomatically(env, db, {
      tenantId, taskId: t.id, source: 'manager_review', managerRef: policy.managerRef,
      actor: { actorAgentRef: t.assignedAgentRef, actorAgentHostId: t.assignedAgentHostId },
      heldDetail: readiness.detail, runTaskId,
      known: { status: t.status, projectId, title: t.title, context: cohort.closeContext },
    });
    if (!close.closed) return;
    const reviewGate = close.verdict;
    const canOpenPr = readiness.completion === 'open_pr';
    if (canOpenPr) {
      await dispatchTaskFinalize(env as never, db, tenantId, t.id, {
        assignedAgentHostId: t.assignedAgentHostId,
        assignedAgentRef: t.assignedAgentRef,
        gitBranch: t.gitBranch,
        githubPrUrl: t.githubPrUrl,
        title: t.title,
      });
      out.conducted += 1;
    }
    // ONE SENTENCE PER CLOSURE: a reader must tell an empty ticket from one closing on top
    // of an unmerged branch.
    const CLOSURE: Record<Exclude<CompletionShape, 'open_pr'>, string> = {
      no_deliverable: `Closed "${t.title}" — no branch and no pull request, so there was nothing to merge.`,
      pr_settled: `Closed "${t.title}" — its pull request has already landed.`,
      branch_unopened: `Closed "${t.title}" — branch ${t.gitBranch} was never opened as a pull request and no agent is assigned to open one, so nothing was merged.`,
    };
    await recordManagerAction(db, {
      tenantId, projectId, taskId: t.id, runTaskId, actionType: 'flag',
      summary: canOpenPr
        ? `${readiness.detail} Opened PR for "${t.title}".`
        : `${readiness.detail} ${CLOSURE[(readiness.completion ?? 'no_deliverable') as Exclude<CompletionShape, 'open_pr'>]}`,
      detail: {
        action: readiness.action,
        completion: readiness.completion,
        signoffGate: signoff.reason,
        requiredCount: signoff.requiredCount,
        satisfiedCount: signoff.satisfiedCount,
        openedPr: canOpenPr,
        reviewGate,
      },
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/repos/prConductTicket.ts', operation: 'conductReviewTicket' });
  }
}
