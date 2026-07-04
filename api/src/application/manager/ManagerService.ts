/**
 * ManagerService — the AI Manager's per-project coordination pass.
 *
 * A designated manager (an AI agent OR a human) — and, by default, the tenant-wide
 * system service — reviews a project's board and does the judgement work the
 * mechanical autonomous sweep cannot:
 *   1. VALUE   — backfill business value (RICE-informed AI score, heuristic fallback)
 *                on every unscored ticket, so ranking has something to sort by.
 *   2. RANK    — order the backlog by priority × value × due-date urgency and persist
 *                each ticket's `manager_rank` (what the priority-aware dispatcher and
 *                the board default-sort read). Fixes "items not ordered in priority".
 *   3. ASSIGN  — give unowned work to the best-fit teammate/agent (so nothing sits
 *                invisible to autonomy).
 *   4. PR      — CONDUCT (open) PRs for finished work and MERGE + CLOSE open PRs per
 *                the project's PR authority policy.
 *   5. DISPATCH— kick the top-ranked runnable tickets NOW (in priority order) so the
 *                team keeps moving without waiting for the next cron tick.
 *
 * Every action is journalled to `manager_actions` so a human can see — and trust —
 * exactly what the manager did and why. Reused by the cron sweep (all projects) and
 * the "Run manager now" endpoint (one project), so both agree on the behaviour.
 *
 * Best-effort + isolated: every step is wrapped so one failing ticket can't abort
 * the pass, and each mutation is idempotent (re-scoring/re-ranking is a no-op-ish
 * overwrite; merge dedupes on an already-merged PR), so overlapping runs are safe.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import {
  tasks, boards, swimlanes, swimlaneAgentAssignments, pullRequests,
  projectManagerConfigs, managerActions,
} from '../../infrastructure/database/schema';
import { TaskStatus, ExecutionStatus } from '../../domain/shared/types';
import { rankBacklog, type RankableTask, type TaskPriorityTier } from './prioritize';
import { heuristicBusinessValue } from './businessValue';
import { scoreBusinessValueAI } from './businessValueAI';
import {
  resolveEffectiveManagerPolicy, type EffectiveManagerPolicy, type ManagerConfigRow,
} from './managerPolicy';
import { recommendTopAssignee } from '../metrics/assigneeRecommender';
import { mergeRecordedPullRequest } from '../repos/mergeRecordedPr';
import { dispatchTaskFinalize } from '../../presentation/routes/taskRoutes';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { TicketAuditService } from '../audit/ticketAuditService';

/** Non-terminal statuses whose tickets the manager grooms/ranks/assigns. */
const NON_TERMINAL: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];
/** Statuses an agent could pick up (Blocked waits on a dependency, not an agent). */
const RUNNABLE: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW,
];
const ACTIVE_EXEC = new Set<string>([
  ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED, ExecutionStatus.RUNNING, ExecutionStatus.PAUSED,
]);

/** Per-run bounds (cost + storm guards). The backlog paces itself across runs. */
const MAX_AI_SCORES_PER_RUN = 8;   // LLM calls — the rest fall back to the free heuristic
const MAX_RANKED = 300;
const MAX_ASSIGNMENTS_PER_RUN = 15;
const MAX_PR_ACTIONS_PER_RUN = 20;
const MAX_DISPATCHES_PER_RUN = 12;
const MAX_AUDITS_PER_RUN = 40;

export interface ManagerRunSummary {
  projectId: number;
  skipped: boolean;
  reason?: string;
  scored: number;
  ranked: number;
  assigned: number;
  prsConducted: number;
  prsMerged: number;
  dispatched: number;
  /** Tickets audited for role/diagnostic coverage, and how many were flagged. */
  audited: number;
  flagged: number;
}

// ── config store ────────────────────────────────────────────────────────────

/** A stored config row plus its last-run stamp (the surface shows both). */
export type ManagerConfigRowWithMeta = ManagerConfigRow & { lastRunAt: Date | null };

