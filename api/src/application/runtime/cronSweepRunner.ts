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
 *     one isolated branch per ordering chain (an unchained sweep is a chain of one)
 *     so a failure in one can't poison the others.
 *   • `POST /api/admin/cron/:target` → {@link runCronSweeps}: awaited, so the
 *     operator sees per-sweep ok/duration/summary in the response.
 * Neither caller can drift from the other's sweep list, and a new sweep is one
 * registry entry rather than an edit to two handlers.
 *
 * ORDER IS DECLARED, NEVER IMPLIED BY POSITION. Sweeps run concurrently unless one
 * names another in `after`; then it starts only once that one has SETTLED (ok or
 * not — see `skipIfAfterFailed` for the exception). Registry position used to be
 * described as load-bearing while every sweep actually got its own concurrent
 * `waitUntil`, so the "retention → db-vacuum" and "grant allowance → charge rent"
 * orderings the comments promised never held. {@link validateSweepOrdering} is the
 * registry check that every `after` resolves, shares its cadence and has no cycle.
 *
 * TIMEOUTS NEVER CANCEL WORK. The awaited flavour races each sweep against a
 * deadline so an operator request always returns, and hands the still-running
 * promise to `keepAlive` (the request's `waitUntil`) so the sweep finishes
 * regardless. A `timedOut` outcome means "not finished when we answered", never
 * "aborted".
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
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
  /** The ONE database client for this tick. Every sweep that talks to Neon takes
   *  it from here — a tick used to open twenty-two clients of its own. */
  db: Db;
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
  /**
   * Key of a SAME-cadence sweep that must settle before this one starts. Both
   * callers honour it whenever the predecessor is part of the same invocation; a
   * forced run of this sweep alone simply runs it. Every sweep that shares a
   * predecessor chain runs inside ONE `waitUntil` on the cron tick.
   */
  after?: string;
  /**
   * Skip this sweep (reported `skipped`, with `blockedBy`) when its `after`
   * predecessor THREW. Default false: a later step runs once its predecessor has
   * settled either way. Only for a step that is actively harmful on top of a failed
   * predecessor, not merely less useful.
   */
  skipIfAfterFailed?: boolean;
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
  /** `available(env)` said no, or a failed predecessor blocked it — not invoked. */
  skipped?: boolean;
  /** Set with `skipped` when a `skipIfAfterFailed` sweep's predecessor threw. */
  blockedBy?: string;
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
 * Registry check for the `after` declarations: every target must exist, must not
 * be the sweep itself, must share its cadence (a daily sweep can never wait on a
 * frequent one — they are never dispatched together) and must not form a cycle.
 * Returns one message per violation; an empty list is a valid registry. Enforced
 * by `src/cronSweeps.test.ts`. At runtime an invalid `after` degrades to "no
 * ordering" (see {@link scheduleSweeps}) rather than wedging a tick.
 */
export function validateSweepOrdering(defs: readonly CronSweepDef[]): string[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: string[] = [];
  for (const def of defs) {
    if (def.after === undefined) {
      if (def.skipIfAfterFailed) errors.push(`${def.key}: skipIfAfterFailed without an \`after\``);
      continue;
    }
    const target = byKey.get(def.after);
    if (def.after === def.key) errors.push(`${def.key}: \`after\` names itself`);
    else if (!target) errors.push(`${def.key}: \`after\` names unknown sweep '${def.after}'`);
    else if (target.cadence !== def.cadence) {
      errors.push(`${def.key}: \`after\` '${def.after}' is ${target.cadence}, not ${def.cadence}`);
    }
  }
  for (const def of defs) {
    if (def.after === undefined || def.after === def.key) continue;
    const seen = new Set<string>([def.key]);
    for (let cur = byKey.get(def.after); cur; cur = cur.after === undefined ? undefined : byKey.get(cur.after)) {
      if (seen.has(cur.key)) { errors.push(`${def.key}: \`after\` chain forms a cycle through '${cur.key}'`); break; }
      seen.add(cur.key);
    }
  }
  return errors;
}

/**
 * The predecessor `def` waits on WITHIN this invocation, or undefined when it is
 * unchained here — no `after`, a predecessor not selected (a forced single-sweep
 * run), or an invalid self/cyclic reference, which runs unordered rather than
 * deadlocking.
 */
function predecessorIn(def: CronSweepDef, byKey: ReadonlyMap<string, CronSweepDef>): CronSweepDef | undefined {
  if (def.after === undefined) return undefined;
  const seen = new Set<string>([def.key]);
  for (let cur = byKey.get(def.after); cur; cur = cur.after === undefined ? undefined : byKey.get(cur.after)) {
    if (seen.has(cur.key)) return undefined;
    seen.add(cur.key);
  }
  return byKey.get(def.after);
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
  if (outcome.blockedBy) {
    console.warn(`[cron:${outcome.key}] skipped — predecessor '${outcome.blockedBy}' failed`);
    return;
  }
  if (outcome.summary) console.log(`[cron:${outcome.key}] ${outcome.summary}`);
}

/** A started sweep: its settled (and already logged) outcome, plus its chain root. */
interface ScheduledSweep {
  def: CronSweepDef;
  /** Key of the first sweep of the chain this one belongs to (itself when unchained). */
  root: string;
  outcome: Promise<CronSweepOutcome>;
}

/**
 * Start every sweep in `defs` at once, each either immediately or chained behind
 * its in-invocation predecessor, and return them in registry order. The ONE place
 * ordering is implemented — both callers go through it, so a forced run of a whole
 * cadence observes exactly the ordering the cron tick does. Each outcome is logged
 * as it settles; the returned promises never reject.
 */
function scheduleSweeps(defs: readonly CronSweepDef[], ctx: CronSweepContext): ScheduledSweep[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const started = new Map<string, ScheduledSweep>();
  const start = (def: CronSweepDef): ScheduledSweep => {
    const existing = started.get(def.key);
    if (existing) return existing;
    const before = predecessorIn(def, byKey);
    let root = def.key;
    let outcome: Promise<CronSweepOutcome>;
    if (!before) {
      outcome = executeSweep(def, ctx);
    } else {
      const prior = start(before);
      root = prior.root;
      outcome = prior.outcome.then((prev): CronSweepOutcome | Promise<CronSweepOutcome> =>
        !prev.ok && def.skipIfAfterFailed
          ? { key: def.key, cadence: def.cadence, ok: true, ms: 0, summary: null, skipped: true, blockedBy: before.key }
          : executeSweep(def, ctx));
    }
    const scheduled: ScheduledSweep = {
      def,
      root,
      outcome: outcome.then((o) => { logOutcome(o); return o; }),
    };
    started.set(def.key, scheduled);
    return scheduled;
  };
  return defs.map(start);
}

/**
 * Fire-and-forget flavour used by `scheduled()`. Each ordering CHAIN gets its own
 * `waitUntil` — an unchained sweep is a chain of one — so the Worker keeps every
 * branch alive independently and a slow or failing sweep can neither delay nor
 * poison anything outside its own declared chain. Within a chain, a step starts
 * only after the step it names in `after` has settled.
 */
export function dispatchCronSweeps(
  defs: readonly CronSweepDef[],
  ctx: CronSweepContext,
  waitUntil: (p: Promise<unknown>) => void,
): void {
  const chains = new Map<string, Array<Promise<CronSweepOutcome>>>();
  for (const s of scheduleSweeps(defs, ctx)) {
    const chain = chains.get(s.root);
    if (chain) chain.push(s.outcome);
    else chains.set(s.root, [s.outcome]);
  }
  for (const outcomes of chains.values()) waitUntil(Promise.all(outcomes));
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
 * CONCURRENTLY, except where one declares `after` another in the same run — the
 * same ordering the cron tick applies — and returns one outcome each. Deadlines
 * are measured from the start of the request, so a chained sweep still waiting on
 * its predecessor counts that wait against its own deadline. A sweep past its
 * deadline is reported `timedOut` and handed to `keepAlive`; it is never aborted.
 */
export async function runCronSweeps(
  defs: readonly CronSweepDef[],
  ctx: CronSweepContext,
  options: RunCronSweepsOptions = {},
): Promise<CronSweepOutcome[]> {
  const timeoutMs = clampForceTimeout(options.timeoutMs);
  const started = Date.now();
  return Promise.all(scheduleSweeps(defs, ctx).map(async ({ def, outcome: inFlight }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const settled = await Promise.race([inFlight, deadline]);
    if (timer !== undefined) clearTimeout(timer);
    if (settled === 'timeout') {
      // scheduleSweeps logs every outcome as it lands, so `wrangler tail` still shows
      // a timed-out sweep's eventual result exactly as a cron tick would have.
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
