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
 * `maybeAutoRunOnLaneEntry` path (see dispatchCeremonyCompletion below), which is
 * additionally bounded per session. The cron branches share no budget, so this
 * sweep is also bounded by SWEEP_LIMIT rows per tick.
 */

import { and, eq, isNotNull, lte, asc } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  ceremonySchedules,
  ceremonySessions,
  ceremonyParticipants,
  boards,
  tasks,
} from '../../infrastructure/database/schema';
import { nextCronTime } from '../../domain/workflowSchedule';
import {
  computeMemberMetrics,
  memberMetricsCacheKey,
  readWorkforceMetricsVersion,
  type MemberScorecard,
} from '../metrics/workforceMetrics';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { buildRuntimeService } from '../../buildRuntimeService';
import type { Env } from '../../env';

/** Max schedules processed per sweep — bounds work per cron tick. */
const SWEEP_LIMIT = 25;

/** Window (days) used when deriving a roster from member metrics. */
const ROSTER_METRICS_DAYS = 30;

/** Hard ceiling on agent runs kicked off by one completed ceremony. */
export const MAX_DISPATCH_PER_CEREMONY = 20;

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
 * is malformed or unsatisfiable, so a bad row paces out instead of wedging.
 */
export function computeNextCeremonyRun(cron: string, timezone: string, now: Date): Date {
  return nextCronTime(cron, now, timezone) ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
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
      updatedAt: now,
    })),
  );

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
      console.error(`[cron:ceremonies] schedule ${s.id} failed`, err);
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
      console.error(`[cron:ceremonies] watermark update failed ${s.id}`, err);
    }
  }

  return result;
}

/**
 * Server-side "dispatch agent work when a ceremony completes".
 *
 * This used to live in the browser (CeremonyStage.completeSession looped over the
 * client's loaded task list and POSTed raw executions, fire-and-forget). That made
 * a core automation depend on a tab staying open, silently swallowed failures, and
 * only saw the tasks the client happened to have fetched.
 *
 * Now it runs from POST /sessions/:id/complete. Rather than submitting executions
 * directly, each candidate goes through the canonical `maybeAutoRunOnLaneEntry`
 * gate — which already applies the terminal/board/lane/gate resolution, the
 * capability guardrail, the re-run cooldown, the token gate and the live-run
 * idempotency check. That last one subsumes the client's hand-rolled
 * `latestExecByTask` dedupe entirely.
 *
 * BOUNDED: at most MAX_DISPATCH_PER_CEREMONY runs per completed ceremony.
 */
export async function dispatchCeremonyCompletion(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; sessionId: string },
): Promise<{ candidates: number; dispatched: number }> {
  const runtimeService = buildRuntimeService(env, db);

  // Agent-owned, non-terminal tickets on this project. The gate re-checks each
  // one, so a generous filter here is safe.
  const candidates = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.tenantId, args.tenantId), eq(tasks.projectId, args.projectId)))
    .limit(200);

  let dispatched = 0;
  for (const t of candidates) {
    if (dispatched >= MAX_DISPATCH_PER_CEREMONY) break;
    if (t.status === 'done') continue;
    try {
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId: args.tenantId,
        projectId: args.projectId,
        taskId: t.id,
        status: t.status,
        submittedBy: `system:ceremony:${args.sessionId}`,
      });
      if (started) dispatched += 1;
    } catch (err) {
      console.error(`[ceremony:complete] dispatch failed task=${t.id}`, err);
    }
  }

  return { candidates: candidates.length, dispatched };
}
