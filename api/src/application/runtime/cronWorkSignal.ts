import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * cronWorkSignal — the KV gate that lets Neon compute autosuspend.
 *
 * THE PROBLEM. The frequent every-5-minute cron (see scheduled() in src/index.ts)
 * fires ~14 cross-tenant sweeps every five minutes, UNCONDITIONALLY. Each sweep
 * queries Postgres, so the Neon endpoint is woken every five minutes forever and
 * never idles long enough to scale to zero — ~730 compute-hours/month, far past
 * the Free-tier ceiling. On a platform that is quiet most of the day, almost all
 * of that compute is spent discovering there was nothing to do.
 *
 * THE FIX. Idle ticks must touch ZERO Postgres so the endpoint can sleep. This
 * module holds a tiny KV signal (read/written on the shared AUTH_CACHE_KV
 * namespace, `cron:` prefixed) that answers "should this tick run the DB
 * fan-out?" using KV alone — no Neon round-trip:
 *
 *   • A write that creates backstop-eligible work (a ticket entering a runnable
 *     lane — see maybeAutoRunOnLaneEntry) calls {@link signalPendingWork}. The
 *     next tick then runs the fan-out and dispatches within 5 minutes.
 *   • {@link evaluateCronGate} lets the tick RUN when the signal is set OR the
 *     floor interval has elapsed; otherwise it SKIPS and Neon stays asleep.
 *   • The FLOOR sweep is the safety net: even with zero signals, the fan-out runs
 *     at least once per {@link FLOOR_INTERVAL_MS}, so a missed signal can strand
 *     work no longer than that. This is why partial write-path coverage is safe.
 *
 * FAIL-OPEN. If KV is unbound or a read throws, the gate returns `run: true` —
 * the gate can slow a tick but must NEVER hide work. Worst case we degrade to the
 * old always-run behaviour, never to lost dispatches.
 */
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ceremonySchedules, cronJobs, qaSchedules, reportSchedules, workflowTriggers } from '../../infrastructure/database/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

/** KV key: presence => a write signalled possibly-pending backstop work. */
const WORK_SIGNAL_KEY = 'cron:work-pending';
/** KV key: epoch-ms of the last floor (unconditional) fan-out. */
const FLOOR_TS_KEY = 'cron:last-floor-sweep';
/**
 * KV key: epoch-ms of the EARLIEST `next_run_at` across every schedule table, as
 * observed at the end of the last active tick (see {@link publishNextDue}).
 *
 * This is what makes a TIME-scheduled sweep precise on an idle platform. The
 * work-pending signal only covers WRITE-driven work (a ticket entering a runnable
 * lane); a schedule that simply comes due — a 09:00 report, a 15-minute QA run —
 * signals nothing, so before this key such a sweep could only fire on the floor
 * sweep and ran up to a full floor interval late.
 *
 * Storing the ANSWER (a timestamp) rather than asking the question keeps the gate's
 * contract intact: an idle tick still reads KV only and never wakes Neon.
 */
const NEXT_DUE_KEY = 'cron:next-due';

/**
 * KV key: the JSON {@link ScheduleStallReport} describing armed schedule rows that
 * have been due for longer than one floor interval — i.e. rows the sweeps have
 * already had their chance at and did not clear.
 *
 * This is the OTHER half of the bound on the `due` branch. The gate deliberately
 * stops treating a very old due time as a fresh one (see {@link classifyDueTime}),
 * because an unbounded check would pin the gate open on every tick and undo the
 * autosuspend this module exists to buy. Declining to act on it, though, is not the
 * same as noticing it: without this key a jammed schedule is indistinguishable from
 * an idle platform — both read as "nothing due" and quietly run at floor cadence.
 * Storing the observation lets `GET /api/admin/cron` say which it is.
 */
const SCHEDULE_STALL_KEY = 'cron:schedule-stall';

/**
 * Max time an idle platform can leave a missed signal unprocessed. The live path
 * (maybeAutoRunOnLaneEntry) already dispatches the common case instantly and the
 * signal covers dropped kickoffs, so the floor only backstops a signal that was
 * both lost AND whose live dispatch was dropped — rare. 30 min keeps idle
 * wake-ups to ~48/day while bounding worst-case staleness.
 */
export const FLOOR_INTERVAL_MS = 30 * 60 * 1000;

