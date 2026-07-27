import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runDueCeremonies — the scheduler half of Ceremonies.
 *
 * Before this sweep a ceremony only existed if a human clicked "start". The
 * cadence that DID exist was the standup *digest email* (report_schedules), which
 * is a report, not a ceremony. This is the missing piece: for every enabled
 * `ceremony_schedules` row whose `next_run_at` has elapsed, open a real
 * `ceremony_sessions` row with its roster pre-seeded, then re-arm `next_run_at`
 * from the cron expression.
 *
 * Follows the established due-work-then-re-arm shape of
 * application/workflow/runDueTriggers.ts and application/qa/runQaExplorationSweep.ts:
 *
 *   - a single indexed "due rows" query that returns nothing on an idle tick,
 *   - per-row try/catch so one bad schedule can't stall the sweep,
 *   - the watermark (`last_run_at` / `next_run_at`) advanced UNCONDITIONALLY, so a
 *     failing schedule paces out to its own cadence instead of retrying every tick,
 *   - a re-arm fallback (+24h) so a malformed cron can never wedge a row.
 *
 * First-poll / backlog guard: the sweep requires `next_run_at IS NOT NULL` (the
 * runDueTriggers rule, deliberately NOT the qa/report `isNull(...) = due` rule).
 * `next_run_at` is armed at create/enable time by the CRUD route, so a freshly
 * created schedule fires at its first genuine cadence instant rather than on the
 * next tick. And because the re-arm is anchored to `now` (not to the previous
 * `next_run_at`), a Worker outage never backfills a queue of missed ceremonies —
 * at most one session per cadence.
 *
 * COST NOTE (deliberate): this branch dispatches NO LLM work. Opening a ceremony
 * is pure DB writes plus one cached member-metrics read. The agent participation
 * in a ceremony is representational — agents are seeded as `ceremony_participants`
 * rows so they hold a turn in the round table — and any actual agent *execution*
 * happens later, on session completion, through the existing token-gated
 * `maybeAutoRunOnLaneEntry` path (see application/ceremony/dispatchCeremonyCompletion),
 * which is additionally bounded per session. The cron branches share no budget, so this
 * sweep is also bounded by SWEEP_LIMIT rows per tick. The reaper below adds no LLM work
 * either: "the manager conducts the standup" is attendance resolution + the existing
 * gated dispatch, not a generated summary.
 *
 * TWO HALVES (0365). Opening a ceremony was only ever half a cadence:
 *
 *   • {@link runDueCeremonies} — opens due sessions, and now INVITES their humans. A
 *     scheduled ceremony used to open in silence, so the only way to learn yours had
 *     started was to already be watching the tab you are not watching when you are about
 *     to miss it.
 *   • {@link runCeremonyReaper} — CLOSES sessions nobody closed. Without it a scheduled
 *     ceremony could never end: `uq_ceremony_session_active(project_id, kind)` permits one
 *     live session per board+kind, so the first standup left open silently blocked every
 *     future standup on that board while the schedule recorded 'already_active' daily.
 */

import { and, asc, eq, isNotNull, lt, lte } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  ceremonySchedules,
  ceremonySessions,
  ceremonyParticipants,
  boards,
  projects,
} from '../../infrastructure/database/schema';
import { nextCronTime } from '../../domain/workflowSchedule';
import {
  computeMemberMetrics,
  memberMetricsCacheKey,
  readWorkforceMetricsVersion,
  type MemberScorecard,
} from '../metrics/workforceMetrics';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { getEffectiveManagerPolicy } from '../manager/ManagerService';
import { concludeCeremonySession } from './concludeCeremony';
import { notifyCeremonyOpened } from './ceremonyNotifier';
import { ensureCeremonyMeeting } from './ceremonyMeeting';
import type { Env } from '../../env';

/** Max schedules processed per sweep — bounds work per cron tick. */
const SWEEP_LIMIT = 25;

/** Window (days) used when deriving a roster from member metrics. */
const ROSTER_METRICS_DAYS = 30;

/**
 * How long a session may stay open before the reaper concludes it.
 *
 * Generously long on purpose: this is a WEDGE-BREAKER, not a meeting timer. A standup
 * that genuinely runs 40 minutes must not be cut off mid-turn, but a session left open
 * overnight has to be closed before it blocks tomorrow's — and four hours is comfortably
 * past any real ceremony while still clearing the way well before the next daily cadence.
 */
