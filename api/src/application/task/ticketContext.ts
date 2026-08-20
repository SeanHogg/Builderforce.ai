/**
 * Ticket CONTEXT — the "why does this ticket matter, and how far along is it"
 * read behind the ticket drawer's header.
 *
 * The board card already tells an operator more than the open ticket did: it
 * carries the flag, the sign-off rollup, the PRD count and the business value,
 * while the drawer showed description + a flat field list. Worse, the three
 * questions a manager actually asks on opening a ticket — *is this part of an
 * Epic and how far along is that Epic? how complete is THIS ticket? which
 * objective does it serve and how much of that objective rides on it?* — were
 * answerable only by leaving the ticket for /pmo.
 *
 * This module answers all three in ONE cached read by joining what already
 * exists: the task tree (Epic ↔ children), the board's swimlane ordinals (lane N
 * of M), the coordinated-role manifest (sign-off %), and the OKR lineage
 * (`objective_links` → objectives → key results). Nothing new is instrumented.
 *
 * Objective lineage walks the SAME precedence the planning spine uses — the
 * nearest declared link wins:
 *   1. `task`       — this ticket is linked to the objective directly
 *   2. `epic`       — its parent Epic is linked (the ticket inherits)
 *   3. `project`    — an objective scoped to this ticket's project (0268)
 *   4. `initiative` — an objective on the initiative this project rolls up to
 */
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  initiatives, keyResults, objectiveLinks, objectives, projects, tasks,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isDoneLane, isDoneStatus } from '../../domain/shared/doneClass';
import { keyResultProgress, objectiveProgress } from '../pmo/portfolioRollup';
import { loadLaneOrdinals, type OrdinalMap } from './taskLifecycle';
import { TicketParticipantsService } from '../kanban/ticketParticipants';

// ── Wire types ───────────────────────────────────────────────────────────────

/** One contributing signal behind a ticket's headline %-complete. */
export interface CompletionBasis {
  /** Which signal: board position, required sign-offs, or child work items. */
  kind: 'lane' | 'signoff' | 'children';
  percent: number;
  /** Weight this signal carried in the headline number (0..1). */
  weight: number;
  /** Raw counts so the UI can render "4 of 9" rather than only a percentage. */
  done: number;
  total: number;
}

export interface TicketCompletion {
  percent: number;
  laneKey: string;
  /** 0-based index of this ticket's lane among the board's ordered lanes. */
  laneIndex: number;
  laneCount: number;
  isTerminal: boolean;
  basis: CompletionBasis[];
}

/** A parent Epic (or this ticket's own children when IT is the Epic). */
export interface TicketEpicRollup {
  id: number;
  key: string;
  title: string;
  status: string;
  /** Non-archived children of the Epic. */
  total: number;
  done: number;
  percent: number;
}

export interface TicketKeyResult {
  id: string;
  title: string;
  status: string;
  unit: string | null;
  currentValue: number;
  targetValue: number;
  /** 0..100. */
  percent: number;
}

export interface TicketObjective {
  id: string;
  title: string;
  status: string;
  period: string | null;
  /** 0..100 — mean attainment of the objective's key results. */
  percent: number;
  /** How this ticket reaches the objective (nearest link wins). */
  via: 'task' | 'epic' | 'project' | 'initiative';
  /** Human anchor for `via`: the Epic's title, the initiative's name, etc. */
  viaLabel: string | null;
  keyResults: TicketKeyResult[];
  /** Delivery linked to this objective, so "how much of it rides on me" is real. */
  linkedTaskCount: number;
  linkedTaskDone: number;
  /** This ticket's share of the objective's linked delivery, 0..100. */
  sharePercent: number;
}

export interface TicketContext {
  taskId: number;
  projectId: number;
  completion: TicketCompletion;
  signoff: { completed: number; required: number; percent: number; gaps: number; outstandingRoles: string[] };
  /** The Epic this ticket belongs to, with ITS rollup. Null when top-level. */
  epic: TicketEpicRollup | null;
  /** This ticket's own children rollup — set only when the ticket IS an Epic. */
  children: TicketEpicRollup | null;
  objectives: TicketObjective[];
}

