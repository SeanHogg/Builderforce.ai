import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * concludeCeremonySession — THE one way a ceremony ends.
 *
 * There are two callers and there must never be a third behaviour:
 *   • `POST /sessions/:id/complete` — a human clicked Complete.
 *   • `runCeremonyReaper` — nobody clicked anything and the session ran past its
 *     maximum duration, so the manager closes it.
 *
 * Before this existed only the first path closed a session, which meant a scheduled
 * ceremony could never end at all: `uq_ceremony_session_active(project_id, kind)` allows
 * exactly one live session per board+kind, so the first standup nobody closed silently
 * blocked EVERY future standup on that board while the schedule dutifully recorded
 * 'already_active' every morning.
 *
 * WHAT CONCLUDING DOES, in order:
 *   1. accrue the final speaking turn (unchanged behaviour),
 *   2. RESOLVE ATTENDANCE — who was actually here (0365),
 *   3. decide whether the ceremony may be CONDUCTED at all,
 *   4. if so: apply the agent-reassignment rules, then dispatch agent-owned work,
 *   5. write the outcome + counters, and journal every step to `activity_log`.
 *
 * STEP 3 IS THE GATE. A session no human attended is only conducted when the resolved
 * manager policy grants `allowUnattendedCeremonies`. Otherwise it is closed as
 * `abandoned` with close_reason 'no_humans': recorded in full, so the history shows a
 * standup the team skipped, but with nothing done on their behalf. A human-facilitated
 * session is always conducted — someone was in the room.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  ceremonyParticipants, ceremonySchedules, ceremonySessions, meetingAttendees, projects, tasks,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus } from '../../domain/shared/types';
import { getEffectiveManagerPolicy } from '../manager/ManagerService';
import type { EffectiveManagerPolicy } from '../manager/managerPolicy';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import {
  isHumanSeat, resolveAttendance, selectReassignments,
  type AttendanceSource, type AttendanceSummary, type AttendanceVerdict,
  type ReassignmentPlan, type ReassignmentTarget,
} from './ceremonyAttendance';
import { notifyReassignedAway } from './ceremonyNotifier';
import { dispatchCeremonyCompletion } from './dispatchCeremonyCompletion';
import { endCeremonyMeeting } from './ceremonyMeeting';
import { readMemberProfiles } from '../member/memberProfiles';
import { isOnPtoAt, parsePtoBlocks } from '../member/ptoWindows';

/** Statuses whose tickets can still change hands. Terminal work has nothing to hand over. */
const REASSIGNABLE_STATUSES: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];

/** `activity_log.target_type` for every ceremony journal row — the history detail reads this. */
export const CEREMONY_TARGET_TYPE = 'ceremony_session';

/** How a session ended. Mirrors `ceremony_sessions.close_reason`. */
export type CeremonyCloseReason = 'facilitator' | 'unattended' | 'no_humans' | 'expired';

export interface ConcludeResult {
  sessionId: string;
  status: 'completed' | 'abandoned';
  closeReason: CeremonyCloseReason;
  concludedBy: 'human' | 'manager' | 'system';
  attendance: AttendanceSummary;
  reassignment: ReassignmentPlan;
  dispatched: number;
}

/** Agent seats at the table, in turn order — the pool reassignment hands work to. */
function agentTargets(
  participants: Array<{ memberKind: string; memberRef: string; memberName: string; turnOrder: number }>,
): ReassignmentTarget[] {
  return participants
    .filter((p) => !isHumanSeat(p.memberKind) && p.memberRef)
    .sort((a, b) => a.turnOrder - b.turnOrder)
    .map((p) => ({ memberKind: p.memberKind, memberRef: p.memberRef, memberName: p.memberName }));
}

/**
 * Apply one reassignment plan to the board. Writes go through the task columns directly
 * rather than the REST handler because there is no request to attribute them to; the
 * lane-entry auto-run that a PATCH would have fired happens anyway in step 5, where the
 * whole project's agent-owned work is dispatched through the canonical gate.
 */