export const MAX_SESSION_HOURS = 4;

/** Max sessions the reaper concludes per tick — bounds work like SWEEP_LIMIT does. */
const REAP_LIMIT = 25;

/** A seat at the round table. Shape matches ceremony_participants. */
export interface CeremonyRosterEntry {
  kind: string;
  ref: string;
  name: string;
}

/**
 * Derive the roster for a scheduled ceremony.
 *
 * `roster` scope uses the explicit participants captured on the schedule.
 * `members` scope reads the EXISTING member-metrics reader (computeMemberMetrics,
 * migrations 0116-0118) through the canonical read-through cache under the SAME
 * key the /api/members/metrics route uses — no re-aggregation, and a warm key is
 * shared with the members surface.
 *
 * Turn order for a derived roster is ascending engagement: the quietest members
 * speak first, which is the whole point of a timed round table. Nulls sort last.
 */
export function buildRoster(
  scopeKind: string,
  explicit: CeremonyRosterEntry[],
  cards: MemberScorecard[],
  max: number,
): CeremonyRosterEntry[] {
  const cap = Math.max(1, max);
  if (scopeKind === 'roster') {
    return explicit.filter((p) => p && p.ref).slice(0, cap);
  }
  return [...cards]
    .sort((a, b) => {
      const av = a.engagementScore ?? Number.POSITIVE_INFINITY;
      const bv = b.engagementScore ?? Number.POSITIVE_INFINITY;
      if (av !== bv) return av - bv;
      return a.memberName.localeCompare(b.memberName);
    })
    .slice(0, cap)
    .map((m) => ({ kind: m.memberKind, ref: m.memberRef, name: m.memberName }));
}

/** Parse the schedule's stored participants JSON, tolerating malformed content. */
export function parseParticipants(raw: string | null | undefined): CeremonyRosterEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({ kind: String(p.kind ?? 'human'), ref: String(p.ref ?? ''), name: String(p.name ?? '') }))
      .filter((p) => p.ref);
  } catch {
    return [];
  }
}

/**
 * Compute the next armed instant for a schedule. Falls back to +24h when the cron
 * is unsatisfiable (nextCronTime returns null, e.g. Feb 31) OR malformed
 * (nextCronTime THROWS — parseCron rejects a wrong field count / bad range).
 *
 * The throw case matters: this is called from the watermark update, which runs
 * outside the per-row try/catch's protection of the ceremony-opening work. An
 * uncaught throw here would leave next_run_at unchanged and the row would be
 * re-selected as due on EVERY subsequent tick — the exact wedge this guards.
 * The CRUD route validates cron on write, but rows can predate that or arrive
 * via another writer, so the sweep never trusts the stored value.
 */
export function computeNextCeremonyRun(cron: string, timezone: string, now: Date): Date {
  const fallback = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    return nextCronTime(cron, now, timezone) ?? fallback;
  } catch {
    return fallback;
  }
}

type ScheduleRow = typeof ceremonySchedules.$inferSelect;

/**
 * Open one ceremony session for a due schedule. Returns the new session id, or
 * null with a status describing why nothing was opened.
 */
