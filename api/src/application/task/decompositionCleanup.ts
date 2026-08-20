/**
 * Decomposition cleanup — a REVIEWABLE list of the rows the old decomposer shredded.
 *
 * {@link checklistItemTitle} now refuses to turn a markdown sub-header into a
 * ticket, but the guard only protects work planned AFTER it shipped. The tickets
 * the pre-guard decomposer already created are still live rows: `**API
 * Endpoints**:` with no content and no owner, `**Data Model**: …` label lines, and
 * paired duplicates from re-running the old `decompose` route, all of them sitting
 * under real Epics and all of them rendering on the planning spine.
 *
 * ── WHY A REVIEW AND NOT A MIGRATION ────────────────────────────────────────
 * A data migration that archived everything matching would be quick and wrong.
 * The rule that flags these rows is a heuristic about TITLES, and a title is not
 * proof: somebody may have renamed a fragment into real work, attached a PR to
 * it, or replied on it. So this module produces CANDIDATES with the evidence
 * attached, and archives only the ids a human explicitly selects. The evidence
 * test is deliberately absolute — a candidate must have NO runs, NO pull requests
 * and NO comments. Anything with a trace of real work attached is not a candidate
 * at all, regardless of how bad its title looks.
 *
 * The pure core ({@link flagCleanupCandidates}) is DB-free and unit-testable;
 * {@link findDecompositionCleanupCandidates} just feeds it rows.
 */

