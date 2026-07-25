import { describe, it, expect } from 'vitest';
import {
  resolveAttendanceVerdict,
  resolveAttendance,
  selectReassignments,
  idleHoursFor,
  isHumanSeat,
  type AttendanceInput,
  type ReassignableTask,
  type ReassignmentTarget,
} from './ceremonyAttendance';
import { DEFAULT_MANAGER_POLICY } from '../manager/managerPolicy';

const NOW = new Date('2026-07-25T10:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const seat = (o: Partial<AttendanceInput> = {}): AttendanceInput => ({
  memberKind: 'human',
  memberRef: 'u1',
  memberName: 'Sam',
  required: true,
  joinedAt: null,
  durationMs: 0,
  ...o,
});

const task = (o: Partial<ReassignableTask> = {}): ReassignableTask => ({
  id: 1,
  key: 'PRJ-1',
  title: 'Something',
  status: 'in_progress',
  assignedUserId: 'u1',
  lastWorkedAt: hoursAgo(100),
  updatedAt: hoursAgo(100),
  ...o,
});

const agent = (ref: string, name = ref): ReassignmentTarget => ({
  memberKind: 'cloud_agent', memberRef: ref, memberName: name,
});

/** The granting policy, with the guardrails at their built-in defaults (48h / 3). */
const granted = {
  ...DEFAULT_MANAGER_POLICY,
  allowAgentReassignment: true,
};

describe('attendance verdicts', () => {
  it('marks a human who was observed as present', () => {
    expect(resolveAttendanceVerdict(seat({ joinedAt: hoursAgo(1) })).verdict).toBe('present');
  });

  it('treats an accrued speaking turn as proof of presence even with no heartbeat', () => {
    // The backstop that matters most: a facilitated session where the heartbeat never
    // landed must not report the person who spoke as a no-show, because that verdict is
    // the one that can take their work away.
    expect(resolveAttendanceVerdict(seat({ joinedAt: null, durationMs: 5_000 })).verdict).toBe('present');
  });

  it('marks an expected human who never appeared as absent', () => {
    expect(resolveAttendanceVerdict(seat()).verdict).toBe('absent');
  });

  it('excuses an optional seat that never appeared', () => {
    expect(resolveAttendanceVerdict(seat({ required: false })).verdict).toBe('excused');
  });

  it('always counts agents as present — they cannot fail to show up', () => {
    expect(resolveAttendanceVerdict(seat({ memberKind: 'cloud_agent' })).verdict).toBe('present');
    expect(resolveAttendanceVerdict(seat({ memberKind: 'host_agent' })).verdict).toBe('present');
    expect(isHumanSeat('cloud_agent')).toBe(false);
  });

  it('EXCUSES someone on approved leave instead of marking them absent', () => {
    // The point of reading member_profiles.pto: a holiday must not contribute to
    // having your tickets handed to an agent.
    const r = resolveAttendanceVerdict(seat({ onPto: true }));
    expect(r.verdict).toBe('excused');
    expect(r.source).toBe('pto');
  });

  it('counts someone who joined anyway as PRESENT, whatever their calendar said', () => {
    const r = resolveAttendanceVerdict(seat({ onPto: true, joinedAt: hoursAgo(1) }));
    expect(r.verdict).toBe('present');
    expect(r.source).toBe('derived');
  });

  it('returns a MANUAL verdict untouched, outranking every derived signal', () => {
    // A manager said this person was here; a missing heartbeat must not undo that.
    const r = resolveAttendanceVerdict(seat({ storedVerdict: 'present', storedSource: 'manual' }));
    expect(r.verdict).toBe('present');
    expect(r.source).toBe('manual');
  });

  it('honours a manual ABSENT even for someone the heartbeat observed', () => {
    const r = resolveAttendanceVerdict(seat({
      joinedAt: hoursAgo(1), durationMs: 9_000, storedVerdict: 'absent', storedSource: 'manual',
    }));
    expect(r.verdict).toBe('absent');
    expect(r.source).toBe('manual');
  });

  it('ignores a manual source carrying no usable verdict rather than freezing on unknown', () => {
    // A row stamped 'manual' but still 'unknown' is incoherent; falling through to the
    // derived answer beats persisting 'unknown' forever.
    expect(resolveAttendanceVerdict(seat({ storedVerdict: 'unknown', storedSource: 'manual' })).verdict).toBe('absent');
  });

  it('does not let a stale DERIVED verdict override a fresh signal', () => {
    // Only 'manual' is sticky. A previously-derived 'absent' must be recomputable.
    const r = resolveAttendanceVerdict(seat({ joinedAt: hoursAgo(1), storedVerdict: 'absent', storedSource: 'derived' }));
    expect(r.verdict).toBe('present');
  });
});

