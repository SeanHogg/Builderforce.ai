/**
 * EMP-14 — Collaboration metrics beyond `prsReviewed`.
 *
 * The daily-metrics rollup already counts PRs reviewed; this widens the picture to
 * the collaboration behaviours that actually make a team move work together:
 *
 *  - PRs reviewed        (activity_events.pr_reviewed, per member)
 *  - review comments     (activity_events.issue_commented — code/PR discussion)
 *  - review turnaround   (avg cycle time of the PRs a member engaged with — a
 *                         proxy for review latency, the only per-reviewer timing
 *                         signal the ingest carries)
 *  - cross-member handoffs (task_status_transitions: a lane move whose actor
 *                         differs from the prior move's actor = work passed hands)
 *
 * rolled into a 0..100 collaboration score per member. Members are the polymorphic
 * (kind, ref) identity: git/PR signals resolve through `contributors`
 * (userId → human, agentHostId → host_agent); handoffs additionally attribute to
 * cloud agents. {@link scoreCollaboration} is pure for unit testing.
 */
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  activityEvents, agentHosts, contributors, taskStatusTransitions, users,
} from '../../infrastructure/database/schema';
import type { MemberKind } from './workforceMetrics';

const HOUR_MS = 3_600_000;
const MAX_ROWS = 20_000;

const key = (kind: MemberKind, ref: string) => `${kind}:${ref}`;

export interface CollaborationSignals {
  prsReviewed: number;
  reviewComments: number;
  handoffs: number;
  /** Avg cycle time (hrs) of the PRs this member reviewed — review-latency proxy. */
  avgReviewTurnaroundHours: number | null;
}