async function applyReassignments(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; sessionId: string; kind: string; actor: ActorIdentity },
  plan: ReassignmentPlan,
): Promise<number> {
  let applied = 0;
  for (const r of plan.reassignments) {
    try {
      const target = r.to.memberKind === 'host_agent'
        ? { assignedAgentHostId: Number(r.to.memberRef), assignedAgentRef: null }
        : { assignedAgentHostId: null, assignedAgentRef: r.to.memberRef };
      await db
        .update(tasks)
        .set({ assignedUserId: null, ...target, updatedAt: new Date() })
        // Re-assert the previous owner in the predicate: if the person came back and
        // grabbed their ticket between the plan and this write, the update matches
        // nothing rather than taking it off them a second time.
        .where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, r.taskId), eq(tasks.assignedUserId, r.fromUserId)));
      applied += 1;

      await recordActivity(env, db, {
        tenantId: args.tenantId,
        projectId: args.projectId,
        actor: args.actor,
        verb: 'ceremony.task.reassigned',
        targetType: CEREMONY_TARGET_TYPE,
        targetId: args.sessionId,
        targetLabel: r.taskKey ?? r.taskTitle ?? String(r.taskId),
        summary:
          `Reassigned ${r.taskKey ?? `task ${r.taskId}`} from ${r.fromName} (absent) to ` +
          `${r.to.memberName} after ~${r.idleHours}h idle.`,
        metadata: {
          taskId: r.taskId, taskKey: r.taskKey,
          fromUserId: r.fromUserId, fromName: r.fromName,
          toKind: r.to.memberKind, toRef: r.to.memberRef, toName: r.to.memberName,
          idleHours: r.idleHours, kind: args.kind,
        },
      });

      // The affected person is by construction the one who did not see this happen.
      await notifyReassignedAway(env, db, {
        tenantId: args.tenantId, projectId: args.projectId,
        userId: r.fromUserId, sessionId: args.sessionId, kind: args.kind,
        taskKey: r.taskKey, taskTitle: r.taskTitle,
        agentName: r.to.memberName, idleHours: r.idleHours,
      });
    } catch (err) {
      reportCaughtError(err, { source: "application/ceremony/concludeCeremony.ts", operation: "applyReassignments", context: { logMessage: `[ceremony:conclude] reassignment failed task=${r.taskId}`, details: err } });
    }
  }
  return applied;
}

/**
 * Which human seats were on approved leave at `at`, keyed by member ref (0366).
 *
 * One cached read of the tenant's profiles serves the whole roster — the alternative
 * (a profile lookup per participant) is an N+1 on a path that already runs per ceremony
 * per project. Best-effort: if profiles cannot be read, nobody is marked on leave, which
 * degrades to the pre-0366 behaviour rather than excusing everyone.
 */
/**
 * The member refs that DECLINED this ceremony's companion meeting.
 *
 * Never throws — attendance resolution must survive a meetings-table problem, and the
 * pre-existing behaviour (no decline signal at all) is the safe degrade.
 */
async function loadDeclinedRsvps(db: Db, tenantId: number, meetingId: string | null): Promise<Set<string>> {
  if (!meetingId) return new Set();
  try {
    const rows = await db
      .select({ memberRef: meetingAttendees.memberRef })
      .from(meetingAttendees)
      .where(scopedToTenant(meetingAttendees, tenantId, eq(meetingAttendees.meetingId, meetingId), eq(meetingAttendees.response, 'declined')));
    return new Set(rows.map((r) => r.memberRef));
  } catch (err) {
    reportCaughtError(err, { source: "application/ceremony/concludeCeremony.ts", operation: "loadDeclinedRsvps", context: { details: { meetingId } } });
    return new Set();
  }
}

async function loadPtoAt(
  env: Env,
  db: Db,
  tenantId: number,
  roster: Array<{ memberKind: string; memberRef: string }>,
  at: Date,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const humanRefs = new Set(roster.filter((p) => isHumanSeat(p.memberKind)).map((p) => p.memberRef));
  if (humanRefs.size === 0) return out;
  try {
    const profiles = await readMemberProfiles(env, db, tenantId);
    for (const profile of profiles) {
      if (profile.memberKind !== 'human' || !humanRefs.has(profile.memberRef)) continue;
      out.set(profile.memberRef, isOnPtoAt(parsePtoBlocks(profile.pto), at));
    }
  } catch (err) {
    reportCaughtError(err, { source: "application/ceremony/concludeCeremony.ts", operation: "loadPtoAt", context: { logMessage: `[ceremony:conclude] PTO lookup failed tenant=${tenantId}`, details: err } });
  }
  return out;
}

