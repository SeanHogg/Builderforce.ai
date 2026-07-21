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

/** KV key: presence => a write signalled possibly-pending backstop work. */
const WORK_SIGNAL_KEY = 'cron:work-pending';
/** KV key: epoch-ms of the last floor (unconditional) fan-out. */
const FLOOR_TS_KEY = 'cron:last-floor-sweep';

/**
 * Max time an idle platform can leave a missed signal unprocessed. The live path
 * (maybeAutoRunOnLaneEntry) already dispatches the common case instantly and the
 * signal covers dropped kickoffs, so the floor only backstops a signal that was
 * both lost AND whose live dispatch was dropped — rare. 30 min keeps idle
 * wake-ups to ~48/day while bounding worst-case staleness.
 */
export const FLOOR_INTERVAL_MS = 30 * 60 * 1000;

/**
 * TTL on the pending-work flag. Generous so a real backlog paced across ticks is
 * never expired mid-drain; it is normally consumed explicitly at tick open. Acts
 * only as a floor-independent backstop against a leaked flag.
 */
const SIGNAL_TTL_SECONDS = 6 * 60 * 60;

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
  } catch {
    /* best-effort — the floor sweep is the correctness backstop */
  }
}

export interface CronGateDecision {
  /** Whether this tick should run the Postgres fan-out. */
  run: boolean;
  /** Why it runs (or is idle) — logged so the gate's behaviour is observable. */
  reason: 'signal' | 'floor' | 'idle' | 'kv-unavailable';
  /** True when this run also satisfies the periodic floor (stamp the floor ts). */
  floorDue: boolean;
}

/**
 * Decide whether the frequent tick runs. READS KV ONLY — never touches Neon — so
 * an idle platform lets the DB endpoint scale to zero. Fails OPEN (runs) whenever
 * KV is unavailable so the gate can never hide work.
 */
export async function evaluateCronGate(env: Env, nowMs: number): Promise<CronGateDecision> {
  const store = kv(env);
  if (!store) return { run: true, reason: 'kv-unavailable', floorDue: true };
  try {
    const [sig, lastFloorRaw] = await Promise.all([
      store.get(WORK_SIGNAL_KEY),
      store.get(FLOOR_TS_KEY),
    ]);
    const last = lastFloorRaw ? Number(lastFloorRaw) : 0;
    const floorDue = !Number.isFinite(last) || nowMs - last >= FLOOR_INTERVAL_MS;
    if (sig != null) return { run: true, reason: 'signal', floorDue };
    if (floorDue) return { run: true, reason: 'floor', floorDue: true };
    return { run: false, reason: 'idle', floorDue: false };
  } catch {
    // A KV blip must never strand work — run the fan-out this tick.
    return { run: true, reason: 'kv-unavailable', floorDue: true };
  }
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
  } catch {
    /* best-effort — a missed consume only costs one extra non-idle tick */
  }
}
