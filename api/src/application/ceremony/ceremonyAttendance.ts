/**
 * ceremonyAttendance — the two judgement calls a concluding ceremony has to make,
 * as PURE functions over already-loaded rows.
 *
 *   1. WHO WAS ACTUALLY HERE?      → {@link resolveAttendance}
 *   2. WHOSE WORK CHANGES HANDS?   → {@link selectReassignments}
 *
 * They are pure and live apart from `concludeCeremonySession` deliberately. Both encode
 * a policy that a person has to be able to audit — "the manager took a ticket off me
 * while I was on holiday" is a question that must be answerable by reading one function,
 * not by reconstructing the interleaving of a DB transaction. Everything here is
 * decided from its arguments; the caller does all the I/O.
 *
 * THE GOVERNING PRINCIPLE — missing a ceremony is not a fault.
 *
 * A human misses a standup for a hundred legitimate reasons. So absence is RECORDED
 * (it is the signal a team needs) but never, on its own, moves anyone's work. A
 * reassignment additionally requires that the ticket has been sitting untouched past a
 * threshold the workspace set, i.e. that the work is genuinely stalled — and even then
 * it is capped, and only happens at all if the workspace granted the authority. Three
 * independent conditions, each of which alone is insufficient.
 */

import type { EffectiveManagerPolicy } from '../manager/managerPolicy';

/** The resolved verdict stored on `ceremony_participants.attendance` (0365). */
export type AttendanceVerdict = 'unknown' | 'present' | 'absent' | 'excused';

/** Where a verdict came from — `ceremony_participants.attendance_source` (0366). */
export type AttendanceSource = 'derived' | 'pto' | 'manual';

/** The participant fields attendance resolution reads. */
export interface AttendanceInput {
  memberKind: string;
  memberRef: string;
  memberName: string;
  /** Was this seat expected? Ad-hoc joiners are not, so they can never be no-shows. */
  required: boolean;
  /** First moment observed in the room (attendance heartbeat), else null. */
  joinedAt: Date | null;
  /** Accrued speaking time. A backstop signal — see below. */
  durationMs: number;
  /** The verdict already stored on the row, and where it came from (0366). Only
   *  `'manual'` is meaningful as an input: it means a human asserted this and it must
   *  not be recomputed. Absent for a row read before the migration. */
  storedVerdict?: AttendanceVerdict;
  storedSource?: AttendanceSource;
  /** True when approved leave (`member_profiles.pto`) covered the ceremony (0366). */
  onPto?: boolean;
}

export interface AttendanceResult extends AttendanceInput {
  verdict: AttendanceVerdict;
  /** How {@link verdict} was arrived at — persisted so a later re-conclude can refresh
   *  an inferred verdict without discarding a human's correction. */
  source: AttendanceSource;
}

/**
 * Is this seat filled by a person? Agents are seated in the round table so they hold a
 * turn, but they are not "attendance" in any sense a team means it — they cannot be
 * absent, cannot be notified to join, and their work is never reassigned away from them
 * by the absence rules. Mirrors `ceremony_participants.member_kind`.
 */
export function isHumanSeat(memberKind: string): boolean {
  return memberKind === 'human';
}

/**
 * Resolve one participant's attendance verdict, in strict precedence order.
 *
 *   1. AGENTS are always 'present' — seated by construction, cannot fail to show.
 *   2. A MANUAL verdict is returned untouched. A human looked at this and asserted it;
 *      no derived signal outranks that, and this is what makes the correction durable
 *      across a re-conclude or a heartbeat that lands late.
 *   3. OBSERVED ⇒ 'present'. `joinedAt` is the primary signal (the heartbeat, or a
 *      write-through from joining the meeting's video room). `durationMs > 0` is a
 *      BACKSTOP for a session facilitated purely through the turn controls — an accrued
 *      speaking turn is proof of presence, and reporting that person absent would be the
 *      single worst failure mode here, because it is the one that wrongly takes work away.
 *      Deliberately ahead of PTO: someone who joined anyway WAS at the ceremony,
 *      whatever their calendar said.
 *   4. ON APPROVED LEAVE ⇒ 'excused'. Planned absence is not a no-show, and since
 *      `absentHumans` is what the reassignment rules read, this is what stops a holiday
 *      from contributing to someone's tickets being handed to an agent.
 *   5. EXPECTED and never seen ⇒ 'absent'. An optional seat is 'excused' instead.
 */