describe('attendance + PTO through the summary', () => {
  it('keeps someone on leave OUT of absentHumans, so their work is never reassigned', () => {
    const s = resolveAttendance([
      seat({ memberRef: 'u1', memberName: 'Sam', onPto: true }),
      seat({ memberRef: 'u2', memberName: 'Ada' }),
    ]);
    expect(s.absentHumans.map((a) => a.memberRef)).toEqual(['u2']);
    // Still counted as expected — the standup did have two seats — but not as a no-show.
    expect(s.humansExpected).toBe(2);
    expect(s.humansPresent).toBe(0);
  });

  it('a roster of nothing but people on leave is still unattended', () => {
    // Nobody came, so the unattended-ceremony gate still applies; they just aren't
    // blamed for it.
    const s = resolveAttendance([seat({ memberRef: 'u1', onPto: true })]);
    expect(s.unattended).toBe(true);
    expect(s.absentHumans).toHaveLength(0);
  });

  it('a manual correction to present feeds straight into the counters', () => {
    const s = resolveAttendance([
      seat({ memberRef: 'u1', storedVerdict: 'present', storedSource: 'manual' }),
      seat({ memberRef: 'u2' }),
    ]);
    expect(s.humansPresent).toBe(1);
    expect(s.unattended).toBe(false);
    expect(s.absentHumans.map((a) => a.memberRef)).toEqual(['u2']);
  });
});

describe('attendance summary', () => {
  it('counts only expected humans in the denominator and excludes agents entirely', () => {
    const s = resolveAttendance([
      seat({ memberRef: 'u1', joinedAt: hoursAgo(1) }),
      seat({ memberRef: 'u2' }),
      seat({ memberRef: 'u3', required: false }),
      seat({ memberRef: 'bot', memberKind: 'cloud_agent', memberName: 'Bot' }),
    ]);
    expect(s.humansExpected).toBe(2);          // u1 + u2 (u3 optional, bot not human)
    expect(s.humansPresent).toBe(1);
    expect(s.absentHumans.map((a) => a.memberRef)).toEqual(['u2']);
    expect(s.unattended).toBe(false);
  });

  it('flags a roster where no human turned up as unattended', () => {
    const s = resolveAttendance([
      seat({ memberRef: 'u1' }),
      seat({ memberRef: 'bot', memberKind: 'cloud_agent' }),
    ]);
    expect(s.unattended).toBe(true);
    expect(s.humansPresent).toBe(0);
  });

  it('is unattended for an empty roster', () => {
    expect(resolveAttendance([]).unattended).toBe(true);
  });
});