/** Bounds on the `CRON_FLOOR_INTERVAL_MS` override — see {@link floorIntervalMs}. */
export const MIN_FLOOR_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_FLOOR_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Effective floor interval: the optional `CRON_FLOOR_INTERVAL_MS` var, clamped,
 * else {@link FLOOR_INTERVAL_MS}. Tunable because the constant encodes a COST
 * decision (idle wake-ups/day against the Neon Free compute ceiling), not a
 * correctness one — an operator on a paid Neon plan wants it tighter, and one
 * pinned under the free ceiling wants it looser, neither of which should need a
 * redeploy of new code.
 *
 * Clamped both ways: below the 5-minute tick the floor would fire every tick and
 * defeat the gate entirely, and past 6h a missed signal could strand work for
 * most of a day. A garbage value falls back to the default rather than throwing —
 * a mistyped var must never be able to break the cron path.
 */
export function floorIntervalMs(env: Env): number {
  const raw = Number(env.CRON_FLOOR_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return FLOOR_INTERVAL_MS;
  return Math.min(Math.max(Math.floor(raw), MIN_FLOOR_INTERVAL_MS), MAX_FLOOR_INTERVAL_MS);
}

/**
 * TTL on the pending-work flag. Generous so a real backlog paced across ticks is
 * never expired mid-drain; it is normally consumed explicitly at tick open. Acts
 * only as a floor-independent backstop against a leaked flag.
 */
const SIGNAL_TTL_SECONDS = 6 * 60 * 60;

/** Sentinel stored in {@link NEXT_DUE_KEY} when no schedule is armed at all. Distinct
 *  from an ABSENT key ("never published") only for observability — the gate treats
 *  both as "no due time known" and leans on the floor sweep. */
const NO_SCHEDULES = 'none';

/**
 * TTL on the next-due stamp. Longer than the max floor interval so the stamp always
 * outlives the gap between two active ticks; if it ever DOES expire the gate simply
 * falls back to floor-only behaviour, which is exactly the pre-gate contract.
 */
const NEXT_DUE_TTL_SECONDS = 24 * 60 * 60;

/**
 * TTL on the stall report. Long, because a jam is a condition that PERSISTS and the
 * report carries `firstDetectedMs` — an operator opening the cron panel a day later
 * should still see how long it has been jammed, not a freshly-reset counter. It is
 * cleared explicitly the moment nothing is stuck (see {@link publishNextDue}), so the
 * TTL only bounds a report whose publisher stopped running entirely.
 */
const SCHEDULE_STALL_TTL_SECONDS = 7 * 24 * 60 * 60;

function kv(env: Env): KVNamespace | undefined {
  return env.AUTH_CACHE_KV;
}

/**
 * How a published next-due stamp reads against the clock.
 *
 * `stuck` is the case this module used to have no word for: the row IS due, but by
 * more than a whole floor interval — every sweep that could clear it has already run
 * at least once and did not. That is a jam (a sweep switched off in cron controls, a
 * generator erroring past its retries), not a schedule waiting its turn, and the two
 * want opposite responses: run the fan-out for a `due` row, RAISE a `stuck` one.
 *
 * ONE predicate, two callers — {@link evaluateCronGate} decides whether to run from
 * it and {@link publishNextDue} decides what to raise from it — so the boundary
 * between "due" and "stuck" can never drift between the gate and the diagnostic.
 */
export type ScheduleDueState = 'none' | 'future' | 'due' | 'stuck';

export function classifyDueTime(nextDueMs: number | null, nowMs: number, intervalMs: number): ScheduleDueState {
  if (nextDueMs == null) return 'none';
  if (nowMs < nextDueMs) return 'future';
  return nowMs - nextDueMs <= intervalMs ? 'due' : 'stuck';
}

/** One armed schedule row that has been due for longer than a floor interval. */
export interface StalledSchedule {
  /** Schedule table the overdue row lives in (see SCHEDULE_SOURCES). */
  table: string;
  /** The row's `next_run_at`, epoch-ms. */
  dueAtMs: number;
  /** How far past its due time it is, at the observation instant. */
  overdueMs: number;
}

/** What the cron panel needs to tell "idle" from "jammed". */
export interface ScheduleStallReport {
  /** Epoch-ms the CURRENT stall was first seen — carried across ticks, so this is
   *  "jammed since", not "noticed this tick". */
  firstDetectedMs: number;
  /** Epoch-ms of the most recent observation. */
  observedMs: number;
  /** Consecutive active ticks that have observed a stall. */
  observations: number;
  /** Epoch-ms this stall was last written to the error log — see the rate limit in
   *  {@link publishNextDue}. */
  lastRaisedMs: number;
  /** The overdue rows, one entry per schedule table, earliest first. */
  tables: StalledSchedule[];
}

/**
 * Record that backstop-eligible work may exist, so the next frequent cron tick
 * runs the fan-out instead of skipping it. Cheap, idempotent, best-effort:
 * callers MUST NOT block their request on it (fire-and-forget or `void`). A lost
 * write just means the floor sweep catches the work up to FLOOR_INTERVAL_MS later.
 */
export async function signalPendingWork(env: Env): Promise<void> {
  const store = kv(env);
  if (!store) return;
  try {
    await store.put(WORK_SIGNAL_KEY, '1', { expirationTtl: SIGNAL_TTL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cronWorkSignal.ts", operation: "signalPendingWork", context: { logMessage: '[cron-work-signal] pending-work signal write failed; floor sweep remains active', details: { error } } });
  }
}

export interface CronGateDecision {
  /** Whether this tick should run the Postgres fan-out. */
  run: boolean;
  /** Why it runs (or is idle) — logged so the gate's behaviour is observable. */
  reason: 'signal' | 'due' | 'floor' | 'idle' | 'kv-unavailable';
  /** True when this run also satisfies the periodic floor (stamp the floor ts). */
  floorDue: boolean;
  /** Epoch-ms of the last floor sweep, or null when never stamped / KV is down. */
  lastFloorMs: number | null;
  /** Effective floor interval in force for this decision. */
  floorIntervalMs: number;
  /** Earliest known scheduled due time (epoch-ms), or null when unknown/none armed. */
  nextDueMs: number | null;
  /**
   * How that due time reads against the clock. `stuck` is the one an operator has to
   * act on: the gate is behaving correctly (it declines to re-open on an ancient due
   * time) but the underlying row is not being cleared by any sweep. Reported here so
   * the state is visible on the decision itself, not only in the stall report the
   * publisher writes.
   */
  dueState: ScheduleDueState;
}

/**
 * Decide whether the frequent tick runs. READS KV ONLY — never touches Neon — so
 * an idle platform lets the DB endpoint scale to zero. Fails OPEN (runs) whenever
 * KV is unavailable so the gate can never hide work.
 */
export async function evaluateCronGate(env: Env, nowMs: number): Promise<CronGateDecision> {
  const interval = floorIntervalMs(env);
  const store = kv(env);
  if (!store) {
    return { run: true, reason: 'kv-unavailable', floorDue: true, lastFloorMs: null, floorIntervalMs: interval, nextDueMs: null, dueState: 'none' };
  }
  try {
    const [sig, lastFloorRaw, nextDueRaw] = await Promise.all([
      store.get(WORK_SIGNAL_KEY),
      store.get(FLOOR_TS_KEY),
      store.get(NEXT_DUE_KEY),
    ]);
    const last = lastFloorRaw ? Number(lastFloorRaw) : 0;
    const floorDue = !Number.isFinite(last) || nowMs - last >= interval;
    const lastFloorMs = Number.isFinite(last) && last > 0 ? last : null;
    const nextDueMs = parseNextDue(nextDueRaw);
    // The gate's `due` window is bounded on BOTH sides, and classifyDueTime owns that
    // boundary for the whole module: a row overdue by more than a floor interval is
    // `stuck`, not `due`, so it cannot re-open this gate on every tick and undo the
    // autosuspend. It still RUNS — on the floor sweep, exactly as it did pre-gate —
    // and publishNextDue raises it so "jammed" stops looking like "idle".
    const dueState = classifyDueTime(nextDueMs, nowMs, interval);
    if (sig != null) return { run: true, reason: 'signal', floorDue, lastFloorMs, floorIntervalMs: interval, nextDueMs, dueState };
    if (dueState === 'due') {
      return { run: true, reason: 'due', floorDue, lastFloorMs, floorIntervalMs: interval, nextDueMs, dueState };
    }
    if (floorDue) return { run: true, reason: 'floor', floorDue: true, lastFloorMs, floorIntervalMs: interval, nextDueMs, dueState };
    return { run: false, reason: 'idle', floorDue: false, lastFloorMs, floorIntervalMs: interval, nextDueMs, dueState };
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cronWorkSignal.ts", operation: "evaluateCronGate", context: { logMessage: '[cron-work-signal] gate read failed; running fan-out fail-open', details: { nowMs, error } } });
    // A KV blip must never strand work — run the fan-out this tick.
    return { run: true, reason: 'kv-unavailable', floorDue: true, lastFloorMs: null, floorIntervalMs: interval, nextDueMs: null, dueState: 'none' };
  }
}

/**
 * Read the stall report the last active tick published, or null when nothing is
 * jammed. KV-only, like the rest of the gate — the cron panel calls it on every load
 * and must not wake Postgres to answer "is anything stuck?". Never throws: a corrupt
 * or unreachable value reads as "no stall known", which degrades the panel to what it
 * showed before this existed rather than failing it.
 */
export async function readScheduleStall(env: Env): Promise<ScheduleStallReport | null> {
  const store = kv(env);
  if (!store) return null;
  try {
    return parseStallReport(await store.get(SCHEDULE_STALL_KEY));
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cronWorkSignal.ts',
      operation: 'readScheduleStall',
      context: { logMessage: '[cron-work-signal] stall report read failed', details: { error } },
    });
    return null;
  }
}

/** Parse a stored stall report defensively — an unreadable one is simply "none". */
function parseStallReport(raw: string | null): ScheduleStallReport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScheduleStallReport>;
    if (!Array.isArray(parsed?.tables) || parsed.tables.length === 0) return null;
    if (!Number.isFinite(parsed.firstDetectedMs)) return null;
    return {
      firstDetectedMs: Number(parsed.firstDetectedMs),
      observedMs: Number(parsed.observedMs ?? parsed.firstDetectedMs),
      observations: Number(parsed.observations ?? 1),
      lastRaisedMs: Number(parsed.lastRaisedMs ?? 0),
      tables: parsed.tables
        .filter((t): t is StalledSchedule => Boolean(t) && typeof t.table === 'string' && Number.isFinite(t.dueAtMs))
        .map((t) => ({ table: t.table, dueAtMs: Number(t.dueAtMs), overdueMs: Number(t.overdueMs ?? 0) })),
    };
  } catch {
    return null;
  }
}