export function resolveAttendanceVerdict(p: AttendanceInput): { verdict: AttendanceVerdict; source: AttendanceSource } {
  if (!isHumanSeat(p.memberKind)) return { verdict: 'present', source: 'derived' };
  if (p.storedSource === 'manual' && p.storedVerdict && p.storedVerdict !== 'unknown') {
    return { verdict: p.storedVerdict, source: 'manual' };
  }
  if (p.joinedAt != null || p.durationMs > 0) return { verdict: 'present', source: 'derived' };
  if (p.onPto) return { verdict: 'excused', source: 'pto' };
  return { verdict: p.required ? 'absent' : 'excused', source: 'derived' };
}

export interface AttendanceSummary {
  participants: AttendanceResult[];
  /** Expected human seats — the denominator a history row shows. */
  humansExpected: number;
  /** Human seats actually observed. */
  humansPresent: number;
  /** Expected humans who never appeared. Their names drive the history detail. */
  absentHumans: AttendanceResult[];
  /** True when not one human turned up. THE input to the unattended-ceremony gate. */
  unattended: boolean;
}

/** Resolve the whole roster at once and derive the session's attendance counters. */
export function resolveAttendance(participants: AttendanceInput[]): AttendanceSummary {
  const resolved: AttendanceResult[] = participants.map((p) => ({ ...p, ...resolveAttendanceVerdict(p) }));
  const humans = resolved.filter((p) => isHumanSeat(p.memberKind));
  const present = humans.filter((p) => p.verdict === 'present');
  return {
    participants: resolved,
    humansExpected: humans.filter((p) => p.required).length,
    humansPresent: present.length,
    absentHumans: humans.filter((p) => p.verdict === 'absent'),
    // Note this is "no humans PRESENT", not "no humans EXPECTED": an agent-only roster
    // has nobody to miss the meeting, and is handled by the caller as a normal close.
    unattended: present.length === 0,
  };
}

// ── reassignment ────────────────────────────────────────────────────────────

/** The task fields the reassignment rules read. */
export interface ReassignableTask {
  id: number;
  key: string | null;
  title: string | null;
  status: string;
  /** The human owner. Only human-owned work is ever considered here. */
  assignedUserId: string | null;
  /** Last time anything happened to this ticket. Null = never worked. */
  lastWorkedAt: Date | null;
  /** Fallback staleness anchor when a ticket has never been worked at all. */
  updatedAt: Date | null;
}

/** An agent that can take work over, in the ceremony roster's own encoding. */
export interface ReassignmentTarget {
  /** 'cloud_agent' | 'host_agent'. */
  memberKind: string;
  memberRef: string;
  memberName: string;
}

export interface Reassignment {
  taskId: number;
  taskKey: string | null;
  taskTitle: string | null;
  fromUserId: string;
  fromName: string;
  to: ReassignmentTarget;
  /** Hours the ticket had sat untouched — the evidence, journalled with the action. */
  idleHours: number;
}

/** Why a reassignment pass did nothing. Surfaced so a no-op reads as a decision. */
export type ReassignmentBlockReason =
  | 'not_granted'      // the workspace/project never granted the authority
  | 'no_absentees'     // everyone expected turned up
  | 'no_agents'        // nobody to hand the work to
  | 'nothing_stale'    // absentees' work is all within the idle threshold
  | 'capped';          // the per-session cap was reached (some were still made)

export interface ReassignmentPlan {
  reassignments: Reassignment[];
  /** Set when fewer were made than were eligible — never a silent truncation. */
  blocked: ReassignmentBlockReason | null;
  /** Eligible candidates that the cap left behind. */
  deferred: number;
}