describe('idleHoursFor', () => {
  it('measures from lastWorkedAt when present', () => {
    expect(idleHoursFor(task({ lastWorkedAt: hoursAgo(12), updatedAt: hoursAgo(1) }), NOW)).toBe(12);
  });

  it('falls back to updatedAt when the ticket was never worked', () => {
    expect(idleHoursFor(task({ lastWorkedAt: null, updatedAt: hoursAgo(7) }), NOW)).toBe(7);
  });

  it('treats a ticket with no anchor at all as maximally stale', () => {
    expect(idleHoursFor(task({ lastWorkedAt: null, updatedAt: null }), NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('never returns a negative age for a future stamp', () => {
    expect(idleHoursFor(task({ lastWorkedAt: new Date(NOW.getTime() + 60_000) }), NOW)).toBe(0);
  });
});

describe('selectReassignments — the whole rule', () => {
  const attendance = resolveAttendance([
    seat({ memberRef: 'u1', memberName: 'Sam' }),                 // absent
    seat({ memberRef: 'u2', memberName: 'Ada', joinedAt: hoursAgo(1) }), // present
  ]);

  it('does nothing when the workspace never granted the authority', () => {
    const plan = selectReassignments({
      policy: DEFAULT_MANAGER_POLICY, attendance, tasks: [task()], agents: [agent('a1')], now: NOW,
    });
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.blocked).toBe('not_granted');
  });

  it('does nothing when everyone expected turned up', () => {
    const allPresent = resolveAttendance([seat({ memberRef: 'u1', joinedAt: hoursAgo(1) })]);
    const plan = selectReassignments({
      policy: granted, attendance: allPresent, tasks: [task()], agents: [agent('a1')], now: NOW,
    });
    expect(plan.blocked).toBe('no_absentees');
  });

  it('does nothing when there is no agent to hand the work to', () => {
    const plan = selectReassignments({
      policy: granted, attendance, tasks: [task()], agents: [], now: NOW,
    });
    expect(plan.blocked).toBe('no_agents');
  });

  it('MISSING A STANDUP IS NOT ENOUGH — recent work stays with its absent owner', () => {
    // The governing principle. Sam missed the standup, but the ticket was worked on
    // 2 hours ago, well inside the 48h threshold, so nothing moves.
    const plan = selectReassignments({
      policy: granted,
      attendance,
      tasks: [task({ lastWorkedAt: hoursAgo(2) })],
      agents: [agent('a1')],
      now: NOW,
    });
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.blocked).toBe('nothing_stale');
  });

  it('reassigns only when the owner is absent AND the work is stale', () => {
    const plan = selectReassignments({
      policy: granted,
      attendance,
      tasks: [task({ id: 1, lastWorkedAt: hoursAgo(60) })],
      agents: [agent('a1', 'Bob')],
      now: NOW,
    });
    expect(plan.reassignments).toHaveLength(1);
    expect(plan.reassignments[0]).toMatchObject({
      taskId: 1, fromUserId: 'u1', fromName: 'Sam', idleHours: 60,
    });
    expect(plan.reassignments[0]?.to.memberName).toBe('Bob');
    expect(plan.blocked).toBeNull();
  });

  it('never touches a PRESENT member’s stale work', () => {
    const plan = selectReassignments({
      policy: granted,
      attendance,
      tasks: [task({ id: 9, assignedUserId: 'u2', lastWorkedAt: hoursAgo(500) })],
      agents: [agent('a1')],
      now: NOW,
    });
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.blocked).toBe('nothing_stale');
  });

  it('respects a project that demands more patience than the default', () => {
    const patient = { ...granted, agentReassignIdleHours: 168 };
    const plan = selectReassignments({
      policy: patient, attendance, tasks: [task({ lastWorkedAt: hoursAgo(60) })], agents: [agent('a1')], now: NOW,
    });
    expect(plan.blocked).toBe('nothing_stale');
  });

  it('caps at agentReassignMaxPerSession and reports what it left behind', () => {
    const tasks = [1, 2, 3, 4, 5].map((id) => task({ id, key: `PRJ-${id}`, lastWorkedAt: hoursAgo(60 + id) }));
    const plan = selectReassignments({
      policy: granted, attendance, tasks, agents: [agent('a1')], now: NOW,
    });
    expect(plan.reassignments).toHaveLength(3);   // the built-in cap
    expect(plan.deferred).toBe(2);
    expect(plan.blocked).toBe('capped');          // never a silent truncation
  });

  it('hands over the STALEST work first, so a hit cap defers the least-stuck', () => {
    const tasks = [
      task({ id: 1, lastWorkedAt: hoursAgo(50) }),
      task({ id: 2, lastWorkedAt: hoursAgo(400) }),
      task({ id: 3, lastWorkedAt: hoursAgo(120) }),
      task({ id: 4, lastWorkedAt: hoursAgo(90) }),
    ];
    const plan = selectReassignments({
      policy: granted, attendance, tasks, agents: [agent('a1')], now: NOW,
    });
    expect(plan.reassignments.map((r) => r.taskId)).toEqual([2, 3, 4]);
  });

  it('round-robins across agents rather than burying the first one', () => {
    const tasks = [1, 2, 3].map((id) => task({ id, lastWorkedAt: hoursAgo(100 + id) }));
    const plan = selectReassignments({
      policy: granted, attendance, tasks, agents: [agent('a1'), agent('a2')], now: NOW,
    });
    expect(plan.reassignments.map((r) => r.to.memberRef)).toEqual(['a1', 'a2', 'a1']);
  });

  it('reports a finite idleHours for a never-touched ticket (Infinity would serialise to null)', () => {
    const plan = selectReassignments({
      policy: granted,
      attendance,
      tasks: [task({ lastWorkedAt: null, updatedAt: null })],
      agents: [agent('a1')],
      now: NOW,
    });
    expect(plan.reassignments[0]?.idleHours).toBe(granted.agentReassignIdleHours);
    expect(Number.isFinite(plan.reassignments[0]?.idleHours ?? NaN)).toBe(true);
  });

  it('a zero cap grants the authority but hands nothing over', () => {
    const plan = selectReassignments({
      policy: { ...granted, agentReassignMaxPerSession: 0 },
      attendance,
      tasks: [task({ lastWorkedAt: hoursAgo(100) })],
      agents: [agent('a1')],
      now: NOW,
    });
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.deferred).toBe(1);
    expect(plan.blocked).toBe('capped');
  });
});