// ── Pure math (unit-tested) ──────────────────────────────────────────────────

const pct = (done: number, total: number): number => (total <= 0 ? 0 : Math.round((done / total) * 100));

/**
 * Where a lane sits in its board's declared sequence, as {index, count}.
 *
 * Lanes are ranked by `position` (deduped — two lanes may share a position), so
 * the answer is "stage N of M on THIS board" rather than a guess from the status
 * string. A project with no board yet (or a free-form status matching no lane)
 * returns index -1 / count 0, and the caller falls back to the other signals.
 */
export function laneRank(status: string, ordinals: OrdinalMap): { index: number; count: number } {
  const positions = [...new Set(Object.values(ordinals).map((l) => l.position))].sort((a, b) => a - b);
  const lane = ordinals[status];
  if (!lane || positions.length === 0) return { index: -1, count: positions.length };
  return { index: positions.indexOf(lane.position), count: positions.length };
}

/**
 * Fold the available signals into ONE headline %-complete, and return the parts.
 *
 * Precedence is deliberate:
 *  - A terminal lane is 100%, full stop. Nothing outranks "it shipped".
 *  - An EPIC is its children. A container is exactly as done as the work inside
 *    it, so lane position is not blended in (an Epic parked in `in_progress`
 *    with 9/10 children done is 90% done, not 40%).
 *  - Otherwise: board position and required sign-offs weigh equally. Lane
 *    position alone over-reports (a ticket in the last lane with zero of ten
 *    sign-offs is not 90% done — the ticket in the screenshot that prompted
 *    this); sign-offs alone under-report early, honest work.
 */
export function computeCompletion(input: {
  status: string;
  ordinals: OrdinalMap;
  isEpic: boolean;
  childDone: number;
  childTotal: number;
  signoffCompleted: number;
  signoffRequired: number;
}): TicketCompletion {
  const { status, ordinals, isEpic, childDone, childTotal, signoffCompleted, signoffRequired } = input;
  const { index, count } = laneRank(status, ordinals);
  const isTerminal = isDoneLane(status, ordinals);
  // Lane progress spans first → last lane, so the first lane is 0% and the last
  // is 100%. A single-lane board (or an unmatched status) contributes nothing.
  const lanePercent = isTerminal ? 100 : index < 0 || count < 2 ? 0 : Math.round((index / (count - 1)) * 100);
  const laneBasis: CompletionBasis = {
    kind: 'lane', percent: lanePercent, weight: 0, done: index < 0 ? 0 : index + 1, total: count,
  };

  if (isTerminal) {
    return { percent: 100, laneKey: status, laneIndex: index, laneCount: count, isTerminal, basis: [{ ...laneBasis, weight: 1 }] };
  }

  const basis: CompletionBasis[] = [];
  if (isEpic && childTotal > 0) {
    basis.push({ kind: 'children', percent: pct(childDone, childTotal), weight: 1, done: childDone, total: childTotal });
  } else if (signoffRequired > 0) {
    basis.push({ ...laneBasis, weight: 0.5 });
    basis.push({ kind: 'signoff', percent: pct(signoffCompleted, signoffRequired), weight: 0.5, done: signoffCompleted, total: signoffRequired });
  } else if (index >= 0 && count >= 2) {
    basis.push({ ...laneBasis, weight: 1 });
  }

  const percent = basis.length === 0
    ? 0
    : Math.round(basis.reduce((sum, b) => sum + b.percent * b.weight, 0));

  return { percent, laneKey: status, laneIndex: index, laneCount: count, isTerminal, basis };
}

/** Roll a set of child statuses up into {total, done, percent}. */
export function rollupChildren(statuses: string[], ordinals: OrdinalMap): { total: number; done: number; percent: number } {
  const done = statuses.filter((s) => isDoneLane(s, ordinals)).length;
  return { total: statuses.length, done, percent: pct(done, statuses.length) };
}