async function openScheduledCeremony(
  env: Env,
  db: Db,
  s: ScheduleRow,
  now: Date,
): Promise<{ sessionId: string | null; status: string }> {
  // Idempotency: never stack a second live session on a board+kind that already
  // has one (a long-running ceremony spanning the next cadence instant, or a
  // human who started it manually). Mirrors POST /sessions.
  const [live] = await db
    .select({ id: ceremonySessions.id })
    .from(ceremonySessions)
    .where(
      and(
        eq(ceremonySessions.tenantId, s.tenantId),
        eq(ceremonySessions.projectId, s.projectId),
        eq(ceremonySessions.kind, s.kind),
        eq(ceremonySessions.status, 'active'),
      ),
    )
    .limit(1);
  if (live) return { sessionId: null, status: 'already_active' };

  // Roster. Only the 'members' scope needs the metrics read.
  let cards: MemberScorecard[] = [];
  if (s.participantScope !== 'roster') {
    const version = await readWorkforceMetricsVersion(env, s.tenantId);
    cards = await getOrSetCached(
      env,
      `${memberMetricsCacheKey(s.tenantId, version, ROSTER_METRICS_DAYS)}:p:${s.projectId}`,
      () => computeMemberMetrics(db, s.tenantId, ROSTER_METRICS_DAYS, s.projectId),
      { kvTtlSeconds: 300, l1TtlMs: 30_000 },
    );
  }
  const roster = buildRoster(s.participantScope, parseParticipants(s.participants), cards, s.maxParticipants);
  if (roster.length === 0) return { sessionId: null, status: 'no_participants' };

  // Turn settings: the schedule's override wins, else the board's, else defaults.
  const [board] = await db
    .select({ mode: boards.standupTurnMode, seconds: boards.standupTurnSeconds })
    .from(boards)
    .where(and(eq(boards.tenantId, s.tenantId), eq(boards.projectId, s.projectId)))
    .limit(1);

  const isStandup = s.kind === 'standup';
  const [session] = await db
    .insert(ceremonySessions)
    .values({
      tenantId: s.tenantId,
      segmentId: s.segmentId ?? undefined,
      projectId: s.projectId,
      kind: s.kind,
      status: 'active',
      facilitatorId: null, // opened by the scheduler; the first human to act facilitates
      turnMode: s.turnMode ?? board?.mode ?? 'facilitator',
      turnSeconds: s.turnSeconds ?? board?.seconds ?? 90,
      currentTurn: isStandup ? 0 : null,
      turnStartedAt: isStandup ? now : null,
      startedAt: now,
      scheduleId: s.id,
      updatedAt: now,
    })
    .returning({ id: ceremonySessions.id });
  if (!session) return { sessionId: null, status: 'insert_failed' };

  await db.insert(ceremonyParticipants).values(
    roster.map((p, i) => ({
      tenantId: s.tenantId,
      segmentId: s.segmentId ?? undefined,
      sessionId: session.id,
      memberKind: p.kind,
      memberRef: p.ref,
      memberName: p.name,
      turnOrder: i,
      // A scheduled roster is EXPECTED to attend — that is what makes a no-show
      // meaningful. Ad-hoc joiners are seated with required=false at heartbeat time.
      required: true,
      updatedAt: now,
    })),
  );

  // The companion meeting (0366) — the calendar entry + media room this ceremony is held
  // in. Best-effort and after the roster insert, because it seeds the meeting's guest
  // list from it: a ceremony whose shell failed to mint is still a valid ceremony that
  // records attendance, whereas a shell with no guests would be a link to an empty room.
  try {
    await ensureCeremonyMeeting(db, {
      id: session.id,
      tenantId: s.tenantId,
      segmentId: s.segmentId,
      projectId: s.projectId,
      kind: s.kind,
      // The scheduler opens the session with no facilitator (the first human to act
      // facilitates), so the meeting is hosted by nobody until someone joins.
      facilitatorId: null,
      startedAt: now,
      meetingId: null,
    });
  } catch (err) {
    reportCaughtError(err, { source: "application/ceremony/runDueCeremonies.ts", operation: "openScheduledCeremony", context: { logMessage: `[cron:ceremonies] companion meeting failed session=${session.id}`, details: err } });
  }

  // Invite the humans. Best-effort, and likewise after the roster insert.
  try {
    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, s.projectId))
      .limit(1);
    await notifyCeremonyOpened(env, db, {
      tenantId: s.tenantId,
      projectId: s.projectId,
      projectName: project?.name ?? null,
      sessionId: session.id,
      kind: s.kind,
    });
  } catch (err) {
    reportCaughtError(err, { source: "application/ceremony/runDueCeremonies.ts", operation: "openScheduledCeremony", context: { logMessage: `[cron:ceremonies] invite fan-out failed session=${session.id}`, details: err } });
  }

  return { sessionId: session.id, status: 'opened' };
}

export interface CeremonySweepResult {
  due: number;
  opened: number;
  skipped: number;
  errors: number;
}