/** Load a project's manager config row (null when it has none → tenant default). */
export async function getManagerConfigRow(
  db: Db, tenantId: number, projectId: number,
): Promise<ManagerConfigRowWithMeta | null> {
  const [row] = await db
    .select({
      managerRef: projectManagerConfigs.managerRef,
      enabled: projectManagerConfigs.enabled,
      prMergePolicy: projectManagerConfigs.prMergePolicy,
      autoAssign: projectManagerConfigs.autoAssign,
      autoBusinessValue: projectManagerConfigs.autoBusinessValue,
      autoPrioritize: projectManagerConfigs.autoPrioritize,
      lastRunAt: projectManagerConfigs.lastRunAt,
    })
    .from(projectManagerConfigs)
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** The effective (row-over-default) policy for a project. */
export async function getEffectiveManagerPolicy(
  db: Db, tenantId: number, projectId: number,
): Promise<EffectiveManagerPolicy> {
  return resolveEffectiveManagerPolicy(await getManagerConfigRow(db, tenantId, projectId));
}

/** Upsert a project's manager config (the designation + policy). */
export async function upsertManagerConfig(
  db: Db,
  tenantId: number,
  projectId: number,
  patch: Partial<Pick<ManagerConfigRow, 'managerRef' | 'enabled' | 'prMergePolicy' | 'autoAssign' | 'autoBusinessValue' | 'autoPrioritize'>>,
): Promise<ManagerConfigRow> {
  const now = new Date();
  await db
    .insert(projectManagerConfigs)
    .values({
      tenantId, projectId,
      managerRef: patch.managerRef ?? null,
      enabled: patch.enabled ?? true,
      prMergePolicy: patch.prMergePolicy ?? 'immediate',
      autoAssign: patch.autoAssign ?? true,
      autoBusinessValue: patch.autoBusinessValue ?? true,
      autoPrioritize: patch.autoPrioritize ?? true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectManagerConfigs.tenantId, projectManagerConfigs.projectId],
      set: {
        ...(patch.managerRef !== undefined ? { managerRef: patch.managerRef } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.prMergePolicy !== undefined ? { prMergePolicy: patch.prMergePolicy } : {}),
        ...(patch.autoAssign !== undefined ? { autoAssign: patch.autoAssign } : {}),
        ...(patch.autoBusinessValue !== undefined ? { autoBusinessValue: patch.autoBusinessValue } : {}),
        ...(patch.autoPrioritize !== undefined ? { autoPrioritize: patch.autoPrioritize } : {}),
        updatedAt: now,
      },
    });
  return (await getManagerConfigRow(db, tenantId, projectId))!;
}

/** Append a manager decision to the audit feed. Best-effort. */
export async function recordManagerAction(
  db: Db,
  a: { tenantId: number; projectId: number; taskId?: number | null; actionType: string; summary: string; detail?: unknown },
): Promise<void> {
  try {
    await db.insert(managerActions).values({
      tenantId: a.tenantId,
      projectId: a.projectId,
      taskId: a.taskId ?? null,
      actionType: a.actionType,
      summary: a.summary.slice(0, 500),
      detail: a.detail !== undefined ? JSON.stringify(a.detail).slice(0, 4000) : null,
    });
  } catch {
    /* the audit feed is best-effort — a write miss must not fail the pass */
  }
}

