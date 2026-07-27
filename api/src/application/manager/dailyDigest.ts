/**
 * dailyDigest — the ANSWER to "what did you and the team accomplish today?"
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The Manager surface opened on a wall of BACKLOG-STATE counters: 679 tickets, 373
 * coverage gaps, 390 open PRs. Every one of those is a standing property of the
 * board — none of them is an accomplishment, and none of them changes visibly from
 * one day to the next. A person arriving at the page asking the only question a
 * manager is ever actually asked ("what got done?") could not answer it from the
 * page, and neither could the AI manager whose page it is.
 *
 * The platform already emits every fact required. It emits them into six unjoined
 * places, which is why nobody could read the answer:
 *
 *   1. `tasks.completed_at`         — the REAL moment a ticket entered a done lane
 *                                     (0117), not the updated_at proxy.
 *   2. `task_status_transitions`    — every lane hop, stamped with the MOVER's kind and
 *                                     ref ('human', 'cloud_agent', 'host_agent', or
 *                                     'system' for identity-less automation) and
 *                                     `is_backward`.
 *   3. `executions`                 — the runs, with the agent that ran each one.
 *   4. `pull_requests`              — what actually shipped to a branch (merged_at).
 *   5. `manager_actions`            — what the MANAGER itself decided, by type.
 *   6. `manager_stall_watch`        — what autonomy handed back to a human.
 *
 * Joined on ONE day window they read as a narrative: the manager scored/ranked/
 * assigned/merged N things, the team finished M tickets across K runs, and here is
 * what is still owed a person.
 *
 * ── "TODAY" IS THE READER'S TODAY ────────────────────────────────────────────────
 * A digest that silently means "today in UTC" is wrong for most of the world for
 * most of the day — a person in UTC+10 would watch their morning's work counted as
 * yesterday. The caller passes its UTC offset in minutes and the window is computed
 * from it ({@link dayWindow}), so the day boundary is the one on the reader's clock.
 *
 * ── YESTERDAY IS PART OF THE ANSWER ──────────────────────────────────────────────
 * "3 shipped" means nothing alone. The same queries carry the prior window so every
 * headline number states its own trend, and — the case that matters most — a zero
 * can say whether it is a quiet day or a stopped board.
 *
 * Pure summarisers are exported separately from the IO so the verdict is unit-testable
 * without a database.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  executions, managerActions, managerStallWatch, pullRequests, taskStatusTransitions, tasks,
} from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ExecutionStatus } from '../../domain/shared/types';
import { liveExecution } from '../rehearsal/executionMode';
import { notSystemTask, SYSTEM_TASK_SOURCE_MANAGER } from '../task/taskScope';
import { resolveActorByRef, type ActorType } from '../activity/activityLog';

/** How long a computed digest is served from cache. Short: the day is still moving. */
const DIGEST_TTL_SECONDS = 60;
/** Concrete shipped items carried for the reader. Bounded — the counters are the total. */
const SHIPPED_SAMPLE = 8;
/** Contributors named on the surface. Bounded because each one costs a name lookup. */
export const MAX_CONTRIBUTORS = 6;
/** Escalations shown by name; the count carries the rest. */
const ATTENTION_SAMPLE = 5;

const digestKey = (tenantId: number, projectId: number, dayStartIso: string) =>
  `manager:digest:${tenantId}:${projectId}:${dayStartIso}`;

// ── Wire shape ──────────────────────────────────────────────────────────────

/** A number that carries its own trend, so a headline never states a bare count. */
export interface DigestDelta {
  today: number;
  yesterday: number;
}

/** Who owns a piece of work, in the vocabulary the audit timeline already uses. */
export type DigestOwnerKind = ActorType | 'unassigned';

/** One ticket that actually finished today. */
export interface DigestShippedTicket {
  id: number;
  key: string;
  title: string;
  completedAt: string;
  /** Resolved owner label ('' when the ticket finished with nobody assigned). */
  ownerName: string;
  ownerKind: DigestOwnerKind;
  businessValue: number | null;
}

/**
 * One person or agent who moved work today.
 *
 * The three metrics are DELIBERATELY not summed into a score. They are different
 * units of contribution — a finished ticket, a completed run and a lane hop are not
 * interchangeable — and folding them would invent a ranking the data does not
 * support. The surface shows them side by side and lets a human read them.
 */