/** Process all due ceremony schedules. Safe to call on every cron tick. */
export async function runDueCeremonies(env: Env): Promise<CeremonySweepResult> {
  const db = buildDatabase(env);
  const now = new Date();

  const due = await db
    .select()
    .from(ceremonySchedules)
    .where(
      and(
        eq(ceremonySchedules.enabled, true),
        // First-poll guard: an unarmed row is NOT due (armed at create/enable).
        isNotNull(ceremonySchedules.nextRunAt),
        lte(ceremonySchedules.nextRunAt, now),
      ),
    )
    .orderBy(asc(ceremonySchedules.nextRunAt))
    .limit(SWEEP_LIMIT);

  const result: CeremonySweepResult = { due: due.length, opened: 0, skipped: 0, errors: 0 };

  for (const s of due) {
    let status = 'opened';
    let sessionId: string | null = null;
    try {
      const r = await openScheduledCeremony(env, db, s, now);
      status = r.status;
      sessionId = r.sessionId;
      if (r.sessionId) result.opened += 1;
      else result.skipped += 1;
    } catch (err) {
      status = 'error';
      result.errors += 1;
      reportCaughtError(err, { source: "application/ceremony/runDueCeremonies.ts", operation: "runDueCeremonies", context: { logMessage: `[cron:ceremonies] schedule ${s.id} failed`, details: err } });
    }

    // Advance the watermark regardless of outcome so a failing schedule paces out
    // to its own cadence instead of retrying on every tick.
    try {
      await db
        .update(ceremonySchedules)
        .set({
          lastRunAt: now,
          lastStatus: status.slice(0, 24),
          ...(sessionId ? { lastSessionId: sessionId } : {}),
          nextRunAt: computeNextCeremonyRun(s.cron, s.timezone, now),
          updatedAt: now,
        })
        .where(eq(ceremonySchedules.id, s.id));
    } catch (err) {
      reportCaughtError(err, { source: "application/ceremony/runDueCeremonies.ts", operation: "runDueCeremonies", context: { logMessage: `[cron:ceremonies] watermark update failed ${s.id}`, details: err } });
    }
  }

  return result;
}

export interface CeremonyReapResult {
  /** Sessions found past MAX_SESSION_HOURS. */
  due: number;
  /** Conducted and closed — the manager ran the ceremony. */
  completed: number;
  /** Closed WITHOUT being conducted (nobody came, unattended not granted). */
  abandoned: number;
  errors: number;
}

/**
 * Close ceremonies nobody closed — the other half of the cadence.
 *
 * Every conclusion goes through the SAME `concludeCeremonySession` a human's Complete
 * click uses, so a reaped session and a facilitated one differ only in the recorded
 * `concluded_by` / `close_reason`, never in what actually happened. In particular the
 * policy gate is not re-implemented here: whether an empty room may be conducted at all
 * is decided in one place, by the manager policy fold.
 *
 * Idempotent and race-safe: `concludeCeremonySession` returns null for a session that is
 * no longer active, so a reap that collides with a human clicking Complete is a no-op
 * rather than a double-close.
 */
export async function runCeremonyReaper(env: Env, db: Db, now = new Date()): Promise<CeremonyReapResult> {
  const cutoff = new Date(now.getTime() - MAX_SESSION_HOURS * 3_600_000);

  const stale = await db
    .select()
    .from(ceremonySessions)
    .where(and(eq(ceremonySessions.status, 'active'), lt(ceremonySessions.startedAt, cutoff)))
    .orderBy(asc(ceremonySessions.startedAt))
    .limit(REAP_LIMIT);

  const result: CeremonyReapResult = { due: stale.length, completed: 0, abandoned: 0, errors: 0 };

  // One policy read per (tenant, project) rather than per session — a tenant reaping
  // several boards at once would otherwise re-read the same workspace defaults each time.
  const policyCache = new Map<string, Awaited<ReturnType<typeof getEffectiveManagerPolicy>>>();

  for (const session of stale) {
    try {
      const key = `${session.tenantId}:${session.projectId}`;
      let policy = policyCache.get(key);
      if (!policy) {
        policy = await getEffectiveManagerPolicy(db, session.tenantId, session.projectId, env);
        policyCache.set(key, policy);
      }

      const outcome = await concludeCeremonySession(env, db, session, {
        // The manager conducts when it may; otherwise this is the system tidying up a
        // session that expired. `concludedBy` records which of the two it was.
        concludedBy: policy.allowUnattendedCeremonies ? 'manager' : 'system',
        reasonHint: 'expired',
        policy,
      });
      if (!outcome) continue;
      if (outcome.status === 'completed') result.completed += 1;
      else result.abandoned += 1;
    } catch (err) {
      result.errors += 1;
      reportCaughtError(err, { source: "application/ceremony/runDueCeremonies.ts", operation: "runCeremonyReaper", context: { logMessage: `[cron:ceremonies] reap failed session=${session.id}`, details: err } });
    }
  }

  return result;
}