/**
 * Parse the stored next-due stamp. An ABSENT key means "not published yet", and a
 * published {@link NO_SCHEDULES} means "nothing is armed" — both resolve to null,
 * which simply leaves the floor sweep as the only backstop. Deliberately never
 * throws: a corrupt value must degrade to the pre-existing floor behaviour rather
 * than break the gate.
 */
function parseNextDue(raw: string | null): number | null {
  if (raw == null || raw === NO_SCHEDULES) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Open a tick that has decided to run: CONSUME the pending-work signal (so a
 * fully-drained platform goes cold and the next idle tick skips) and, when this
 * run satisfies the floor, stamp the floor timestamp. Called BEFORE firing the
 * sweeps so that any re-signal a sweep emits mid-tick (e.g. a paced backlog —
 * see {@link signalPendingWork} in autonomousExecutionSweep) survives the
 * consume and keeps the next tick hot. Best-effort.
 */
export async function openCronTick(env: Env, nowMs: number, floorDue: boolean): Promise<void> {
  const store = kv(env);
  if (!store) return;
  try {
    await Promise.all([
      store.delete(WORK_SIGNAL_KEY),
      floorDue ? store.put(FLOOR_TS_KEY, String(nowMs)) : Promise.resolve(),
    ]);
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cronWorkSignal.ts", operation: "openCronTick", context: { logMessage: '[cron-work-signal] tick signal consume failed', details: { nowMs, floorDue, error } } });
  }
}

/**
 * The schedule tables the time-driven sweeps read. Each pairs its `next_run_at`
 * column with the flag that decides whether the row is armed, because a DISABLED
 * schedule must not hold the gate open — it would wake Neon on a due time nothing
 * will ever act on.
 *
 * This is a registry rather than five branches so adding a scheduled surface is a
 * DATA change here (and a test that fails until it is made), not a new `UNION`
 * arm someone has to remember to write. Keep it in step with the sweeps in
 * `CRON_SWEEPS` that read a `next_run_at`.
 */
const SCHEDULE_SOURCES = [
  { name: 'workflow_triggers', table: workflowTriggers, nextRunAt: workflowTriggers.nextRunAt, enabled: workflowTriggers.enabled },
  { name: 'cron_jobs',         table: cronJobs,         nextRunAt: cronJobs.nextRunAt,         enabled: cronJobs.enabled },
  { name: 'ceremony_schedules',table: ceremonySchedules,nextRunAt: ceremonySchedules.nextRunAt,enabled: ceremonySchedules.enabled },
  { name: 'report_schedules',  table: reportSchedules,  nextRunAt: reportSchedules.nextRunAt,  enabled: reportSchedules.isEnabled },
  { name: 'qa_schedules',      table: qaSchedules,      nextRunAt: qaSchedules.nextRunAt,      enabled: qaSchedules.enabled },
] as const;

/** Names of the schedule tables the next-due gate reads — exported for the test that
 *  keeps {@link SCHEDULE_SOURCES} honest against the schema. */
export const NEXT_DUE_SCHEDULE_TABLES = SCHEDULE_SOURCES.map((source) => source.name);

/**
 * Publish the earliest armed `next_run_at` across every schedule table to KV, so the
 * NEXT idle tick can tell "nothing is due" from "a report fires in three minutes"
 * without touching Postgres.
 *
 * Call this at the END of an active tick, never on an idle one: the point of the gate
 * is that an idle tick makes zero DB round-trips, and this query would defeat that. On
 * an active tick the endpoint is already awake and the sweeps have just re-armed their
 * `next_run_at` values, so this reads the freshest possible answer for free.
 *
 * One statement, five indexed `MIN()` scans, no rows returned beyond a single
 * timestamp. Best-effort throughout: a failure leaves the previous stamp (or none) in
 * place and the floor sweep still backstops every schedule, so this can never strand
 * work — it can only fail to make it prompt.
 *
 * It also RAISES a jam. The per-table minimums this already reads are exactly what is
 * needed to tell "nothing is due" from "something has been due for hours and no sweep
 * is clearing it" — the case the gate's bounded `due` window deliberately declines to
 * act on. Declining silently made a jammed schedule indistinguishable from an idle
 * platform, so any table whose earliest armed row is overdue by more than one floor
 * interval is written to the stall report and logged (rate-limited).
 */
export interface NextDuePublication {
  /** Earliest armed `next_run_at` across every schedule table, epoch-ms. */
  earliestMs: number | null;
  /** Per-table earliest armed due time — the raw observation the stall check reads. */
  perTable: Array<{ table: string; nextDueMs: number }>;
  /** The jam, if any, after merging with what previous ticks observed. */
  stall: ScheduleStallReport | null;
}

export async function publishNextDue(env: Env, nowMs: number): Promise<NextDuePublication> {
  const empty: NextDuePublication = { earliestMs: null, perTable: [], stall: null };
  const store = kv(env);
  if (!store) return empty;
  try {
    const db = buildDatabase(env);
    // Each arm is `SELECT MIN(next_run_at) FROM <t> WHERE enabled AND next_run_at IS NOT NULL`.
    // MIN over a partial/ordinary index on next_run_at is a cheap top-of-index probe,
    // not a scan of the schedule set.
    const mins = await Promise.all(SCHEDULE_SOURCES.map(async (source) => {
      const [row] = await db
        .select({ min: sql<Date | string | null>`MIN(${source.nextRunAt})` })
        .from(source.table)
        .where(and(eq(source.enabled, true), isNotNull(source.nextRunAt)));
      return { table: source.name as string, nextDueMs: toEpochMs(row?.min ?? null) };
    }));

    const perTable = mins.flatMap((m) => (m.nextDueMs == null ? [] : [{ table: m.table, nextDueMs: m.nextDueMs }]));
    const earliest = perTable.length > 0 ? Math.min(...perTable.map((m) => m.nextDueMs)) : null;
    await store.put(NEXT_DUE_KEY, earliest == null ? NO_SCHEDULES : String(earliest), {
      expirationTtl: NEXT_DUE_TTL_SECONDS,
    });

    const stall = await reconcileScheduleStall(env, store, nowMs, perTable);
    return { earliestMs: earliest, perTable, stall };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cronWorkSignal.ts',
      operation: 'publishNextDue',
      context: { logMessage: '[cron-work-signal] next-due publish failed; floor sweep remains the backstop', details: { nowMs, error } },
    });
    return empty;
  }
}