export interface DigestContributor {
  /** `${kind}:${ref}` — stable identity for the row and for the merge. */
  id: string;
  kind: ActorType;
  name: string;
  /** Tickets that reached a done lane today with this actor as owner. */
  shipped: number;
  /** Executions that finished today under this actor. */
  runs: number;
  /** Forward lane moves this actor made today. Backward hops are excluded — a redo is
   *  not contribution. Covers people and agents alike; see the merge note. */
  moves: number;
}

/** One decision class the manager exercised today (`manager_actions.action_type`). */
export interface DigestManagerDecision {
  actionType: string;
  count: number;
}

/** Work that is finished as far as autonomy can take it, and now owes a person. */
export interface DigestAttentionItem {
  taskId: number;
  key: string | null;
  title: string | null;
  /** 'escalated' — the manager's own remedies stopped working (0367). */
  reason: 'escalated';
  since: string | null;
}

export interface DailyDigest {
  projectId: number;
  /** The reader's local day, as an absolute instant pair. */
  dayStart: string;
  dayEnd: string;
  /** What the AI MANAGER did — the "you" half of the question. */
  manager: {
    /** Backlog-management passes that completed inside the window. */
    passes: number;
    decisions: DigestDelta;
    byType: DigestManagerDecision[];
    lastRunAt: string | null;
  };
  /** What the TEAM did — humans and agents together, which is how they work. */
  team: {
    shipped: DigestDelta;
    opened: DigestDelta;
    laneMoves: { forward: number; backward: number; byHuman: number; byAgent: number };
    runs: { completed: number; failed: number };
    prs: { merged: DigestDelta; opened: number };
    contributors: DigestContributor[];
  };
  /** The concrete things that finished, newest first (bounded by {@link SHIPPED_SAMPLE}). */
  shipped: DigestShippedTicket[];
  /** What autonomy handed back — the tail of an honest answer. */
  needsAttention: {
    escalatedToday: number;
    openEscalations: number;
    items: DigestAttentionItem[];
  };
  computedAt: string;
}

// ── The day window ──────────────────────────────────────────────────────────

export interface DayWindow {
  start: Date;
  end: Date;
  /** The SAME clock day, one day earlier — the comparison window. */
  prevStart: Date;
}

/**
 * The reader's local day as absolute instants. PURE.
 *
 * `tzOffsetMinutes` is minutes to ADD to UTC to reach local time — i.e. exactly
 * `-new Date().getTimezoneOffset()` in the browser, so the caller never has to invert
 * a sign. Out-of-range or non-finite offsets fall back to UTC rather than producing a
 * nonsense window: a conservative day is better than a wrong one.
 */
export function dayWindow(now: Date, tzOffsetMinutes: number): DayWindow {
  const offset = Number.isFinite(tzOffsetMinutes) && Math.abs(tzOffsetMinutes) <= 14 * 60
    ? Math.round(tzOffsetMinutes)
    : 0;
  const shifted = new Date(now.getTime() + offset * 60_000);
  const localMidnightUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const start = new Date(localMidnightUtc - offset * 60_000);
  return {
    start,
    end: new Date(start.getTime() + 86_400_000),
    prevStart: new Date(start.getTime() - 86_400_000),
  };
}

// ── Pure summarisers ────────────────────────────────────────────────────────

/**
 * The contributor kind a stored `actor_kind` credits, or null when the row names no
 * one. PURE.
 *
 * 'system' is the only kind deliberately dropped — it is automation with no identity,
 * and inventing a "System" contributor would put a row on the leaderboard that nobody
 * can act on. An unrecognised value is treated the same way rather than guessed at.
 */
export function contributorKind(actorKind: string | null | undefined): ActorType | null {
  switch (actorKind) {
    case 'human':
    case 'hire':
    case 'cloud_agent':
    case 'host_agent':
      return actorKind;
    default:
      return null;
  }
}

/** Raw per-actor tallies, before names are resolved. */
export interface ContributorTally {
  kind: ActorType;
  ref: string;
  shipped: number;
  runs: number;
  moves: number;
}

