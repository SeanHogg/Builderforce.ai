/**
 * Ceremony sessions and schedules — the stand-up / planning tracking client
 * (`/api/agile/ceremonies`). Its own module rather than a section of
 * `builderforceApi.ts`: ceremonies are one bounded context, and the shared client
 * is a file every feature used to grow.
 */

import { request } from './builderforceApi';

export type CeremonyKind = 'standup' | 'planning';

/** How a session ended (migration 0365). */
export type CeremonyCloseReason = 'facilitator' | 'unattended' | 'no_humans' | 'expired';
/** Resolved attendance verdict per seat (migration 0365). */
export type CeremonyAttendance = 'unknown' | 'present' | 'absent' | 'excused';
/** Where that verdict came from (migration 0366). `manual` is never recomputed. */
export type CeremonyAttendanceSource = 'derived' | 'pto' | 'manual';
/** The verdicts a manager may assert. 'unknown' means "not concluded", not a correction. */
export const CEREMONY_CORRECTABLE: readonly CeremonyAttendance[] = ['present', 'absent', 'excused'];

export interface CeremonySession {
  id: string;
  projectId: number;
  kind: CeremonyKind;
  /** 'abandoned' = concluded without being conducted (nobody came, and the workspace
   *  has not granted unattended ceremonies). */
  status: 'active' | 'completed' | 'abandoned';
  facilitatorId: string | null;
  turnMode: 'facilitator' | 'timeboxed';
  turnSeconds: number;
  /** Index into participants.turnOrder of the current speaker (null = not started/ended). */
  currentTurn: number | null;
  /**
   * When the current speaker's clock started, or `null` while the turn is PAUSED.
   *
   * `currentTurn != null && turnStartedAt == null` IS the paused state — derived from
   * columns that already exist rather than a third one, and the state `concludeCeremony`
   * already reads correctly (it skips accrual when this is null).
   */
  turnStartedAt: string | null;
  /**
   * The board's default per-member WIP cap for the power meter (migration 1084),
   * resolved server-side. Null when the ceremony's board could not be resolved; a
   * member profile's own `maxConcurrentWip` still wins over it.
   */
  defaultMemberWipCap?: number | null;
  startedAt: string;
  endedAt: string | null;
  /** Set when the cron sweep auto-opened this session from a schedule. */
  scheduleId?: string | null;
  /** Outcome (0365) — who closed it, why, and what it did. */
  concludedBy?: 'human' | 'manager' | 'system' | null;
  closeReason?: CeremonyCloseReason | null;
  humansExpected?: number;
  humansPresent?: number;
  reassignedCount?: number;
  dispatchedCount?: number;
  /** The companion meeting this ceremony is held in (0366). */
  meetingId?: string | null;
  /** Its media relay key, resolved SERVER-SIDE — never derived on the client, so the
   *  round table and the meetings surface join literally the same room. */
  meetingRoomKey?: string | null;
}

export interface CeremonyParticipant {
  id: string;
  sessionId: string;
  memberKind: 'human' | 'cloud_agent' | 'host_agent';
  memberRef: string;
  memberName: string;
  turnOrder: number;
  durationMs: number;
  /** Attendance (0365). `required` false = an ad-hoc joiner, never a no-show. */
  required?: boolean;
  joinedAt?: string | null;
  leftAt?: string | null;
  attendance?: CeremonyAttendance;
  /** Provenance (0366) — 'manual' means a person asserted it and it is never recomputed. */
  attendanceSource?: CeremonyAttendanceSource;
  attendanceNote?: string | null;
  attendanceSetBy?: string | null;
  attendanceSetAt?: string | null;
}

/** One journal row — an `activity_log` event targeting this session. */
export interface CeremonyJournalEvent {
  id: number;
  actorType: string;
  actorName: string | null;
  verb: string;
  targetLabel: string | null;
  summary: string | null;
  occurredAt: string;
  metadata: unknown;
}

export interface CeremonySessionDetail {
  session: CeremonySession | null;
  participants?: CeremonyParticipant[];
  /** Present only on the by-id detail read. */
  journal?: CeremonyJournalEvent[];
}

/** `POST /sessions/:id/minutes/canvas` — mirrors the API's `MinutesToCanvasOutcome`. */
export type CeremonyMinutesToCanvasResult =
  | { status: 'not_found' | 'still_running' | 'no_meeting' | 'not_summarized' | 'nothing_captured' }
  | { status: 'synced'; boards: number; written: number; placed: number; updated: number; removed: number; actionItems: number };

/** A page of concluded ceremonies for one project. */
export interface CeremonyHistoryPage {
  sessions: CeremonySession[];
  /** ISO `startedAt` of the last row; pass as `before` for the next page. */
  nextCursor: string | null;
}

/** Tenant-wide ceremonies rollup — cadence + engagement across all projects. */
export interface CeremonyRollup {
  windowDays: number;
  totals: {
    sessions: number;
    completed: number;
    /** Concluded without being conducted — nobody attended (0365). */
    abandoned: number;
    active: number;
    completionRate: number;
    projects: number;
    avgDurationMinutes: number;
    participants: number;
    avgTurnSeconds: number;
    agentTalkShare: number;
  };
  byKind: Array<{ kind: string; sessions: number }>;
  series: Array<{ day: string; sessions: number }>;
  topTalkers: Array<{ memberKind: string; memberRef: string; memberName: string; talkSeconds: number; turns: number }>;
}