/** Human-owned, non-terminal tickets on this project — the reassignment candidate pool. */
async function loadReassignableTasks(db: Db, tenantId: number, projectId: number, ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  return db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      assignedUserId: tasks.assignedUserId,
      lastWorkedAt: tasks.lastWorkedAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.projectId, projectId), inArray(tasks.status, REASSIGNABLE_STATUSES), inArray(tasks.assignedUserId, ownerIds)))
    .limit(500);
}

export interface ConcludeOptions {
  /** Who is ending it. 'human' when a facilitator clicked Complete. */
  concludedBy: 'human' | 'manager' | 'system';
  /** 'expired' when the reaper timed a session out; otherwise derived from attendance. */
  reasonHint?: 'expired';
  /** The audit actor. Defaults to the system actor (cron paths). */
  actor?: ActorIdentity;
  /** Pre-resolved policy, to avoid re-reading it in a loop over many sessions. */
  policy?: EffectiveManagerPolicy;
}

/**
 * Conclude one ACTIVE session. Returns null when the session is already concluded — the
 * idempotency guard that lets the reaper and a human's Complete click race safely.
 */
export async function concludeCeremonySession(
  env: Env,
  db: Db,
  session: typeof ceremonySessions.$inferSelect,
  opts: ConcludeOptions,
): Promise<ConcludeResult | null> {
  if (session.status !== 'active') return null;
  const now = new Date();
  const actor = opts.actor ?? SYSTEM_ACTOR;

  const roster = await db
    .select()
    .from(ceremonyParticipants)
    .where(scopedToTenant(ceremonyParticipants, session.tenantId, eq(ceremonyParticipants.sessionId, session.id)));

  // 1. Accrue the final speaking turn (behaviour preserved from the old route handler).
  if (session.currentTurn != null && session.turnStartedAt) {
    const speaking = roster.find((p) => p.turnOrder === session.currentTurn);
    const elapsed = now.getTime() - session.turnStartedAt.getTime();
    if (speaking && elapsed > 0) {
      await db
        .update(ceremonyParticipants)
        .set({ durationMs: speaking.durationMs + elapsed, updatedAt: now })
        .where(scopedToTenant(ceremonyParticipants, session.tenantId, eq(ceremonyParticipants.id, speaking.id)));
      speaking.durationMs += elapsed; // keep the in-memory copy honest for step 2
    }
  }

  // 2. Resolve attendance — one verdict per seat, written here.
  //
  // Approved leave (0366) is loaded first: `member_profiles.pto` had been write-only
  // since 0116 (the calendar sync fills it, nothing ever read it back), and this is its
  // first consumer. It matters because `absentHumans` is what the reassignment rules
  // read, so without it a holiday counts toward having your tickets handed to an agent.
  // ONE cached profiles read for the whole tenant — not per participant.
  const onPtoByRef = await loadPtoAt(env, db, session.tenantId, roster, now);
  // DECLINED INVITES (0292's `meeting_attendees.response`, first read here). An explicit
  // decline excuses the seat for the same reason approved leave does — see
  // `resolveAttendanceVerdict` step 5. One indexed read, skipped entirely for a ceremony
  // with no companion meeting.
  const declinedRefs = await loadDeclinedRsvps(db, session.tenantId, session.meetingId ?? null);

  const attendance = resolveAttendance(roster.map((p) => ({
    memberKind: p.memberKind,
    memberRef: p.memberRef,
    memberName: p.memberName,
    required: p.required,
    joinedAt: p.joinedAt,
    durationMs: p.durationMs,
    // A manual verdict is fed back in so the resolver returns it untouched — a human's
    // correction must survive a re-conclude, which is the whole reason the column exists.
    storedVerdict: p.attendance as AttendanceVerdict,
    storedSource: p.attendanceSource as AttendanceSource,
    onPto: onPtoByRef.get(p.memberRef) ?? false,
    declinedInvite: declinedRefs.has(p.memberRef),
  })));

  for (const p of roster) {
    const resolved = attendance.participants.find(
      (a) => a.memberKind === p.memberKind && a.memberRef === p.memberRef,
    );
    if (!resolved) continue;
    // Never rewrite a manual row — not even with the same value, so `attendance_set_by`
    // and `attendance_set_at` keep pointing at the person who actually decided it.
    if (resolved.source === 'manual') continue;
    await db
      .update(ceremonyParticipants)
      .set({ attendance: resolved.verdict, attendanceSource: resolved.source, updatedAt: now })
      .where(scopedToTenant(ceremonyParticipants, session.tenantId, eq(ceremonyParticipants.id, p.id)));
  }

  // 3. THE GATE. A human in the room means the ceremony happened, full stop. An empty
  //    room means it only happened if the workspace granted unattended ceremonies.
  const policy = opts.policy ?? await getEffectiveManagerPolicy(db, session.tenantId, session.projectId, env);
  const humanFacilitated = opts.concludedBy === 'human' || !attendance.unattended;
  const mayConduct = humanFacilitated || policy.allowUnattendedCeremonies;

  const closeReason: CeremonyCloseReason = humanFacilitated
    ? (opts.reasonHint === 'expired' ? 'expired' : 'facilitator')
    : (mayConduct ? 'unattended' : 'no_humans');
  const status: 'completed' | 'abandoned' = mayConduct ? 'completed' : 'abandoned';

  // 4 + 5. Conduct: reassign an absent owner's stale work, then dispatch agent-owned work.
  let reassignment: ReassignmentPlan = { reassignments: [], blocked: 'not_granted', deferred: 0 };
  let dispatched = 0;

  if (mayConduct) {
    const absentIds = attendance.absentHumans.map((p) => p.memberRef);
    const candidates = policy.allowAgentReassignment && absentIds.length > 0
      ? await loadReassignableTasks(db, session.tenantId, session.projectId, absentIds)
      : [];
    reassignment = selectReassignments({
      policy,
      attendance,
      tasks: candidates,
      agents: agentTargets(roster),
      now,
    });
    await applyReassignments(
      env, db,
      { tenantId: session.tenantId, projectId: session.projectId, sessionId: session.id, kind: session.kind, actor },
      reassignment,
    );

    // A session opened BY a schedule honours that schedule's autoDispatch flag; an
    // ad-hoc session always dispatches, preserving the behaviour of the browser loop this
    // replaced (there is no schedule to opt out on). Checked HERE rather than at the two
    // call sites so the reaper and a human's Complete click cannot disagree about it.
    let mayDispatch = true;
    if (session.scheduleId) {
      const [sched] = await db
        .select({ autoDispatch: ceremonySchedules.autoDispatch })
        .from(ceremonySchedules)
        .where(and(eq(ceremonySchedules.id, session.scheduleId), eq(ceremonySchedules.tenantId, session.tenantId)))
        .limit(1);
      mayDispatch = sched?.autoDispatch ?? true;
    }

    if (mayDispatch) {
      const result = await dispatchCeremonyCompletion(env, db, {
        tenantId: session.tenantId,
        projectId: session.projectId,
        sessionId: session.id,
      }).catch((err) => {
        reportCaughtError(err, { source: "application/ceremony/concludeCeremony.ts", operation: "result", context: { logMessage: '[ceremony:conclude] dispatch failed', details: err } });
        return { candidates: 0, dispatched: 0 };
      });
      dispatched = result.dispatched;
    }
  }

  await db
    .update(ceremonySessions)
    .set({
      status,
      endedAt: now,
      currentTurn: null,
      turnStartedAt: null,
      concludedBy: opts.concludedBy,
      closeReason,
      humansExpected: attendance.humansExpected,
      humansPresent: attendance.humansPresent,
      reassignedCount: reassignment.reassignments.length,
      dispatchedCount: dispatched,
      updatedAt: now,
    })
    .where(scopedToTenant(ceremonySessions, session.tenantId, eq(ceremonySessions.id, session.id)));

  // Close the companion meeting (0366). Without this the shell sits status='live'
  // forever and every "upcoming meetings" list — which filters on exactly that status —
  // keeps showing yesterday's standup as still running.
  await endCeremonyMeeting(db, session.meetingId, now).catch((err) => {
    reportCaughtError(err, { source: "application/ceremony/concludeCeremony.ts", operation: "concludeCeremonySession", context: { logMessage: `[ceremony:conclude] could not end companion meeting session=${session.id}`, details: err } });
  });

  // The close itself is journalled last so the history detail reads in causal order.
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(scopedToTenant(projects, session.tenantId, eq(projects.id, session.projectId)))
    .limit(1);

  await recordActivity(env, db, {
    tenantId: session.tenantId,
    segmentId: session.segmentId,
    projectId: session.projectId,
    actor,
    verb: status === 'completed' ? 'ceremony.completed' : 'ceremony.abandoned',
    targetType: CEREMONY_TARGET_TYPE,
    targetId: session.id,
    targetLabel: `${session.kind}${project?.name ? ` — ${project.name}` : ''}`,
    summary: status === 'completed'
      ? `${session.kind} concluded: ${attendance.humansPresent}/${attendance.humansExpected} attended, ` +
        `${reassignment.reassignments.length} reassigned, ${dispatched} agent runs started.`
      : `${session.kind} abandoned: nobody attended and unattended ceremonies are not enabled for this project.`,
    metadata: {
      kind: session.kind, closeReason, concludedBy: opts.concludedBy,
      humansExpected: attendance.humansExpected, humansPresent: attendance.humansPresent,
      absent: attendance.absentHumans.map((p) => ({ ref: p.memberRef, name: p.memberName })),
      reassigned: reassignment.reassignments.length,
      reassignmentBlocked: reassignment.blocked,
      reassignmentDeferred: reassignment.deferred,
      dispatched,
      durationMs: now.getTime() - session.startedAt.getTime(),
    },
  });

  return {
    sessionId: session.id,
    status,
    closeReason,
    concludedBy: opts.concludedBy,
    attendance,
    reassignment,
    dispatched,
  };
}