export interface CollaborationRow extends CollaborationSignals {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  /** 0..100 composite. */
  collaborationScore: number;
  /** Per-dimension point contribution (for the radar/bar breakdown). */
  breakdown: { reviewsPts: number; commentsPts: number; handoffPts: number; latencyPts: number };
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Pure: fold a member's raw collaboration signals into a 0..100 score. Reviews and
 * handoffs are the heaviest weighted (they move OTHER people's work forward); fast
 * review turnaround adds a small bonus. Sorted by score desc, name tiebreak.
 */
export function scoreCollaboration(
  signalsByMember: Map<string, { kind: MemberKind; ref: string; name: string } & CollaborationSignals>,
): CollaborationRow[] {
  const out: CollaborationRow[] = [];
  for (const s of signalsByMember.values()) {
    const reviewsPts = Math.min(40, s.prsReviewed * 4);
    const commentsPts = Math.min(20, s.reviewComments * 2);
    const handoffPts = Math.min(25, s.handoffs * 5);
    // Faster turnaround → more points (0..15); null turnaround contributes 0.
    const latencyPts =
      s.avgReviewTurnaroundHours == null ? 0 : clamp100(15 * (1 - Math.min(1, s.avgReviewTurnaroundHours / 72)));
    const collaborationScore = clamp100(reviewsPts + commentsPts + handoffPts + latencyPts);
    out.push({
      memberKind: s.kind,
      memberRef: s.ref,
      name: s.name,
      prsReviewed: s.prsReviewed,
      reviewComments: s.reviewComments,
      handoffs: s.handoffs,
      avgReviewTurnaroundHours: s.avgReviewTurnaroundHours,
      collaborationScore,
      breakdown: {
        reviewsPts: Math.round(reviewsPts),
        commentsPts: Math.round(commentsPts),
        handoffPts: Math.round(handoffPts),
        latencyPts: Math.round(latencyPts),
      },
    });
  }
  return out.sort((a, b) => b.collaborationScore - a.collaborationScore || a.name.localeCompare(b.name));
}

export interface CollaborationResult {
  windowDays: number;
  members: CollaborationRow[];
}

export async function computeCollaborationMetrics(db: Db, tenantId: number, days: number): Promise<CollaborationResult> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  type Acc = { kind: MemberKind; ref: string; name: string } & CollaborationSignals;
  const byMember = new Map<string, Acc>();
  const ensure = (kind: MemberKind, ref: string, name: string): Acc => {
    const k = key(kind, ref);
    let a = byMember.get(k);
    if (!a) { a = { kind, ref, name, prsReviewed: 0, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: null }; byMember.set(k, a); }
    return a;
  };

  // ── 1. PR reviews + review comments, resolved contributor → member ───────────
  const reviewRows = await db
    .select({
      eventType: activityEvents.eventType,
      cycleTimeHours: activityEvents.cycleTimeHours,
      userId: contributors.userId,
      agentHostId: contributors.agentHostId,
      hostName: agentHosts.name,
      displayName: contributors.displayName,
    })
    .from(activityEvents)
    .innerJoin(contributors, eq(contributors.id, activityEvents.contributorId))
    .leftJoin(agentHosts, eq(agentHosts.id, contributors.agentHostId))
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      gte(activityEvents.occurredAt, since),
      inArray(activityEvents.eventType, ['pr_reviewed', 'issue_commented']),
    ))
    .limit(MAX_ROWS);

  const turnaroundAcc = new Map<string, { sum: number; n: number }>();
  for (const r of reviewRows) {
    let kind: MemberKind; let ref: string; let name: string;
    if (r.userId) { kind = 'human'; ref = r.userId; name = r.displayName; }
    else if (r.agentHostId != null) { kind = 'host_agent'; ref = String(r.agentHostId); name = r.hostName || r.displayName; }
    else continue; // unattributable contributor
    const a = ensure(kind, ref, name);
    if (r.eventType === 'pr_reviewed') {
      a.prsReviewed += 1;
      if (r.cycleTimeHours != null && r.cycleTimeHours >= 0) {
        const t = turnaroundAcc.get(key(kind, ref)) ?? { sum: 0, n: 0 };
        t.sum += r.cycleTimeHours; t.n += 1; turnaroundAcc.set(key(kind, ref), t);
      }
    } else {
      a.reviewComments += 1;
    }
  }
  for (const [k, t] of turnaroundAcc) { const a = byMember.get(k); if (a && t.n > 0) a.avgReviewTurnaroundHours = t.sum / t.n; }

  // ── 2. Cross-member handoffs from the lane-move log ──────────────────────────
  const moves = await db
    .select({
      taskId: taskStatusTransitions.taskId,
      actorKind: taskStatusTransitions.actorKind,
      actorRef: taskStatusTransitions.actorRef,
      occurredAt: taskStatusTransitions.occurredAt,
    })
    .from(taskStatusTransitions)
    .where(and(
      eq(taskStatusTransitions.tenantId, tenantId),
      gte(taskStatusTransitions.occurredAt, since),
      isNotNull(taskStatusTransitions.actorRef),
    ))
    .orderBy(taskStatusTransitions.taskId, taskStatusTransitions.occurredAt)
    .limit(MAX_ROWS);

  // Names for handoff participants not already seen via git activity.
  const handoffKeys = new Set<string>();
  // adjacent-distinct-actor edges per task → +1 handoff to giver and receiver.
  const handoffCount = new Map<string, number>();
  let prevTask = -1; let prevKind: string | null = null; let prevRef: string | null = null;
  const isMember = (k: string): k is MemberKind => k === 'human' || k === 'cloud_agent' || k === 'host_agent';
  for (const m of moves) {
    if (m.taskId !== prevTask) { prevTask = m.taskId; prevKind = m.actorKind; prevRef = m.actorRef; continue; }
    if (m.actorRef && prevRef && (m.actorRef !== prevRef || m.actorKind !== prevKind) && isMember(m.actorKind) && prevKind && isMember(prevKind)) {
      for (const [k, r] of [[m.actorKind, m.actorRef], [prevKind, prevRef]] as const) {
        const kk = key(k as MemberKind, r);
        handoffCount.set(kk, (handoffCount.get(kk) ?? 0) + 1);
        handoffKeys.add(kk);
      }
    }
    prevKind = m.actorKind; prevRef = m.actorRef;
  }

  // Resolve display names for handoff-only members (humans / host agents).
  const unresolved = [...handoffKeys].filter((k) => !byMember.has(k));
  const humanIds = unresolved.filter((k) => k.startsWith('human:')).map((k) => k.slice('human:'.length));
  const hostIds = unresolved.filter((k) => k.startsWith('host_agent:')).map((k) => Number(k.slice('host_agent:'.length))).filter(Number.isFinite);
  const nameByKey = new Map<string, string>();
  if (humanIds.length) {
    const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, humanIds));
    for (const r of rows) nameByKey.set(key('human', r.id), r.name || r.id);
  }
  if (hostIds.length) {
    const rows = await db.select({ id: agentHosts.id, name: agentHosts.name }).from(agentHosts).where(inArray(agentHosts.id, hostIds));
    for (const r of rows) nameByKey.set(key('host_agent', String(r.id)), r.name || `Agent host #${r.id}`);
  }
  for (const [k, count] of handoffCount) {
    const [kind, ref] = [k.slice(0, k.indexOf(':')) as MemberKind, k.slice(k.indexOf(':') + 1)];
    const name = byMember.get(k)?.name ?? nameByKey.get(k) ?? ref;
    const a = ensure(kind, ref, name);
    a.handoffs = count;
  }

  return { windowDays: days, members: scoreCollaboration(byMember) };
}
