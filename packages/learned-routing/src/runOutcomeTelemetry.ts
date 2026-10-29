/**
 * The run-outcome write-back's TELEMETRY half — the PRD 35 §8.2 uniform outcome row.
 *
 * Every entry point's run ends in one row (`@builderforce/agent-run`'s `RunOutcomeRow`).
 * A client posts it to `POST /llm/v1/run-outcome` beside the routing fields, under the
 * SAME field names, so an adapter spreads the row into the request and nothing is
 * renamed on the way. {@link parseRunOutcomeTelemetry} validates each field and drops
 * the ones that do not hold — a malformed counter is a missing fact, never a rejected
 * report. Pure and dependency-free, like the rest of this package.
 */

/** Every entry point a run can be labelled with (PRD 35 §3.2) — the ONE list. A telemetry
 *  label only: nothing branches on it for behaviour. */
export const ALL_ENTRY_POINTS = ['vscode', 'web', 'rovr', 'canvas', 'on-prem', 'cloud'] as const;
export type EntryPoint = (typeof ALL_ENTRY_POINTS)[number];

/** The entry points a client may label its run with. `cloud` is scored server-side and
 *  never accepted off the wire (a client claiming it would double-count). */
export type ClientEntryPoint = Exclude<EntryPoint, 'cloud'>;
export const CLIENT_ENTRY_POINTS: readonly ClientEntryPoint[] = ALL_ENTRY_POINTS.filter(
  (entryPoint): entryPoint is ClientEntryPoint => entryPoint !== 'cloud',
);

/** The declared verify phase's result. */
export type RunVerifyResult = 'passed' | 'failed' | 'not-run';

/** The longest `model_preflight` the column holds (`degraded:<reason>` is truncated). */
export const MODEL_PREFLIGHT_MAX = 32;
/** The most distinct signals a `progressTrips` map may carry (the detector has five). */
const PROGRESS_SIGNALS_MAX = 8;
/** The longest signal name a `progressTrips` key may be. */
const SIGNAL_NAME_MAX = 32;
/** A counter above this is not a run's count — it is a broken client. */
const COUNT_MAX = 10_000_000;

/** The §8.2 fields, as a client sends them and as the scorer records them. */
export interface RunOutcomeTelemetry {
  entryPoint?: ClientEntryPoint;
  toolCalls?: number;
  toolErrors?: number;
  tokens?: number;
  cacheReadTokens?: number;
  compactions?: number;
  stallRecoveries?: number;
  escalations?: number;
  verify?: RunVerifyResult;
  /** The step the first spawn happened on; `null` = the run spawned nothing. */
  firstSpawnTurn?: number | null;
  coveredReadStubs?: number;
  shellFileReads?: number;
  repoErrors?: number;
  contextPackTokens?: number;
  /** `ok` | `refreshed` | `degraded:<reason>`, at most {@link MODEL_PREFLIGHT_MAX} chars. */
  modelPreflight?: string;
  unkeptReadyClaims?: number;
  /** The A3 progress trips, by signal. */
  progressTrips?: Record<string, number>;
}

/** The plain counters — each a non-negative integer. */
const COUNTERS = [
  'toolCalls', 'toolErrors', 'tokens', 'cacheReadTokens', 'compactions', 'stallRecoveries', 'escalations',
  'coveredReadStubs', 'shellFileReads', 'repoErrors', 'contextPackTokens', 'unkeptReadyClaims',
] as const satisfies readonly (keyof RunOutcomeTelemetry)[];

function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX ? v : undefined;
}

function entryPoint(v: unknown): ClientEntryPoint | undefined {
  return typeof v === 'string' && (CLIENT_ENTRY_POINTS as readonly string[]).includes(v) ? (v as ClientEntryPoint) : undefined;
}

function verify(v: unknown): RunVerifyResult | undefined {
  return v === 'passed' || v === 'failed' || v === 'not-run' ? v : undefined;
}

function modelPreflight(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s !== 'ok' && s !== 'refreshed' && !s.startsWith('degraded')) return undefined;
  return s.slice(0, MODEL_PREFLIGHT_MAX);
}

function progressTrips(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > PROGRESS_SIGNALS_MAX) return undefined;
  const out: Record<string, number> = {};
  for (const [signal, n] of entries) {
    const c = count(n);
    if (!/^[a-z_]+$/.test(signal) || signal.length > SIGNAL_NAME_MAX || c === undefined) return undefined;
    out[signal] = c;
  }
  return out;
}

/**
 * The §8.2 row names what a run was billed `cost` (millicents); the door's field is `costMc`.
 * The ONE mapping, so a host spreads the row and adds this — and a cost nobody reported stays
 * absent (never a reported zero).
 */
export function wireCost(row: { cost?: number }): { costMc?: number } {
  const cost = row.cost;
  return typeof cost === 'number' && Number.isInteger(cost) && cost >= 0 && cost <= COUNT_MAX ? { costMc: cost } : {};
}

/** Validate the §8.2 fields of a raw request body. PURE; never throws. */
export function parseRunOutcomeTelemetry(b: Record<string, unknown>): RunOutcomeTelemetry {
  const out: RunOutcomeTelemetry = {};
  const ep = entryPoint(b.entryPoint);
  if (ep) out.entryPoint = ep;
  for (const key of COUNTERS) {
    const c = count(b[key]);
    if (c !== undefined) out[key] = c;
  }
  const v = verify(b.verify);
  if (v) out.verify = v;
  if (b.firstSpawnTurn === null) out.firstSpawnTurn = null;
  else {
    const turn = count(b.firstSpawnTurn);
    if (turn !== undefined) out.firstSpawnTurn = turn;
  }
  const preflight = modelPreflight(b.modelPreflight);
  if (preflight) out.modelPreflight = preflight;
  const trips = progressTrips(b.progressTrips);
  if (trips) out.progressTrips = trips;
  return out;
}