/**
 * Record that a member is in the room right now.
 *
 * Called by the live stage's heartbeat. `joinedAt` is set once (first sighting) and
 * `leftAt` moves forward on every beat, so the pair reads as "was here from X to Y".
 * A member not on the roster is seated ad-hoc with `required = false` — they turned up,
 * which is worth recording, but they were never expected and so can never be a no-show.
 */
export async function recordCeremonyPresence(
  db: Db,
  args: {
    tenantId: number;
    segmentId: string | null;
    sessionId: string;
    memberKind: string;
    memberRef: string;
    memberName: string;
  },
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select({ id: ceremonyParticipants.id, joinedAt: ceremonyParticipants.joinedAt })
    .from(ceremonyParticipants)
    .where(scopedToTenant(ceremonyParticipants, args.tenantId, eq(ceremonyParticipants.sessionId, args.sessionId), eq(ceremonyParticipants.memberKind, args.memberKind), eq(ceremonyParticipants.memberRef, args.memberRef)))
    .limit(1);

  if (existing) {
    await db
      .update(ceremonyParticipants)
      .set({ joinedAt: existing.joinedAt ?? now, leftAt: now, updatedAt: now })
      .where(scopedToTenant(ceremonyParticipants, args.tenantId, eq(ceremonyParticipants.id, existing.id)));
    return;
  }

  // Ad-hoc joiner. Seat them after the existing roster so turn order stays stable.
  const seated = await db
    .select({ turnOrder: ceremonyParticipants.turnOrder })
    .from(ceremonyParticipants)
    .where(scopedToTenant(ceremonyParticipants, args.tenantId, eq(ceremonyParticipants.sessionId, args.sessionId)));
  const nextTurn = seated.reduce((max, s) => Math.max(max, s.turnOrder + 1), 0);

  await db.insert(ceremonyParticipants).values({
    tenantId: args.tenantId,
    segmentId: args.segmentId ?? undefined,
    sessionId: args.sessionId,
    memberKind: args.memberKind,
    memberRef: args.memberRef,
    memberName: args.memberName,
    turnOrder: nextTurn,
    required: false,
    joinedAt: now,
    leftAt: now,
    attendance: 'unknown',
    updatedAt: now,
  });
}
