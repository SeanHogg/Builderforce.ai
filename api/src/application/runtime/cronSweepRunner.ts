/**
 * cronSweepRunner — the ONE way a scheduled sweep is invoked, whoever asks.
 *
 * WHY THIS EXISTS. Cloudflare delivers cron triggers to `scheduled()`, never to a
 * URL. For as long as the fan-out lived inline in that handler, the sweeps were
 * reachable from exactly one caller, so:
 *   • no operator could force a tick — any change to a cron-path sweep took up to
 *     the KV work-gate's floor interval to observe, and could not be observed at
 *     all without `wrangler tail`;
 *   • the "is the scheduled sweep even reaching this project?" question had no
 *     answer inside the product.
 * A `CRON_SECRET`-guarded endpoint once existed and was deleted (correctly —
 * nothing called it) but left no replacement.
 *
 * The fix is a REGISTRY, not a second call path: each sweep is declared once (see
 * `src/cronSweeps.ts`) with its cadence, and both callers consume the same list.
 *   • `scheduled()` → {@link dispatchCronSweeps}: fire-and-forget via `waitUntil`,
 *     one isolated branch per sweep so a failure in one can't poison the others.
 *   • `POST /api/admin/cron/:target` → {@link runCronSweeps}: awaited, so the
 *     operator sees per-sweep ok/duration/summary in the response.
 * Neither caller can drift from the other's sweep list, and a new sweep is one
 * registry entry rather than an edit to two handlers.
 *
 * TIMEOUTS NEVER CANCEL WORK. The awaited flavour races each sweep against a
 * deadline so an operator request always returns, and hands the still-running
 * promise to `keepAlive` (the request's `waitUntil`) so the sweep finishes
 * regardless. A `timedOut` outcome means "not finished when we answered", never
 * "aborted".
 */
import type { Env } from '../../env';
import type { TickDispatchBudget } from './tickDispatchBudget';

/**
 * Cadence groups. `frequent` is the every-5-minute tick (the KV-gated one); the
 * rest map 1:1 onto the cron expressions declared in `api/wrangler.toml`.
 */
export type CronCadence = 'frequent' | 'daily' | 'weekly-mon' | 'weekly-fri';

export const CRON_CADENCES: readonly CronCadence[] = ['frequent', 'daily', 'weekly-mon', 'weekly-fri'];

/**
 * Cron expression (as delivered in `ScheduledController.cron`) → cadence group.
 * MUST stay in sync with `[triggers] crons` in api/wrangler.toml; anything not
 * listed here — including an absent cron string, e.g. a manual `wrangler`
 * invocation — is the frequent tick.
 */
export const CADENCE_BY_CRON: Readonly<Record<string, CronCadence>> = {
  '0 9 * * *':   'daily',
  '0 8 * * 1':   'weekly-mon',
  '0 16 * * 5':  'weekly-fri',
};

export function cadenceForCron(expr: string | undefined | null): CronCadence {
  if (!expr) return 'frequent';
  return CADENCE_BY_CRON[expr] ?? 'frequent';
}

export interface CronSweepContext {
  env: Env;
  /** Persisted platform switches read once by the caller for this invocation. */
  controls?: Readonly<Record<string, boolean>>;
  /**
   * The ONE per-tenant dispatch ceiling for this invocation, shared by every
   * sweep that can start a billable run (see tickDispatchBudget). One budget per
   * tick — or per forced run — never one per sweep.
   */
  budget: TickDispatchBudget;
}

export interface CronSweepDef {
  /** Stable slug: the log prefix (`[cron:<key>]`) AND the `:target` route param. */
  key: string;
  cadence: CronCadence;
  /** English one-liner; the admin panel localizes by key and falls back to this. */
  description: string;
  /**
   * True when the sweep can start billable agent runs across tenants. The
   * operator control confirms before firing one of these.
   */
  dispatches?: boolean;
  /** Env-gated sweeps (e.g. the demo reseed) are reported unavailable, not run. */
  available?: (env: Env) => boolean;
  /**
   * Run it. Return a one-line summary to log, or `null` when there was nothing
   * worth a log line — that's how the quiet sweeps stay quiet.
   */
  run: (ctx: CronSweepContext) => Promise<string | null>;
}

export interface CronSweepOutcome {
  key: string;
  cadence: CronCadence;
  /** False only when the sweep threw. A `timedOut` sweep is still in flight. */
  ok: boolean;
  /** Wall-clock ms until the sweep settled, or until the deadline for a timeout. */
  ms: number;
  summary: string | null;
  error?: string;
  /** Still running when we answered — handed to `keepAlive`, NOT cancelled. */
  timedOut?: boolean;
  /** `available(env)` said no — the sweep was not invoked. */
  skipped?: boolean;
}

/** Default per-sweep deadline for a forced (awaited) run. */
export const DEFAULT_FORCE_TIMEOUT_MS = 20_000;
/** Ceiling an operator may request, so a forced run can never hang a request. */
export const MAX_FORCE_TIMEOUT_MS = 120_000;