/**
 * Merge this tick's observation into the stored stall report and raise a NEW or
 * ONGOING jam to the error log.
 *
 * Two properties this has to get right:
 *
 *   • `firstDetectedMs` is CARRIED, not restamped. An operator needs "jammed for six
 *     hours", and every active tick re-observes the same jam — restamping would reset
 *     the age on each one and the report would perpetually read "just now".
 *   • The raise is rate-limited to one per floor interval. Active ticks can be as
 *     frequent as every five minutes, and a jam is a condition that persists for as
 *     long as nobody fixes it; logging it every tick would bury the platform's own
 *     error stream under the very table this module is trying to keep small.
 *
 * Clearing is explicit: the moment nothing is overdue the key is deleted, so the panel
 * goes green without waiting out a TTL. Best-effort — a KV failure here must never
 * fail the publish that precedes it.
 */
async function reconcileScheduleStall(
  env: Env,
  store: KVNamespace,
  nowMs: number,
  perTable: Array<{ table: string; nextDueMs: number }>,
): Promise<ScheduleStallReport | null> {
  const interval = floorIntervalMs(env);
  const stalled: StalledSchedule[] = perTable
    .filter((m) => classifyDueTime(m.nextDueMs, nowMs, interval) === 'stuck')
    .map((m) => ({ table: m.table, dueAtMs: m.nextDueMs, overdueMs: nowMs - m.nextDueMs }))
    .sort((a, b) => a.dueAtMs - b.dueAtMs);

  try {
    if (stalled.length === 0) {
      await store.delete(SCHEDULE_STALL_KEY);
      return null;
    }
    const previous = parseStallReport(await store.get(SCHEDULE_STALL_KEY));
    const shouldRaise = !previous || nowMs - previous.lastRaisedMs >= interval;
    const report: ScheduleStallReport = {
      firstDetectedMs: previous?.firstDetectedMs ?? nowMs,
      observedMs: nowMs,
      observations: (previous?.observations ?? 0) + 1,
      lastRaisedMs: shouldRaise ? nowMs : (previous?.lastRaisedMs ?? 0),
      tables: stalled,
    };
    await store.put(SCHEDULE_STALL_KEY, JSON.stringify(report), { expirationTtl: SCHEDULE_STALL_TTL_SECONDS });
    const worst = stalled[0];
    if (shouldRaise && worst) {
      reportCaughtError(
        new Error(
          `Scheduled work is jammed: ${stalled.length} schedule table(s) hold armed rows overdue by more than the ` +
          `${Math.round(interval / 60_000)}m floor interval (worst: ${worst.table}, ` +
          `${Math.round(worst.overdueMs / 60_000)}m overdue). The cron gate is falling back to floor cadence for them.`,
        ),
        {
          source: 'application/runtime/cronWorkSignal.ts',
          operation: 'scheduleStall',
          // A jam degrades promptness, it does not lose work — the floor sweep still
          // runs these rows — so it is a warning, not an error.
          level: 'warning',
          context: {
            logMessage: '[cron-work-signal] schedule stall detected',
            details: {
              floorIntervalMs: interval,
              jammedSince: new Date(report.firstDetectedMs).toISOString(),
              observations: report.observations,
              tables: stalled.map((s) => ({ table: s.table, dueAt: new Date(s.dueAtMs).toISOString(), overdueMs: s.overdueMs })),
            },
          },
        },
      );
    }
    return report;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cronWorkSignal.ts',
      operation: 'reconcileScheduleStall',
      context: { logMessage: '[cron-work-signal] stall reconcile failed', details: { nowMs, error } },
    });
    return stalled.length > 0
      ? { firstDetectedMs: nowMs, observedMs: nowMs, observations: 1, lastRaisedMs: 0, tables: stalled }
      : null;
  }
}

/**
 * Normalize a `MIN(next_run_at)` cell to epoch-ms.
 *
 * Drizzle's neon-http driver disables the TIMESTAMP type parser globally, so an
 * aggregate over a `timestamp` column can arrive as a Date OR as TZ-less Postgres
 * text ("2026-08-19 09:00:00") depending on the mapper in play. The TZ-less form is
 * parsed as LOCAL time by `Date.parse`, which on a non-UTC host would shift every due
 * time by the offset — so the bare string is pinned to UTC explicitly, matching how
 * these columns are written.
 */
function toEpochMs(value: Date | string | null): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const text = String(value).trim();
  if (!text) return null;
  const utc = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? parsed : null;
}