/** The newest manager actions for a project (the activity feed). */
export async function listManagerActions(
  db: Db, tenantId: number, projectId: number, limit = 50,
): Promise<Array<{ id: string; taskId: number | null; actionType: string; summary: string; detail: string | null; createdAt: Date }>> {
  return db
    .select({
      id: managerActions.id, taskId: managerActions.taskId, actionType: managerActions.actionType,
      summary: managerActions.summary, detail: managerActions.detail, createdAt: managerActions.createdAt,
    })
    .from(managerActions)
    .where(and(eq(managerActions.tenantId, tenantId), eq(managerActions.projectId, projectId)))
    .orderBy(desc(managerActions.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
}

// ── the pass ────────────────────────────────────────────────────────────────

interface ManagedTaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  businessValue: number | null;
  businessValueSource: string | null;
  dueDate: Date | null;
  storyPoints: number | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  gitBranch: string | null;
  githubPrUrl: string | null;
  createdAt: Date;
}

async function loadManagedTasks(db: Db, projectId: number): Promise<ManagedTaskRow[]> {
  return db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status,
      priority: tasks.priority, businessValue: tasks.businessValue, businessValueSource: tasks.businessValueSource,
      dueDate: tasks.dueDate, storyPoints: tasks.storyPoints,
      assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef,
      assignedAgentHostId: tasks.assignedAgentHostId, gitBranch: tasks.gitBranch, githubPrUrl: tasks.githubPrUrl,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL)))
    .orderBy(asc(tasks.createdAt))
    .limit(MAX_RANKED);
}