import { and, eq, inArray, isNotNull, like, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { activityLog, executions, pullRequests, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { notSystemTask } from './taskScope';
import { isWorkItemTitle, normalizeChildTitle } from './EpicDecomposer';

/** WHY a row was flagged. Shown to the reviewer verbatim — never inferred in the UI. */
export type CleanupReason = 'not-a-work-item' | 'duplicate-sibling';

/** What the reviewer chose to do with a candidate. */
export type CleanupAction = 'archive' | 'merge';

/**
 * How many children one pass will consider. A cleanup review is something a human
 * reads; past this it is a report, not a worklist, and the unbounded read starts to
 * cost more than the problem.
 */
export const MAX_CLEANUP_CHILDREN = 2000;

/** One child row, with its evidence already counted. */
export interface CleanupChildRow {
  id: number;
  parentTaskId: number;
  title: string;
  status: string;
  createdAt: Date;
  runs: number;
  pullRequests: number;
  comments: number;
}

export interface CleanupCandidate {
  taskId: number;
  taskKey: string | null;
  title: string;
  status: string;
  reason: CleanupReason;
  /** All three are zero by construction — carried so the reviewer SEES the proof. */
  evidence: { runs: number; pullRequests: number; comments: number };
  /** For `duplicate-sibling`: the sibling that is kept. Null otherwise. */
  duplicateOfTaskId: number | null;
}

export interface CleanupGroup {
  epic: {
    id: number;
    key: string | null;
    title: string;
    projectId: number;
    /** 'llm' | 'heuristic' | 'manual' | null — WHICH planner produced this mess. */
    decompositionSource: string | null;
  };
  candidates: CleanupCandidate[];
}

/**
 * Flag the children of ONE Epic. Pure.
 *
 * Two independent rules, in priority order:
 *   1. `not-a-work-item` — the title fails the same guard the parser now applies,
 *      so this row would not be created today.
 *   2. `duplicate-sibling` — an identical title already exists under this parent.
 *      The EARLIEST row wins (lowest createdAt, id as the tie-break) because it is
 *      the one other things are most likely to reference; later copies are the
 *      merge candidates.
 *
 * A row with ANY evidence is dropped from consideration before either rule runs.
 */
export function flagCleanupCandidates(children: readonly CleanupChildRow[]): CleanupCandidate[] {
  // Duplicate detection must run over ALL siblings, not only the evidence-free ones:
  // the surviving copy is whichever came first, even if that copy is the one with a
  // PR attached. Otherwise the review would offer to keep the newer empty duplicate.
  const firstByTitle = new Map<string, CleanupChildRow>();
  for (const child of [...children].sort(
    (a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) || (a.id - b.id),
  )) {
    const key = normalizeChildTitle(child.title);
    if (!firstByTitle.has(key)) firstByTitle.set(key, child);
  }

  const out: CleanupCandidate[] = [];
  for (const child of children) {
    // Anything real is attached to it → not a candidate, whatever its title says.
    if (child.runs > 0 || child.pullRequests > 0 || child.comments > 0) continue;

    const survivor = firstByTitle.get(normalizeChildTitle(child.title));
    const isDuplicate = survivor != null && survivor.id !== child.id;
    const notWork = !isWorkItemTitle(child.title);
    if (!isDuplicate && !notWork) continue;

    out.push({
      taskId: child.id,
      taskKey: null,
      title: child.title,
      status: child.status,
      // "This is not a work item" is the stronger statement: it holds whether or not
      // a twin exists, and it tells the reviewer the row should never have been made.
      reason: notWork ? 'not-a-work-item' : 'duplicate-sibling',
      evidence: { runs: child.runs, pullRequests: child.pullRequests, comments: child.comments },
      duplicateOfTaskId: isDuplicate && !notWork ? survivor!.id : null,
    });
  }
  return out.sort((a, b) => a.taskId - b.taskId);
}

/**
 * Load every candidate in a tenant (optionally one project), grouped by Epic.
 *
 * Evidence is counted in three small grouped reads rather than per row — a
 * per-candidate existence check would be N round trips against a list whose whole
 * point is that it can be long.
 */
export async function findDecompositionCleanupCandidates(
  db: Db,
  tenantId: number,
  opts: { projectId?: number } = {},
): Promise<CleanupGroup[]> {
  const childRows = await db
    .select({
      id: tasks.id,
      key: tasks.key,
      parentTaskId: tasks.parentTaskId,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(scopedToTenant(
      tasks,
      tenantId,
      isNotNull(tasks.parentTaskId),
      eq(tasks.archived, false),
      notSystemTask,
      ...(opts.projectId != null ? [eq(tasks.projectId, opts.projectId)] : []),
    ))
    .orderBy(tasks.id)
    .limit(MAX_CLEANUP_CHILDREN);

  if (childRows.length === 0) return [];
  const childIds = childRows.map((r) => r.id);

  const [runRows, prRows, commentRows] = await Promise.all([
    db.select({ taskId: executions.taskId, n: sql<number>`count(*)::int` })
      .from(executions)
      .where(and(eq(executions.tenantId, tenantId), inArray(executions.taskId, childIds)))
      .groupBy(executions.taskId),
    db.select({ taskId: pullRequests.taskId, n: sql<number>`count(*)::int` })
      .from(pullRequests)
      .where(and(eq(pullRequests.tenantId, tenantId), inArray(pullRequests.taskId, childIds)))
      .groupBy(pullRequests.taskId),
    // Ticket comments live on the ONE activity/audit log (0295) as `comment.*` verbs
    // against a `task` target — there is no per-ticket comment table to count.
    db.select({ targetId: activityLog.targetId, n: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(and(
        eq(activityLog.tenantId, tenantId),
        eq(activityLog.targetType, 'task'),
        inArray(activityLog.targetId, childIds.map((id) => String(id))),
        like(activityLog.verb, 'comment.%'),
      ))
      .groupBy(activityLog.targetId),
  ]);

  const runsBy = new Map(runRows.filter((r) => r.taskId != null).map((r) => [r.taskId as number, Number(r.n)]));
  const prsBy = new Map(prRows.filter((r) => r.taskId != null).map((r) => [r.taskId as number, Number(r.n)]));
  const commentsBy = new Map(commentRows.filter((r) => r.targetId != null).map((r) => [Number(r.targetId), Number(r.n)]));

  const byParent = new Map<number, CleanupChildRow[]>();
  const keyById = new Map<number, string | null>();
  for (const row of childRows) {
    keyById.set(row.id, row.key ?? null);
    const list = byParent.get(row.parentTaskId as number) ?? [];
    list.push({
      id: row.id,
      parentTaskId: row.parentTaskId as number,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
      runs: runsBy.get(row.id) ?? 0,
      pullRequests: prsBy.get(row.id) ?? 0,
      comments: commentsBy.get(row.id) ?? 0,
    });
    byParent.set(row.parentTaskId as number, list);
  }

  const flaggedByParent = new Map<number, CleanupCandidate[]>();
  for (const [parentId, siblings] of byParent) {
    const flagged = flagCleanupCandidates(siblings)
      .map((c) => ({ ...c, taskKey: keyById.get(c.taskId) ?? null }));
    if (flagged.length > 0) flaggedByParent.set(parentId, flagged);
  }
  if (flaggedByParent.size === 0) return [];

  const epicRows = await db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      projectId: tasks.projectId,
      decompositionSource: tasks.decompositionSource,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, inArray(tasks.id, [...flaggedByParent.keys()])));

  return epicRows
    .map((epic) => ({
      epic: {
        id: epic.id,
        key: epic.key ?? null,
        title: epic.title,
        projectId: epic.projectId,
        decompositionSource: epic.decompositionSource ?? null,
      },
      candidates: flaggedByParent.get(epic.id) ?? [],
    }))
    .filter((g) => g.candidates.length > 0)
    .sort((a, b) => b.candidates.length - a.candidates.length);
}

/** ONE reviewer decision. `mergeIntoTaskId` is required for a `merge`. */
export interface CleanupSelection {
  taskId: number;
  action: CleanupAction;
  /** The sibling a duplicate is merged INTO — must be a real sibling of `taskId`. */
  mergeIntoTaskId?: number | null;
}

export interface CleanupApplyResult {
  archived: number[];
  merged: Array<{ taskId: number; intoTaskId: number }>;
  /** Ids the server refused, with why — never silently dropped. */
  rejected: Array<{ taskId: number; reason: string }>;
}

/**
 * Re-verify and apply the reviewer's SELECTED ids.
 *
 * Every id is checked again here against the live rows: the list the reviewer read
 * may be minutes old, and a ticket that has since picked up a run or a PR must not
 * be archived on the strength of a stale screen. Rejections are returned, never
 * swallowed — a cleanup that silently skipped half the selection would be
 * indistinguishable from one that worked.
 *
 * Archiving goes through the caller-supplied `archive` closure, which is the
 * EXISTING `TaskService.updateTask({ archived: true })` path. There is deliberately
 * no second archive implementation in here: two ways to archive a ticket is how the
 * board and the backlog end up disagreeing about what is archived.
 */
export async function applyDecompositionCleanup(
  db: Db,
  tenantId: number,
  selections: readonly CleanupSelection[],
  archive: (taskId: number) => Promise<void>,
  opts: { projectId?: number } = {},
): Promise<CleanupApplyResult> {
  const result: CleanupApplyResult = { archived: [], merged: [], rejected: [] };
  if (selections.length === 0) return result;

  const groups = await findDecompositionCleanupCandidates(db, tenantId, opts);
  const candidateById = new Map<number, { candidate: CleanupCandidate; epicId: number }>();
  const siblingsOfEpic = new Map<number, Set<number>>();
  for (const group of groups) {
    for (const candidate of group.candidates) {
      candidateById.set(candidate.taskId, { candidate, epicId: group.epic.id });
    }
  }

  // Sibling membership for the merge target check — the target need not itself be a
  // candidate (it is usually the survivor we are merging INTO).
  const epicIds = [...new Set([...candidateById.values()].map((v) => v.epicId))];
  if (epicIds.length > 0) {
    const rows = await db
      .select({ id: tasks.id, parentTaskId: tasks.parentTaskId })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, inArray(tasks.parentTaskId, epicIds)));
    for (const row of rows) {
      const set = siblingsOfEpic.get(row.parentTaskId as number) ?? new Set<number>();
      set.add(row.id);
      siblingsOfEpic.set(row.parentTaskId as number, set);
    }
  }

  for (const selection of selections) {
    const found = candidateById.get(selection.taskId);
    if (!found) {
      // Either it was never a candidate, or it stopped being one (someone attached a
      // run/PR/comment since the list was drawn). Both mean: do not touch it.
      result.rejected.push({ taskId: selection.taskId, reason: 'not_a_candidate' });
      continue;
    }
    if (selection.action === 'merge') {
      const into = selection.mergeIntoTaskId ?? found.candidate.duplicateOfTaskId ?? null;
      if (into == null || into === selection.taskId) {
        result.rejected.push({ taskId: selection.taskId, reason: 'merge_target_required' });
        continue;
      }
      if (!(siblingsOfEpic.get(found.epicId)?.has(into) ?? false)) {
        result.rejected.push({ taskId: selection.taskId, reason: 'merge_target_not_a_sibling' });
        continue;
      }
      // A merge candidate carries NO runs, PRs or comments by construction, so there
      // is nothing to re-point: merging IS retiring the empty duplicate in favour of
      // the sibling that already holds the work. The link is recorded so the review
      // is auditable rather than looking like an unexplained archive.
      await archive(selection.taskId);
      result.merged.push({ taskId: selection.taskId, intoTaskId: into });
      continue;
    }
    await archive(selection.taskId);
    result.archived.push(selection.taskId);
  }
  return result;
}
