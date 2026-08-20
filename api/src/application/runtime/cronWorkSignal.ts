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

function kv(env: Env): KVNamespace | undefined {
  return env.AUTH_CACHE_KV;
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
    return { run: true, reason: 'kv-unavailable', floorDue: true, lastFloorMs: null, floorIntervalMs: interval, nextDueMs: null };
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
    if (sig != null) return { run: true, reason: 'signal', floorDue, lastFloorMs, floorIntervalMs: interval, nextDueMs };
    // A schedule has come due. This is the branch that makes a finer-than-floor
    // schedule land ON TIME while idle — without it the tick below would skip and
    // the sweep would wait for the floor.
    //
    // The upper bound matters as much as the lower one. A row whose sweep never
    // re-arms it — the reports sweep switched off in cron controls, a generator
    // erroring past its retries — stays due FOREVER, and an unbounded check would
    // then open this gate on every single tick and quietly undo the autosuspend the
    // whole module exists to buy. Past one floor interval the sweeps have already had
    // their chance at that row, so it stops being treated as a fresh due time and the
    // floor sweep (which still runs it) becomes the backstop again.
    if (nextDueMs != null && nowMs >= nextDueMs && nowMs - nextDueMs <= interval) {
      return { run: true, reason: 'due', floorDue, lastFloorMs, floorIntervalMs: interval, nextDueMs };
    }
    if (floorDue) return { run: true, reason: 'floor', floorDue: true, lastFloorMs, floorIntervalMs: interval, nextDueMs };
    return { run: false, reason: 'idle', floorDue: false, lastFloorMs, floorIntervalMs: interval, nextDueMs };
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cronWorkSignal.ts", operation: "evaluateCronGate", context: { logMessage: '[cron-work-signal] gate read failed; running fan-out fail-open', details: { nowMs, error } } });
    // A KV blip must never strand work — run the fan-out this tick.
    return { run: true, reason: 'kv-unavailable', floorDue: true, lastFloorMs: null, floorIntervalMs: interval, nextDueMs: null };
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
 */
export async function publishNextDue(env: Env, nowMs: number): Promise<number | null> {
  const store = kv(env);
  if (!store) return null;
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
      return toEpochMs(row?.min ?? null);
    }));

    const armed = mins.filter((ms): ms is number => ms != null);
    const earliest = armed.length > 0 ? Math.min(...armed) : null;
    await store.put(NEXT_DUE_KEY, earliest == null ? NO_SCHEDULES : String(earliest), {
      expirationTtl: NEXT_DUE_TTL_SECONDS,
    });
    return earliest;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cronWorkSignal.ts',
      operation: 'publishNextDue',
      context: { logMessage: '[cron-work-signal] next-due publish failed; floor sweep remains the backstop', details: { nowMs, error } },
    });
    return null;
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