function toRankable(t: ManagedTaskRow): RankableTask {
  return {
    taskId: t.id,
    priority: (['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium') as TaskPriorityTier,
    businessValue: t.businessValue,
    dueDate: t.dueDate,
    status: t.status,
    createdAt: t.createdAt,
  };
}

/**
 * Run the manager pass for one project. `submittedBy` labels dispatched runs (e.g.
 * 'system:manager-cron' or 'manager:<userId>'). Returns a summary of what it did.
 */
export async function runManagerForProject(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; submittedBy?: string },
): Promise<ManagerRunSummary> {
  const { tenantId, projectId } = args;
  const submittedBy = args.submittedBy ?? 'system:manager';
  const summary: ManagerRunSummary = {
    projectId, skipped: false, scored: 0, ranked: 0, assigned: 0, prsConducted: 0, prsMerged: 0, dispatched: 0,
    audited: 0, flagged: 0,
  };

  const policy = await getEffectiveManagerPolicy(db, tenantId, projectId);
  if (!policy.enabled) return { ...summary, skipped: true, reason: 'disabled' };

  const now = Date.now();
  let managed = await loadManagedTasks(db, projectId);

  // 1. VALUE — backfill business value on unscored, non-manual tickets. ---------
  if (policy.autoBusinessValue) {
    const unscored = managed.filter((t) => t.businessValue == null && t.businessValueSource !== 'manual');
    let aiBudget = MAX_AI_SCORES_PER_RUN;
    for (const t of unscored) {
      try {
        const scored = aiBudget > 0
          ? (await scoreBusinessValueAI(env, { title: t.title, description: t.description }))
          : null;
        if (scored) aiBudget -= 1;
        const value = scored ?? heuristicBusinessValue(toRankable(t), now, t.storyPoints);
        await db.update(tasks)
          .set({ businessValue: value.score, businessValueRationale: value.rationale, businessValueSource: value.source, updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        // Reflect locally so ranking below sees the fresh score.
        t.businessValue = value.score;
        summary.scored += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, actionType: 'score_value',
          summary: `Scored business value ${value.score}/100 — ${value.rationale}`,
          detail: { score: value.score, source: value.source },
        });
      } catch { /* skip this ticket */ }
    }
  }

  // 2. RANK — order the backlog and persist manager_rank. -----------------------
  if (policy.autoPrioritize && managed.length > 0) {
    const ranked = rankBacklog(managed.map(toRankable), now);
    for (const r of ranked) {
      try {
        await db.update(tasks).set({ managerRank: r.rank }).where(eq(tasks.id, r.taskId));
      } catch { /* skip */ }
    }
    summary.ranked = ranked.length;
    const top = ranked.slice(0, 5).map((r) => {
      const t = managed.find((m) => m.id === r.taskId);
      return { rank: r.rank, taskId: r.taskId, title: t?.title ?? '', score: r.score };
    });
    await recordManagerAction(db, {
      tenantId, projectId, actionType: 'prioritize',
      summary: `Ranked ${ranked.length} tickets by priority × value × urgency.`,
      detail: { top },
    });
  }

  // 3. ASSIGN — give unowned runnable tickets to the best-fit teammate/agent. ----
  if (policy.autoAssign) {
    const unowned = managed
      .filter((t) => RUNNABLE.includes(t.status) && !t.assignedUserId && !t.assignedAgentRef && t.assignedAgentHostId == null)
      .slice(0, MAX_ASSIGNMENTS_PER_RUN);
    for (const t of unowned) {
      try {
        const pick = await recommendTopAssignee(env, db, projectId, []);
        if (!pick) continue;
        const set: Record<string, unknown> = { assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null, updatedAt: new Date() };
        let label = '';
        if (pick.memberKind === 'human') { set.assignedUserId = pick.memberRef; label = `teammate ${pick.memberRef}`; }
        else if (pick.memberKind === 'cloud_agent') { set.assignedAgentRef = pick.memberRef; label = `agent ${pick.memberRef}`; }
        else { const hid = Number(pick.memberRef); if (Number.isFinite(hid)) { set.assignedAgentHostId = hid; label = `host agent ${hid}`; } }
        if (!label) continue;
        await db.update(tasks).set(set).where(eq(tasks.id, t.id));
        summary.assigned += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, actionType: 'assign',
          summary: `Assigned "${t.title}" to ${label}.`,
          detail: { memberKind: pick.memberKind, memberRef: pick.memberRef },
        });
      } catch { /* skip */ }
    }
  }

  // 4. PR — conduct (open) PRs for finished work, then merge/close per policy. ---
  await coordinatePullRequests(env, db, runtimeService, { tenantId, projectId, policy, managed, summary });

  // 5. DISPATCH — kick the top-ranked runnable tickets NOW, in priority order. ---
  // Re-read so rank + fresh assignments are reflected; the dispatcher (idempotent)
  // still gates each ticket on gate/capability/live-run.
  const runnable = await db
    .select({ id: tasks.id, status: tasks.status, managerRank: tasks.managerRank })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId), eq(tasks.archived, false), inArray(tasks.status, RUNNABLE),
      or(sql`${tasks.assignedAgentRef} is not null`, sql`${tasks.assignedAgentHostId} is not null`),
    ))
    .orderBy(sql`${tasks.managerRank} asc nulls last`, asc(tasks.updatedAt))
    .limit(MAX_DISPATCHES_PER_RUN);
  for (const t of runnable) {
    try {
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId, projectId, taskId: t.id, status: t.status, submittedBy,
      });
      if (started) {
        summary.dispatched += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, actionType: 'dispatch',
          summary: `Started work on ticket #${t.id} (rank ${t.managerRank ?? '—'}).`,
        });
      }
    } catch { /* skip */ }
  }

  // 6. AUDIT — check each managed ticket for role/diagnostic coverage and flag any
  // that skipped a required role or diagnostic (pillar 1). Recomputes the ticket
  // audit ledger; flagged tickets already recorded a 'flag' manager action inside.
  {
    const auditService = new TicketAuditService(db);
    for (const t of managed.slice(0, MAX_AUDITS_PER_RUN)) {
      try {
        const result = await auditService.computeAudit(env, tenantId, t.id);
        summary.audited += 1;
        if (result.status === 'flagged') summary.flagged += 1;
      } catch { /* skip this ticket */ }
    }
  }

  // Stamp the run so the surface + cadence can show "last managed …".
  await db.update(projectManagerConfigs)
    .set({ lastRunAt: new Date() })
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .catch(() => {});

  return summary;
}

/**
 * PR coordination for one project:
 *   • CONDUCT — a finished-but-parked ticket (in review, has a branch, no PR, no live
 *     run) gets advanced to Done under any non-'queue' policy, opening its PR through
 *     the shared finalize path.
 *   • MERGE   — open PRs are merged + closed per policy: 'immediate' merges now,
 *     'on_green' merges only once CI is green, 'queue' leaves them for a human.
 */