/**
 * Merge the three attribution sources into one ranked contributor set. PURE.
 *
 * Ranking is lexicographic — shipped, then runs, then moves — rather than a weighted
 * sum, for the reason {@link DigestContributor} gives: the units differ, and a total
 * would be a fabricated score. Actors with no contribution at all are dropped so an
 * idle roster never pads the list.
 */
export function rankContributors(
  tallies: Iterable<ContributorTally>,
  limit = MAX_CONTRIBUTORS,
): ContributorTally[] {
  return [...tallies]
    .filter((c) => c.shipped > 0 || c.runs > 0 || c.moves > 0)
    .sort((a, b) => (b.shipped - a.shipped) || (b.runs - a.runs) || (b.moves - a.moves))
    .slice(0, limit);
}

/**
 * Fold the manager's decision rows into ranked classes. PURE.
 *
 * `manager_actions.action_type` is free-form varchar at the database, so an unknown
 * type passes through verbatim rather than being dropped — a decision class added by a
 * later pass must be counted here on the day it ships, not on the day this module
 * learns its name.
 */
export function summarizeDecisions(
  rows: ReadonlyArray<{ actionType: string; count: number }>,
): DigestManagerDecision[] {
  const byType = new Map<string, number>();
  for (const r of rows) {
    if (!r.actionType) continue;
    byType.set(r.actionType, (byType.get(r.actionType) ?? 0) + Number(r.count || 0));
  }
  return [...byType.entries()]
    .map(([actionType, count]) => ({ actionType, count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Did anything at all happen? PURE.
 *
 * The one predicate that decides whether the surface leads with a summary or with
 * "nothing yet today" — kept here so the API and the UI cannot disagree about what an
 * empty day is.
 */
export function isQuietDay(d: DailyDigest): boolean {
  return d.team.shipped.today === 0
    && d.team.laneMoves.forward === 0
    && d.team.runs.completed === 0
    && d.team.runs.failed === 0
    && d.team.prs.merged.today === 0
    && d.manager.decisions.today === 0;
}

// ── IO ──────────────────────────────────────────────────────────────────────

/**
 * What {@link computeDailyDigest} produces: the wire shape, plus the internal
 * identity maps the (separately cached) name-resolution step needs. Kept out of
 * {@link DailyDigest} because an owner REF is an internal id — the surface renders
 * names, and shipping refs to the browser would leak identity it has no use for.
 */
export interface DigestComputation {
  digest: DailyDigest;
  /** Ranked, still-anonymous contributor tallies. */
  tallies: ContributorTally[];
  /** taskId → owner ref, for the sampled shipped rows only. */
  ownerRefs: Map<number, string>;
}

/**
 * Compute the digest for one project + window.
 *
 * Every read is SET-BASED and windowed, so the cost is a fixed handful of round-trips
 * regardless of how many tickets the project holds — the same discipline the stall
 * census follows, and for the same reason: this runs behind a polled dashboard.
 */
export async function computeDailyDigest(
  db: Db,
  args: { tenantId: number; projectId: number; window: DayWindow; lastRunAt?: Date | string | null },
): Promise<DigestComputation> {
  const { tenantId, projectId, window: w } = args;

  /**
   * `[from, to)` on a timestamp column, as an SQL chunk fit for a `filter (where …)`.
   *
   * Built from drizzle's typed operators rather than interpolating the Date directly:
   * a bare `${date}` inside a `sql` template is bound with NO encoder, so it reaches
   * the driver as a raw JS Date and its wire format stops being this module's business.
   * `gte`/`lt` apply the COLUMN's own encoder, which is what makes the comparison mean
   * the same thing as every other timestamp predicate in the codebase.
   */
  const between = (col: PgColumn, from: Date, to: Date): SQL => sql`${gte(col, from)} and ${lt(col, to)}`;
  const today = (col: PgColumn): SQL => between(col, w.start, w.end);
  const yesterday = (col: PgColumn): SQL => between(col, w.prevStart, w.start);

  const [
    ticketCounts, shippedRows, moveRows, execRows, prRow, decisionRows,
    passRow, ownerRows, stallRow, attentionRows,
  ] = await Promise.all([
    // 1. Ticket throughput, both windows, in ONE aggregate.
    db
      .select({
        shippedToday: sql<number>`count(*) filter (where ${today(tasks.completedAt)})::int`,
        shippedPrev: sql<number>`count(*) filter (where ${yesterday(tasks.completedAt)})::int`,
        openedToday: sql<number>`count(*) filter (where ${today(tasks.createdAt)})::int`,
        openedPrev: sql<number>`count(*) filter (where ${yesterday(tasks.createdAt)})::int`,
      })
      .from(tasks)
      // `tasks` carries no tenant_id; the caller has already proven the project belongs
      // to this tenant (the route's ownProject check), which is how every other manager
      // read scopes it.
      .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), notSystemTask))
      .catch(() => []),

    // 2. The concrete items, newest first. Bounded — the count above is the total.
    db
      .select({
        id: tasks.id, key: tasks.key, title: tasks.title, completedAt: tasks.completedAt,
        businessValue: tasks.businessValue,
        assignedUserId: tasks.assignedUserId,
        assignedAgentRef: tasks.assignedAgentRef,
        assignedAgentHostId: tasks.assignedAgentHostId,
      })
      .from(tasks)
      .where(and(
        eq(tasks.projectId, projectId), eq(tasks.archived, false), notSystemTask,
        gte(tasks.completedAt, w.start), lt(tasks.completedAt, w.end),
      ))
      .orderBy(desc(tasks.completedAt))
      .limit(SHIPPED_SAMPLE)
      .catch(() => []),

    // 3. Lane movement, split by who drove it. (`actor_kind`, `actor_ref`) is the only
    //    place in the schema that names the mover of a hop — a person's board drag, a
    //    specific agent's advance, or anonymous automation.
    db
      .select({
        actorKind: taskStatusTransitions.actorKind,
        actorRef: taskStatusTransitions.actorRef,
        forward: sql<number>`count(*) filter (where ${taskStatusTransitions.isBackward} is not true)::int`,
        backward: sql<number>`count(*) filter (where ${taskStatusTransitions.isBackward})::int`,
      })
      .from(taskStatusTransitions)
      .where(scopedToTenant(
        taskStatusTransitions, tenantId,
        eq(taskStatusTransitions.projectId, projectId),
        gte(taskStatusTransitions.occurredAt, w.start),
        lt(taskStatusTransitions.occurredAt, w.end),
      ))
      .groupBy(taskStatusTransitions.actorKind, taskStatusTransitions.actorRef)
      .catch(() => []),

    // 4. Runs that reached a terminal state today, per agent. `coalesce(completed_at,
    //    updated_at)` because a failure path may terminate the row without stamping a
    //    completion — a failed run that vanished from the day would flatter the digest.
    db
      .select({
        cloudAgentRef: executions.cloudAgentRef,
        agentHostId: executions.agentHostId,
        completed: sql<number>`count(*) filter (where ${executions.status} = ${ExecutionStatus.COMPLETED})::int`,
        failed: sql<number>`count(*) filter (where ${executions.status} = ${ExecutionStatus.FAILED})::int`,
      })
      .from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .where(scopedToTenant(
        executions, tenantId,
        eq(tasks.projectId, projectId),
        liveExecution(),
        inArray(executions.status, [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED]),
        // `sql.param` with the column as encoder, for the same reason `between` above
        // exists: the coalesce needs raw SQL, but the bound Date must still be encoded
        // the way a timestamp comparison in this schema is encoded everywhere else.
        sql`coalesce(${executions.completedAt}, ${executions.updatedAt}) >= ${sql.param(w.start, executions.completedAt)}`,
        sql`coalesce(${executions.completedAt}, ${executions.updatedAt}) < ${sql.param(w.end, executions.completedAt)}`,
      ))
      .groupBy(executions.cloudAgentRef, executions.agentHostId)
      .catch(() => []),

    // 5. Pull requests — the only signal that says code left the workspace.
    db
      .select({
        mergedToday: sql<number>`count(*) filter (where ${today(pullRequests.mergedAt)})::int`,
        mergedPrev: sql<number>`count(*) filter (where ${yesterday(pullRequests.mergedAt)})::int`,
        openedToday: sql<number>`count(*) filter (where ${today(pullRequests.createdAt)})::int`,
      })
      .from(pullRequests)
      .where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.projectId, projectId)))
      .catch(() => []),

    // 6. The manager's own decisions, by class, both windows.
    db
      .select({
        actionType: managerActions.actionType,
        today: sql<number>`count(*) filter (where ${today(managerActions.createdAt)})::int`,
        prev: sql<number>`count(*) filter (where ${yesterday(managerActions.createdAt)})::int`,
      })
      .from(managerActions)
      .where(scopedToTenant(
        managerActions, tenantId,
        eq(managerActions.projectId, projectId),
        gte(managerActions.createdAt, w.prevStart),
        lt(managerActions.createdAt, w.end),
      ))
      .groupBy(managerActions.actionType)
      .catch(() => []),

    // 7. Backlog-management passes that finished today — the manager's OWN cards, which
    //    `notSystemTask` deliberately excludes from every delivery count above.
    db
      .select({ passes: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(
        eq(tasks.projectId, projectId), eq(tasks.source, SYSTEM_TASK_SOURCE_MANAGER),
        gte(tasks.completedAt, w.start), lt(tasks.completedAt, w.end),
      ))
      .catch(() => []),

    // 8. Ownership of everything finished today (not just the sampled rows) — the
    //    `shipped` column of the contributor table.
    db
      .select({
        assignedUserId: tasks.assignedUserId,
        assignedAgentRef: tasks.assignedAgentRef,
        assignedAgentHostId: tasks.assignedAgentHostId,
        n: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(and(
        eq(tasks.projectId, projectId), eq(tasks.archived, false), notSystemTask,
        gte(tasks.completedAt, w.start), lt(tasks.completedAt, w.end),
      ))
      .groupBy(tasks.assignedUserId, tasks.assignedAgentRef, tasks.assignedAgentHostId)
      .catch(() => []),

    // 9. Escalation pressure: raised today, and the standing total still owed a human.
    db
      .select({
        today: sql<number>`count(*) filter (where ${today(managerStallWatch.escalatedAt)})::int`,
        open: sql<number>`count(*)::int`,
      })
      .from(managerStallWatch)
      .where(scopedToTenant(
        managerStallWatch, tenantId,
        eq(managerStallWatch.projectId, projectId),
        isNull(managerStallWatch.resolvedAt),
        isNotNull(managerStallWatch.escalatedAt),
      ))
      .catch(() => []),

    // 10. …and the ones to name, so "4 need you" is followed by WHICH four.
    db
      .select({
        taskId: managerStallWatch.taskId,
        key: tasks.key,
        title: tasks.title,
        since: managerStallWatch.escalatedAt,
      })
      .from(managerStallWatch)
      .innerJoin(tasks, eq(tasks.id, managerStallWatch.taskId))
      .where(scopedToTenant(
        managerStallWatch, tenantId,
        eq(managerStallWatch.projectId, projectId),
        isNull(managerStallWatch.resolvedAt),
        isNotNull(managerStallWatch.escalatedAt),
      ))
      .orderBy(desc(managerStallWatch.escalatedAt))
      .limit(ATTENTION_SAMPLE)
      .catch(() => []),
  ]);

  // ── Contributors: merge the three attribution sources ──────────────────────
  //
  // Lane moves contribute PEOPLE AND AGENTS alike: `task_status_transitions` stamps the
  // mover's kind and ref for all of them ({@link resolveTransitionActor}). Only
  // identity-less automation — a cron sweep, a webhook — still writes ('system', null),
  // and that stays out of the contributor table rather than being credited to a
  // fictional member. The run and ticket-ownership sources remain, because they answer
  // different questions: a hop is not a run and neither is a finished ticket.
  const tallies = new Map<string, ContributorTally>();
  const bump = (kind: ActorType, ref: string, patch: Partial<Pick<ContributorTally, 'shipped' | 'runs' | 'moves'>>) => {
    const id = `${kind}:${ref}`;
    const cur = tallies.get(id) ?? { kind, ref, shipped: 0, runs: 0, moves: 0 };
    tallies.set(id, {
      kind, ref,
      shipped: cur.shipped + (patch.shipped ?? 0),
      runs: cur.runs + (patch.runs ?? 0),
      moves: cur.moves + (patch.moves ?? 0),
    });
  };

  let forward = 0; let backward = 0; let byHuman = 0; let byAgent = 0;
  for (const m of moveRows as Array<{ actorKind: string; actorRef: string | null; forward: number; backward: number }>) {
    const f = Number(m.forward || 0);
    const b = Number(m.backward || 0);
    forward += f;
    backward += b;
    if (m.actorKind === 'human') byHuman += f + b; else byAgent += f + b;
    // Only FORWARD hops are credited: a backward move is a redo, and counting it as
    // contribution would reward churn. An actor kind the column does not name (bare
    // 'system') has nobody to credit.
    const kind = contributorKind(m.actorKind);
    if (kind && m.actorRef && f > 0) bump(kind, m.actorRef, { moves: f });
  }

  let runsCompleted = 0; let runsFailed = 0;
  for (const e of execRows as Array<{ cloudAgentRef: string | null; agentHostId: number | null; completed: number; failed: number }>) {
    const c = Number(e.completed || 0);
    runsCompleted += c;
    runsFailed += Number(e.failed || 0);
    if (c <= 0) continue;
    if (e.cloudAgentRef) bump('cloud_agent', e.cloudAgentRef, { runs: c });
    else if (e.agentHostId != null) bump('host_agent', String(e.agentHostId), { runs: c });
  }

  for (const o of ownerRows as Array<{ assignedUserId: string | null; assignedAgentRef: string | null; assignedAgentHostId: number | null; n: number }>) {
    const n = Number(o.n || 0);
    if (n <= 0) continue;
    if (o.assignedUserId) bump('human', o.assignedUserId, { shipped: n });
    else if (o.assignedAgentRef) bump('cloud_agent', o.assignedAgentRef, { shipped: n });
    else if (o.assignedAgentHostId != null) bump('host_agent', String(o.assignedAgentHostId), { shipped: n });
    // An unowned completion is real work with nobody to credit — counted in `shipped`
    // above, deliberately absent from the contributor table rather than attributed to a
    // fictional "Unassigned" member.
  }

  const counts = (ticketCounts as Array<Record<string, number>>)[0] ?? {};
  const prs = (prRow as Array<Record<string, number>>)[0] ?? {};
  const stalls = (stallRow as Array<Record<string, number>>)[0] ?? {};
  const decisions = decisionRows as Array<{ actionType: string; today: number; prev: number }>;

  const ownerRefs = new Map<number, string>();
  const shipped: DigestShippedTicket[] = (shippedRows as Array<{
    id: number; key: string; title: string; completedAt: Date | null; businessValue: number | null;
    assignedUserId: string | null; assignedAgentRef: string | null; assignedAgentHostId: number | null;
  }>).map((r) => {
    const ref = r.assignedUserId ?? r.assignedAgentRef ?? (r.assignedAgentHostId != null ? String(r.assignedAgentHostId) : null);
    if (ref) ownerRefs.set(r.id, ref);
    return {
      id: r.id,
      key: r.key,
      title: r.title,
      completedAt: (r.completedAt ?? w.start).toISOString(),
      ownerName: '',
      ownerKind: r.assignedUserId
        ? 'human'
        : r.assignedAgentRef
          ? 'cloud_agent'
          : r.assignedAgentHostId != null
            ? 'host_agent'
            : 'unassigned',
      businessValue: r.businessValue,
    };
  });

  return {
    tallies: rankContributors(tallies.values()),
    ownerRefs,
    digest: {
      projectId,
      dayStart: w.start.toISOString(),
      dayEnd: w.end.toISOString(),
      manager: {
        passes: Number((passRow as Array<{ passes: number }>)[0]?.passes ?? 0),
        decisions: {
          today: decisions.reduce((s, d) => s + Number(d.today || 0), 0),
          yesterday: decisions.reduce((s, d) => s + Number(d.prev || 0), 0),
        },
        byType: summarizeDecisions(decisions.map((d) => ({ actionType: d.actionType, count: Number(d.today || 0) }))),
        lastRunAt: args.lastRunAt ? new Date(args.lastRunAt).toISOString() : null,
      },
      team: {
        shipped: { today: Number(counts.shippedToday ?? 0), yesterday: Number(counts.shippedPrev ?? 0) },
        opened: { today: Number(counts.openedToday ?? 0), yesterday: Number(counts.openedPrev ?? 0) },
        laneMoves: { forward, backward, byHuman, byAgent },
        runs: { completed: runsCompleted, failed: runsFailed },
        prs: {
          merged: { today: Number(prs.mergedToday ?? 0), yesterday: Number(prs.mergedPrev ?? 0) },
          opened: Number(prs.openedToday ?? 0),
        },
        // Names are resolved AFTER ranking (see getDailyDigest) so a project with a
        // hundred contributors costs at most MAX_CONTRIBUTORS lookups, never one per actor.
        contributors: [],
      },
      shipped,
      needsAttention: {
        escalatedToday: Number(stalls.today ?? 0),
        openEscalations: Number(stalls.open ?? 0),
        items: (attentionRows as Array<{ taskId: number; key: string | null; title: string | null; since: Date | null }>)
          .map((r) => ({
            taskId: r.taskId,
            key: r.key,
            title: r.title,
            reason: 'escalated' as const,
            since: r.since ? r.since.toISOString() : null,
          })),
      },
      computedAt: new Date().toISOString(),
    },
  };
}

/**
 * Put names on everything the computation left anonymous.
 *
 * This is the ONLY per-actor round-trip in the module, and it runs against a set
 * already capped at {@link MAX_CONTRIBUTORS} plus the sampled shipped rows.
 * `resolveActorByRef` resolves a bare ref across users, cloud agents and on-prem hosts
 * behind a 300s cache, and identical refs are resolved ONCE here and reused across both
 * lists — so a polled dashboard re-resolves nothing.
 */
async function attachNames(env: Env, db: Db, tenantId: number, c: DigestComputation): Promise<DailyDigest> {
  const refs = new Set<string>([...c.tallies.map((t) => t.ref), ...c.ownerRefs.values()]);
  const names = new Map<string, string>();
  await Promise.all([...refs].map(async (ref) => {
    const actor = await resolveActorByRef(env, db, tenantId, ref).catch(() => null);
    names.set(ref, actor?.name || ref);
  }));

  return {
    ...c.digest,
    team: {
      ...c.digest.team,
      contributors: c.tallies.map((t) => ({
        id: `${t.kind}:${t.ref}`,
        kind: t.kind,
        name: names.get(t.ref) ?? t.ref,
        shipped: t.shipped,
        runs: t.runs,
        moves: t.moves,
      })),
    },
    shipped: c.digest.shipped.map((s) => {
      const ref = c.ownerRefs.get(s.id);
      return ref ? { ...s, ownerName: names.get(ref) ?? '' } : s;
    }),
  };
}

/**
 * The digest for one project, on the reader's day, cached.
 *
 * The cache key carries the day boundary, so two readers in different timezones get
 * their own (correct) answer instead of racing over one entry, and yesterday's key
 * expires on its own rather than needing an eviction pass.
 */
export async function getDailyDigest(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    tzOffsetMinutes?: number;
    now?: Date;
    lastRunAt?: Date | string | null;
  },
): Promise<DailyDigest> {
  const w = dayWindow(args.now ?? new Date(), args.tzOffsetMinutes ?? 0);
  return getOrSetCached(
    env,
    digestKey(args.tenantId, args.projectId, w.start.toISOString()),
    async () => {
      const computed = await computeDailyDigest(db, {
        tenantId: args.tenantId, projectId: args.projectId, window: w, lastRunAt: args.lastRunAt ?? null,
      });
      return attachNames(env, db, args.tenantId, computed);
    },
    { kvTtlSeconds: DIGEST_TTL_SECONDS },
  );
}

/**
 * Call when a manager pass changes the picture so the cached digest re-computes.
 *
 * Sweeps every live timezone bucket for the current instant: a digest is keyed by the
 * READER's midnight, so invalidating only UTC's would leave most of the world on a
 * stale entry after a pass. The set is small and fixed (UTC-12 … UTC+14 in 15-minute
 * steps covers every real offset, collapsing to ~2 distinct day boundaries), so this
 * is a bounded sweep, not a scan.
 */
export async function invalidateDailyDigest(
  env: Env,
  tenantId: number,
  projectId: number,
  now: Date = new Date(),
): Promise<void> {
  const keys = new Set<string>();
  for (let offset = -12 * 60; offset <= 14 * 60; offset += 15) {
    keys.add(digestKey(tenantId, projectId, dayWindow(now, offset).start.toISOString()));
  }
  await Promise.all([...keys].map((k) => invalidateCached(env, k).catch(() => undefined)));
}