/** Nearest-link-wins precedence for objective lineage (lower = closer). */
const VIA_RANK: Record<TicketObjective['via'], number> = { task: 0, epic: 1, project: 2, initiative: 3 };

/**
 * Collapse every route from a ticket to an objective down to the nearest one, so
 * an objective linked BOTH directly and through the project appears once, tagged
 * `task`. Preserves input order among equally-near links.
 */
export function pickNearestLineage<T extends { id: string; via: TicketObjective['via'] }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const seen = best.get(row.id);
    if (!seen || VIA_RANK[row.via] < VIA_RANK[seen.via]) best.set(row.id, row);
  }
  return [...best.values()];
}

// ── Loader ───────────────────────────────────────────────────────────────────

interface LineageSeed { id: string; via: TicketObjective['via']; viaLabel: string | null }

/**
 * Assemble a ticket's context. Returns null when the task does not exist in this
 * tenant — the caller 404s. Every sub-read is either a PK/indexed lookup or an
 * already-cached service call, and the whole payload is cached by the route on a
 * composite version token (task tree + participants + PMO).
 */
export async function buildTicketContext(
  db: Db,
  env: Env,
  input: { tenantId: number; segmentId: string | null; taskId: number },
): Promise<TicketContext | null> {
  const { tenantId, segmentId, taskId } = input;

  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      status: tasks.status,
      taskType: tasks.taskType,
      parentTaskId: tasks.parentTaskId,
      initiativeId: projects.initiativeId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!task) return null;

  const isEpic = task.taskType === 'epic';

  // Board layout (shared cached loader), the accountability rollup (cached on its
  // own version token), and the Epic/child rows — all independent, so fan out once.
  const [ordinals, accountability, epicRow, childRows, siblingRows] = await Promise.all([
    loadLaneOrdinals(env, db, task.projectId),
    new TicketParticipantsService(db).getAccountability(env, tenantId, taskId).catch(() => null),
    task.parentTaskId == null
      ? Promise.resolve([])
      : db.select({ id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status })
          .from(tasks).where(scopedToTenant(tasks, tenantId, eq(tasks.id, task.parentTaskId))).limit(1),
    isEpic
      ? db.select({ status: tasks.status }).from(tasks)
          .where(scopedToTenant(tasks, tenantId, eq(tasks.parentTaskId, taskId), eq(tasks.archived, false)))
      : Promise.resolve([] as { status: string }[]),
    task.parentTaskId == null
      ? Promise.resolve([] as { status: string }[])
      : db.select({ status: tasks.status }).from(tasks)
          .where(scopedToTenant(tasks, tenantId, eq(tasks.parentTaskId, task.parentTaskId), eq(tasks.archived, false))),
  ]);

  const ownChildren = rollupChildren(childRows.map((r) => r.status), ordinals);
  const completion = computeCompletion({
    status: task.status,
    ordinals,
    isEpic,
    childDone: ownChildren.done,
    childTotal: ownChildren.total,
    signoffCompleted: accountability?.completedCount ?? 0,
    signoffRequired: accountability?.requiredCount ?? 0,
  });

  const parent = epicRow[0] ?? null;
  const parentRollup = rollupChildren(siblingRows.map((r) => r.status), ordinals);

  return {
    taskId,
    projectId: task.projectId,
    completion,
    signoff: {
      completed: accountability?.completedCount ?? 0,
      required: accountability?.requiredCount ?? 0,
      percent: accountability?.percentComplete ?? 100,
      // `gaps` counts only BLOCKING gaps (unstaffed / changes requested / rubber-stamped
      // approval / unreasoned waiver). Slots merely not signed off yet are already
      // reported by `completed`/`required` and by `outstandingRoles` — counting them
      // here too made every in-flight ticket read as if something had gone wrong.
      gaps: (accountability?.gaps ?? []).filter((g) => g.severity === 'blocking').length,
      // The roles actually holding the ticket up — the drawer lists them inline so
      // "who am I waiting on" needs no trip to the Sign-off tab. Deduped: the same role
      // can hold two slots (owner + reviewer) and listing it twice reads as a bug.
      outstandingRoles: [...new Set((accountability?.gaps ?? [])
        .filter((g) => g.kind === 'unsigned' || g.kind === 'unstaffed' || g.kind === 'changes_requested')
        .map((g) => g.roleName))],
    },
    epic: parent
      ? { id: parent.id, key: parent.key, title: parent.title, status: parent.status, ...parentRollup }
      : null,
    children: isEpic ? { id: taskId, key: '', title: '', status: task.status, ...ownChildren } : null,
    objectives: await loadObjectiveLineage(db, {
      tenantId,
      segmentId,
      taskId,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      parentTitle: parent?.title ?? null,
      initiativeId: task.initiativeId,
      ordinals,
    }),
  };
}