const CEREMONY_BASE = '/api/agile/ceremonies';
export const ceremonySessionsApi = {
  /** Tenant-wide cadence + engagement rollup across every project (MANAGER+). */
  rollup: (days = 30): Promise<CeremonyRollup> =>
    request<CeremonyRollup>(`${CEREMONY_BASE}/rollup?days=${days}`),
  active: (projectId: number, kind: CeremonyKind): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions?projectId=${projectId}&kind=${kind}`),
  start: (projectId: number, kind: CeremonyKind, participants: Array<{ kind: string; ref: string; name: string }>): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions`, { method: 'POST', body: JSON.stringify({ projectId, kind, participants }) }),
  advanceTurn: (id: string, currentTurn: number): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/turn`, { method: 'PATCH', body: JSON.stringify({ currentTurn }) }),
  /**
   * Stop / restart the clock on the current speaker.
   *
   * Turn time used to accrue on wall-clock unconditionally, so a standup that broke off
   * for ten minutes charged all ten to whoever held the floor — and those durations feed
   * the ceremony rollup. Both calls are idempotent server-side.
   */
  pauseTurn: (id: string): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/turn/pause`, { method: 'POST' }),
  resumeTurn: (id: string): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/turn/resume`, { method: 'POST' }),
  /** End the session. The server resolves attendance, applies the ceremony autonomy
   *  rules and dispatches the project's agent-owned work through the canonical
   *  lane-entry gate (bounded) — the client does NOT submit executions itself. */
  complete: (id: string): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/complete`, { method: 'POST' }),
  /** "I am in the room" (0365). Records the CALLER's own presence — the server takes
   *  no identity from the body — so an attendance record can never be forged for
   *  someone else. Member-level, not manager-gated: recording that you turned up is
   *  not an act of facilitation. */
  heartbeat: (id: string): Promise<{ recorded: boolean; reason?: string }> =>
    request(`${CEREMONY_BASE}/sessions/${id}/attendance`, { method: 'POST' }),
  /** Ceremonies that have already run, newest first. Keyset-paginated on startedAt. */
  history: (projectId: number, opts?: { kind?: CeremonyKind; limit?: number; before?: string | null }): Promise<CeremonyHistoryPage> => {
    const q = new URLSearchParams({ projectId: String(projectId) });
    if (opts?.kind) q.set('kind', opts.kind);
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.before) q.set('before', opts.before);
    return request<CeremonyHistoryPage>(`${CEREMONY_BASE}/sessions/history?${q.toString()}`);
  },
  /** One past ceremony in full: roster + attendance verdicts + the journal of what
   *  it did (reassignments, the close), read from the shared activity log. */
  detail: (id: string): Promise<CeremonySessionDetail> =>
    request<CeremonySessionDetail>(`${CEREMONY_BASE}/sessions/${id}`),
  /** Write a concluded ceremony's minutes back onto every board holding its card — the
   *  same server use case that runs when minutes are written; the board adopts the
   *  result through `canvas.changed`. Idempotent: a re-run updates, never duplicates. */
  minutesToCanvas: (id: string): Promise<CeremonyMinutesToCanvasResult> =>
    request<CeremonyMinutesToCanvasResult>(`${CEREMONY_BASE}/sessions/${id}/minutes/canvas`, { method: 'POST' }),
  /** CORRECT one seat's attendance verdict (0366, MANAGER+). Stored as `manual`, which
   *  is what makes it survive a re-conclude — the server never recomputes a manual row.
   *  Allowed on concluded sessions: most corrections are noticed after the fact. */
  correctAttendance: (
    sessionId: string,
    participantId: string,
    attendance: CeremonyAttendance,
    note?: string,
  ): Promise<CeremonySessionDetail> =>
    request<CeremonySessionDetail>(
      `${CEREMONY_BASE}/sessions/${sessionId}/participants/${participantId}/attendance`,
      { method: 'PATCH', body: JSON.stringify({ attendance, note }) },
    ),
};

/** A recurring standup/planning. The frequent cron sweep opens a session for every
 *  due row with its roster pre-seeded, then re-arms nextRunAt from the cron. */
export interface CeremonySchedule {
  id: string;
  projectId: number;
  kind: CeremonyKind;
  /** 5-field cron — the same cadence language as QA schedules / workflow triggers. */
  cron: string;
  timezone: string;
  enabled: boolean;
  turnMode: 'facilitator' | 'timeboxed' | null;
  turnSeconds: number | null;
  /** 'members' derives the roster from member metrics; 'roster' uses `participants`. */
  participantScope: 'members' | 'roster';
  /** JSON array of { kind, ref, name }; only meaningful for the 'roster' scope. */
  participants: string;
  maxParticipants: number;
  autoDispatch: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CeremonyScheduleInput {
  projectId?: number;
  kind?: CeremonyKind;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  turnMode?: 'facilitator' | 'timeboxed' | null;
  turnSeconds?: number | null;
  participantScope?: 'members' | 'roster';
  participants?: Array<{ kind: string; ref: string; name: string }>;
  maxParticipants?: number;
  autoDispatch?: boolean;
}

/** Ceremony cadence CRUD. Reads are member-level; writes are MANAGER+. */
export const ceremonySchedulesApi = {
  list: (projectId: number): Promise<{ schedules: CeremonySchedule[] }> =>
    request(`${CEREMONY_BASE}/schedules?projectId=${projectId}`),
  create: (body: CeremonyScheduleInput): Promise<{ schedule: CeremonySchedule }> =>
    request(`${CEREMONY_BASE}/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: CeremonyScheduleInput): Promise<{ schedule: CeremonySchedule }> =>
    request(`${CEREMONY_BASE}/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string): Promise<{ deleted: boolean }> =>
    request(`${CEREMONY_BASE}/schedules/${id}`, { method: 'DELETE' }),
};