/** Whole hours a ticket has sat untouched at `now`. Never negative. */
export function idleHoursFor(task: ReassignableTask, now: Date): number {
  const anchor = task.lastWorkedAt ?? task.updatedAt;
  if (!anchor) return Number.POSITIVE_INFINITY; // never touched at all — maximally stale
  return Math.max(0, (now.getTime() - anchor.getTime()) / 3_600_000);
}

/**
 * Decide which of an absent human's tickets change hands, and to whom.
 *
 * ALL of the following must hold for a single reassignment — this is the whole rule:
 *
 *   1. `policy.allowAgentReassignment` — the workspace (or project) granted it. The
 *      three-tier fold resolves this most-restrictive-wins, so an explicit `false`
 *      anywhere is final.
 *   2. The ticket's owner was ABSENT from this ceremony (never observed, and expected).
 *   3. The ticket has been untouched for at least `policy.agentReassignIdleHours`.
 *      This is the condition that keeps a normal absence harmless: someone who takes a
 *      day off returns to their own work, because one missed standup does not make a
 *      ticket stale.
 *   4. The ticket is not terminal — finished work has nothing to hand over.
 *   5. The running total is under `policy.agentReassignMaxPerSession`.
 *
 * Targets are assigned round-robin across the available agents rather than piling every
 * orphaned ticket onto the first one, and the STALEST tickets go first so a hit cap
 * leaves behind the work that was least stuck.
 */
export function selectReassignments(args: {
  policy: Pick<EffectiveManagerPolicy, 'allowAgentReassignment' | 'agentReassignIdleHours' | 'agentReassignMaxPerSession'>;
  /** The resolved roster, so absence is read from the same verdict the history shows. */
  attendance: AttendanceSummary;
  /** Non-terminal, human-owned tickets on this project. */
  tasks: ReassignableTask[];
  /** Agent seats at this ceremony, in turn order. */
  agents: ReassignmentTarget[];
  now: Date;
}): ReassignmentPlan {
  const { policy, attendance, tasks, agents, now } = args;
  const none = (blocked: ReassignmentBlockReason): ReassignmentPlan => ({ reassignments: [], blocked, deferred: 0 });

  if (!policy.allowAgentReassignment) return none('not_granted');
  if (attendance.absentHumans.length === 0) return none('no_absentees');
  if (agents.length === 0) return none('no_agents');

  const absentByRef = new Map(attendance.absentHumans.map((p) => [p.memberRef, p]));

  // Stalest first, so a hit cap defers the least-stuck work rather than an arbitrary slice.
  const eligible = tasks
    .map((t) => ({ task: t, owner: t.assignedUserId ? absentByRef.get(t.assignedUserId) : undefined, idle: idleHoursFor(t, now) }))
    .filter((c) => c.owner !== undefined && c.idle >= policy.agentReassignIdleHours)
    .sort((a, b) => b.idle - a.idle);

  if (eligible.length === 0) return none('nothing_stale');

  const cap = Math.max(0, policy.agentReassignMaxPerSession);
  const taken = eligible.slice(0, cap);
  const deferred = eligible.length - taken.length;

  const reassignments: Reassignment[] = taken.map((c, i) => ({
    taskId: c.task.id,
    taskKey: c.task.key,
    taskTitle: c.task.title,
    fromUserId: c.owner!.memberRef,
    fromName: c.owner!.memberName,
    // Round-robin so one agent does not inherit an entire absent person's board.
    to: agents[i % agents.length]!,
    // Infinity (a never-touched ticket) would serialise to null in JSON, so report the
    // threshold itself — the claim being journalled is "at least this long", and that
    // is true either way.
    idleHours: Number.isFinite(c.idle) ? Math.round(c.idle) : policy.agentReassignIdleHours,
  }));

  return {
    reassignments,
    blocked: deferred > 0 ? 'capped' : null,
    deferred,
  };
}