export function clampForceTimeout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FORCE_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(n), 1_000), MAX_FORCE_TIMEOUT_MS);
}

/** `all` runs every registered sweep regardless of cadence. */
export const ALL_SWEEPS_TARGET = 'all';

/**
 * Resolve an operator-supplied `:target` — a sweep key, a cadence group, or
 * `all` — to the sweeps it names. Returns `null` for an unknown target so the
 * route can 404 rather than silently running nothing.
 */
export function resolveCronTarget(
  defs: readonly CronSweepDef[],
  target: string,
): { sweeps: CronSweepDef[]; kind: 'sweep' | 'cadence' | 'all' } | null {
  const t = target.trim();
  if (!t) return null;
  if (t === ALL_SWEEPS_TARGET) return { sweeps: [...defs], kind: 'all' };
  if ((CRON_CADENCES as readonly string[]).includes(t)) {
    return { sweeps: defs.filter((d) => d.cadence === t), kind: 'cadence' };
  }
  const one = defs.find((d) => d.key === t);
  return one ? { sweeps: [one], kind: 'sweep' } : null;
}

/** Sweeps belonging to a cadence, in registry order. */
export function sweepsForCadence(defs: readonly CronSweepDef[], cadence: CronCadence): CronSweepDef[] {
  return defs.filter((d) => d.cadence === cadence);
}

/**
 * Run one sweep and describe what happened. Never throws: a sweep's failure is
 * data (an outcome with `ok: false`), because one broken sweep must not stop the
 * others — that isolation was the whole point of the per-branch `waitUntil` this
 * replaces.
 */
async function executeSweep(def: CronSweepDef, ctx: CronSweepContext): Promise<CronSweepOutcome> {
  const started = Date.now();
  if (def.available && !def.available(ctx.env)) {
    return { key: def.key, cadence: def.cadence, ok: true, ms: 0, summary: null, skipped: true };
  }
  try {
    const summary = await def.run(ctx);
    return { key: def.key, cadence: def.cadence, ok: true, ms: Date.now() - started, summary: summary ?? null };
  } catch (err) {
    return {
      key: def.key,
      cadence: def.cadence,
      ok: false,
      ms: Date.now() - started,
      summary: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One log line per sweep, in the `[cron:<key>]` shape the logs already use. */
function logOutcome(outcome: CronSweepOutcome): void {
  if (!outcome.ok) {
    console.error(`[cron:${outcome.key}] failed`, outcome.error);
    return;
  }
  if (outcome.summary) console.log(`[cron:${outcome.key}] ${outcome.summary}`);
}

/**
 * Fire-and-forget flavour used by `scheduled()`. Each sweep gets its own
 * `waitUntil` so the Worker keeps every branch alive independently and a slow or
 * failing sweep can neither delay nor poison its siblings.
 */
export function dispatchCronSweeps(
  defs: readonly CronSweepDef[],
  ctx: CronSweepContext,
  waitUntil: (p: Promise<unknown>) => void,
): void {
  for (const def of defs) {
    waitUntil(executeSweep(def, ctx).then(logOutcome));
  }
}

export interface RunCronSweepsOptions {
  /** Per-sweep deadline for the RESPONSE. Work continues past it. */
  timeoutMs?: number;
  /**
   * Keeps a sweep that outlived the deadline alive after the response — pass the
   * request's `executionCtx.waitUntil`. Without it a timed-out sweep would be
   * cancelled when the isolate finishes the request, i.e. the diagnostic would
   * change the behaviour it exists to observe.
   */
  keepAlive?: (p: Promise<unknown>) => void;
}

/**
 * Awaited flavour used by the operator force-run route. Runs the sweeps
 * CONCURRENTLY (as the cron tick does — they are independent) and returns one
 * outcome each. A sweep past its deadline is reported `timedOut` and handed to
 * `keepAlive`; it is never aborted.
 */
export async function runCronSweeps(
  defs: readonly CronSweepDef[],
  ctx: CronSweepContext,
  options: RunCronSweepsOptions = {},
): Promise<CronSweepOutcome[]> {
  const timeoutMs = clampForceTimeout(options.timeoutMs);
  return Promise.all(defs.map(async (def) => {
    const started = Date.now();
    const inFlight = executeSweep(def, ctx).then((outcome) => {
      // Log the real completion too, so `wrangler tail` shows a timed-out
      // sweep's eventual result exactly as a cron tick would have.
      logOutcome(outcome);
      return outcome;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const settled = await Promise.race([inFlight, deadline]);
    if (timer !== undefined) clearTimeout(timer);
    if (settled === 'timeout') {
      options.keepAlive?.(inFlight);
      return {
        key: def.key,
        cadence: def.cadence,
        ok: true,
        ms: Date.now() - started,
        summary: null,
        timedOut: true,
      } satisfies CronSweepOutcome;
    }
    return settled;
  }));
}