/**
 * Every objective this ticket serves, nearest link first, each with its own
 * attainment AND the ticket's share of the delivery hanging off it.
 *
 * `sharePercent` is the honest version of "how important is this ticket to the
 * objective": one of four linked tickets is 25% of what the objective is waiting
 * on. When the ticket inherits the objective through its project/initiative
 * rather than a delivery link, there is no share to claim and it reads 0.
 */
async function loadObjectiveLineage(
  db: Db,
  o: {
    tenantId: number; segmentId: string | null; taskId: number; projectId: number;
    parentTaskId: number | null; parentTitle: string | null; initiativeId: string | null;
    ordinals: OrdinalMap;
  },
): Promise<TicketObjective[]> {
  const taskIds = [o.taskId, ...(o.parentTaskId != null ? [o.parentTaskId] : [])];
  // Segment scope, applied EXACTLY as the PMO reads apply it (portfolioRollup /
  // pmoRoutes), so the objectives a ticket claims to serve are the same ones /pmo
  // shows. A single-mode tenant carries no segment and every row is in scope.
  const linkSegment = o.segmentId == null ? undefined : eq(objectiveLinks.segmentId, o.segmentId);
  const objSegment = o.segmentId == null ? undefined : eq(objectives.segmentId, o.segmentId);

  // Links reaching this ticket: its own, its Epic's, and (when the project rolls
  // up to one) the initiative's. One query — the alternative is three round-trips
  // for a strictly smaller result set.
  const linkFilters = [inArray(objectiveLinks.taskId, taskIds)];
  if (o.initiativeId != null) linkFilters.push(eq(objectiveLinks.initiativeId, o.initiativeId));

  const [linkRows, scopedRows, initiativeRow] = await Promise.all([
    db.select({ objectiveId: objectiveLinks.objectiveId, linkKind: objectiveLinks.linkKind, taskId: objectiveLinks.taskId })
      .from(objectiveLinks)
      .where(and(eq(objectiveLinks.tenantId, o.tenantId), linkSegment, or(...linkFilters))),
    // Scope-declared objectives (0268): owned by the project, or by the initiative
    // the project rolls up to — no link row needed.
    db.select({ id: objectives.id, projectId: objectives.projectId, initiativeId: objectives.initiativeId })
      .from(objectives)
      .where(and(
        eq(objectives.tenantId, o.tenantId),
        objSegment,
        o.initiativeId != null
          ? or(eq(objectives.projectId, o.projectId), eq(objectives.initiativeId, o.initiativeId))
          : eq(objectives.projectId, o.projectId),
      )),
    o.initiativeId == null
      ? Promise.resolve([] as { name: string }[])
      : db.select({ name: initiatives.name }).from(initiatives).where(scopedToTenant(initiatives, o.tenantId, eq(initiatives.id, o.initiativeId))).limit(1),
  ]);

  const seeds: LineageSeed[] = [];
  for (const l of linkRows) {
    if (l.taskId === o.taskId) seeds.push({ id: l.objectiveId, via: 'task', viaLabel: null });
    else if (l.taskId != null && l.taskId === o.parentTaskId) seeds.push({ id: l.objectiveId, via: 'epic', viaLabel: o.parentTitle });
    else seeds.push({ id: l.objectiveId, via: 'initiative', viaLabel: initiativeRow[0]?.name ?? null });
  }
  for (const s of scopedRows) {
    if (s.projectId === o.projectId) seeds.push({ id: s.id, via: 'project', viaLabel: null });
    else seeds.push({ id: s.id, via: 'initiative', viaLabel: initiativeRow[0]?.name ?? null });
  }

  const nearest = pickNearestLineage(seeds);
  if (nearest.length === 0) return [];
  const ids = nearest.map((s) => s.id);

  // Objective headers, their key results, and the delivery linked to them — the
  // last one is what turns "linked to an objective" into "1 of 4 tickets it waits on".
  const [objRows, krRows, deliveryRows] = await Promise.all([
    db.select({
      id: objectives.id, title: objectives.title, status: objectives.status, period: objectives.period,
    }).from(objectives).where(and(eq(objectives.tenantId, o.tenantId), inArray(objectives.id, ids))),
    db.select({
      id: keyResults.id, objectiveId: keyResults.objectiveId, title: keyResults.title, status: keyResults.status,
      metricType: keyResults.metricType, startValue: keyResults.startValue, targetValue: keyResults.targetValue,
      currentValue: keyResults.currentValue, unit: keyResults.unit,
    }).from(keyResults).where(and(eq(keyResults.tenantId, o.tenantId), inArray(keyResults.objectiveId, ids))),
    db.select({ objectiveId: objectiveLinks.objectiveId, status: tasks.status })
      .from(objectiveLinks)
      .innerJoin(tasks, eq(tasks.id, objectiveLinks.taskId))
      .where(and(
        eq(objectiveLinks.tenantId, o.tenantId),
        inArray(objectiveLinks.objectiveId, ids),
        isNotNull(objectiveLinks.taskId),
        eq(tasks.archived, false),
      )),
  ]);

  const krByObjective = new Map<string, TicketKeyResult[]>();
  const progressByObjective = new Map<string, number[]>();
  for (const kr of krRows) {
    const fraction = keyResultProgress(kr);
    const progress = progressByObjective.get(kr.objectiveId) ?? [];
    progress.push(fraction);
    progressByObjective.set(kr.objectiveId, progress);
    const list = krByObjective.get(kr.objectiveId) ?? [];
    list.push({
      id: kr.id, title: kr.title, status: kr.status, unit: kr.unit,
      currentValue: kr.currentValue, targetValue: kr.targetValue,
      percent: Math.round(fraction * 100),
    });
    krByObjective.set(kr.objectiveId, list);
  }

  const deliveryByObjective = new Map<string, { total: number; done: number }>();
  for (const d of deliveryRows) {
    const agg = deliveryByObjective.get(d.objectiveId) ?? { total: 0, done: 0 };
    agg.total += 1;
    if (isDoneLane(d.status, o.ordinals) || isDoneStatus(d.status)) agg.done += 1;
    deliveryByObjective.set(d.objectiveId, agg);
  }

  const byId = new Map(objRows.map((r) => [r.id, r]));
  return nearest
    .filter((s) => byId.has(s.id))
    .map((s) => {
      const row = byId.get(s.id)!;
      const delivery = deliveryByObjective.get(s.id) ?? { total: 0, done: 0 };
      // Only a DELIVERY link (this ticket or its Epic) earns a share of the objective.
      const counted = s.via === 'task' || s.via === 'epic';
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        period: row.period,
        percent: Math.round(objectiveProgress(progressByObjective.get(s.id) ?? []) * 100),
        via: s.via,
        viaLabel: s.viaLabel,
        keyResults: krByObjective.get(s.id) ?? [],
        linkedTaskCount: delivery.total,
        linkedTaskDone: delivery.done,
        sharePercent: counted && delivery.total > 0 ? Math.round((1 / delivery.total) * 100) : 0,
      };
    })
    .sort((a, b) => VIA_RANK[a.via] - VIA_RANK[b.via]);
}