async function coordinatePullRequests(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: {
    tenantId: number; projectId: number; policy: EffectiveManagerPolicy;
    managed: ManagedTaskRow[]; summary: ManagerRunSummary;
  },
): Promise<void> {
  const { tenantId, projectId, policy, managed, summary } = ctx;

  // CONDUCT: open PRs for review-complete cloud tickets (skip under 'queue').
  if (policy.prMergePolicy !== 'queue') {
    const reviewReady = managed
      .filter((t) => t.status === TaskStatus.IN_REVIEW && t.assignedAgentRef && t.gitBranch && !t.githubPrUrl)
      .slice(0, MAX_PR_ACTIONS_PER_RUN);
    for (const t of reviewReady) {
      try {
        const execs = await runtimeService.listByTask(t.id);
        const hasLive = execs.map((e) => e.toPlain()).some((e) => ACTIVE_EXEC.has(e.status));
        if (hasLive) continue; // still working — leave it
        await db.update(tasks)
          .set({ status: TaskStatus.DONE, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        await dispatchTaskFinalize(env as never, db, tenantId, t.id, {
          assignedAgentHostId: t.assignedAgentHostId,
          assignedAgentRef: t.assignedAgentRef,
          gitBranch: t.gitBranch,
          githubPrUrl: t.githubPrUrl,
          title: t.title,
        });
        summary.prsConducted += 1;
        await recordManagerAction(db, {
          tenantId, projectId, taskId: t.id, actionType: 'flag',
          summary: `Review complete — opened PR for "${t.title}".`,
        });
      } catch { /* skip */ }
    }
  }

  // MERGE + CLOSE open PRs per policy.
  if (policy.prMergePolicy === 'queue') return;
  const openPrs = await db
    .select({ id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId, buildStatus: pullRequests.buildStatus })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.projectId, projectId), eq(pullRequests.status, 'open')))
    .limit(MAX_PR_ACTIONS_PER_RUN);
  for (const pr of openPrs) {
    try {
      // 'on_green' waits for CI to pass; the green-CI webhook also merges, so this is
      // just the manager catching any it missed.
      if (policy.prMergePolicy === 'on_green' && pr.buildStatus !== 'success') continue;
      const result = await mergeRecordedPullRequest(db, env, {
        tenantId, prId: pr.id, method: 'squash', mergedBy: `manager:${policy.managerRef ?? 'system'}`,
      });
      if (!result.ok) {
        await recordManagerAction(db, {
          tenantId, projectId, taskId: pr.taskId, actionType: 'flag',
          summary: `Could not merge PR #${pr.number ?? '?'}: ${result.error}`,
          detail: { code: result.code },
        });
        continue;
      }
      summary.prsMerged += 1;
      // Ticket completion now happens inside mergeRecordedPullRequest (the shared
      // merge core), so the manager, the human "Approve & Merge" and the green-CI
      // auto-merge all complete the ticket via the ONE completeTaskOnMerge path —
      // which also records the lifecycle transition/DORA the old direct update skipped.
      await recordManagerAction(db, {
        tenantId, projectId, taskId: pr.taskId, actionType: 'merge_pr',
        summary: `Merged & closed PR #${pr.number ?? '?'}${result.merged ? '' : ' (already up to date)'} — ticket done.`,
        detail: { sha: result.sha },
      });
    } catch { /* skip */ }
  }
}

/**
 * A project is "auto-staffed" when its board has ANY swimlane agent assignment —
 * used by the sweep as a cheap superset filter for projects the manager should even
 * look at when there is no explicit config row. (A project with an explicit enabled
 * config always qualifies regardless.)
 */
export async function projectHasBoardStaffing(db: Db, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(swimlaneAgentAssignments)
    .innerJoin(swimlanes, eq(swimlanes.id, swimlaneAgentAssignments.swimlaneId))
    .innerJoin(boards, eq(boards.id, swimlanes.boardId))
    .where(eq(boards.projectId, projectId))
    .limit(1);
  return !!row;
}
