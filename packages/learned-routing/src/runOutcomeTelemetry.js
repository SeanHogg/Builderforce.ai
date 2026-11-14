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
export const ALL_ENTRY_POINTS = ['vscode', 'web', 'rovr', 'canvas', 'on-prem', 'cloud'];
export const CLIENT_ENTRY_POINTS = ALL_ENTRY_POINTS.filter((entryPoint) => entryPoint !== 'cloud');
/** The longest `model_preflight` the column holds (`degraded:<reason>` is truncated). */
export const MODEL_PREFLIGHT_MAX = 32;
/** The most distinct signals a `progressTrips` map may carry (the detector has five). */
const PROGRESS_SIGNALS_MAX = 8;
/** The longest signal name a `progressTrips` key may be. */
const SIGNAL_NAME_MAX = 32;
/** A counter above this is not a run's count — it is a broken client. */
const COUNT_MAX = 10_000_000;
/** The longest `parentRunId` the column holds — the same bound as `client_run_id`. */
export const PARENT_RUN_ID_MAX = 128;
/** The plain counters — each a non-negative integer. */
const COUNTERS = [
    'toolCalls', 'toolErrors', 'tokens', 'cacheReadTokens', 'compactions', 'stallRecoveries', 'escalations',
    'coveredReadStubs', 'shellFileReads', 'repoErrors', 'contextPackTokens', 'unkeptReadyClaims',
];
function count(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX ? v : undefined;
}
function entryPoint(v) {
    return typeof v === 'string' && CLIENT_ENTRY_POINTS.includes(v) ? v : undefined;
}
function verify(v) {
    return v === 'passed' || v === 'failed' || v === 'not-run' ? v : undefined;
}
function modelPreflight(v) {
    if (typeof v !== 'string')
        return undefined;
    const s = v.trim();
    if (s !== 'ok' && s !== 'refreshed' && !s.startsWith('degraded'))
        return undefined;
    return s.slice(0, MODEL_PREFLIGHT_MAX);
}
function parentRunId(v) {
    if (typeof v !== 'string')
        return undefined;
    const s = v.trim();
    return s.length > 0 && s.length <= PARENT_RUN_ID_MAX && /^[\w:.\-]+$/.test(s) ? s : undefined;
}
function progressTrips(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        return undefined;
    const entries = Object.entries(v);
    if (entries.length > PROGRESS_SIGNALS_MAX)
        return undefined;
    const out = {};
    for (const [signal, n] of entries) {
        const c = count(n);
        if (!/^[a-z_]+$/.test(signal) || signal.length > SIGNAL_NAME_MAX || c === undefined)
            return undefined;
        out[signal] = c;
    }
    return out;
}
/**
 * The §8.2 row names what a run was billed `cost` (millicents); the door's field is `costMc`.
 * The ONE mapping, so a host spreads the row and adds this — and a cost nobody reported stays
 * absent (never a reported zero).
 */
export function wireCost(row) {
    const cost = row.cost;
    return typeof cost === 'number' && Number.isInteger(cost) && cost >= 0 && cost <= COUNT_MAX ? { costMc: cost } : {};
}
/** Validate the §8.2 fields of a raw request body. PURE; never throws. */
export function parseRunOutcomeTelemetry(b) {
    const out = {};
    const ep = entryPoint(b.entryPoint);
    if (ep)
        out.entryPoint = ep;
    for (const key of COUNTERS) {
        const c = count(b[key]);
        if (c !== undefined)
            out[key] = c;
    }
    const v = verify(b.verify);
    if (v)
        out.verify = v;
    if (b.firstSpawnTurn === null)
        out.firstSpawnTurn = null;
    else {
        const turn = count(b.firstSpawnTurn);
        if (turn !== undefined)
            out.firstSpawnTurn = turn;
    }
    const preflight = modelPreflight(b.modelPreflight);
    if (preflight)
        out.modelPreflight = preflight;
    const trips = progressTrips(b.progressTrips);
    if (trips)
        out.progressTrips = trips;
    const parent = parentRunId(b.parentRunId);
    if (parent)
        out.parentRunId = parent;
    return out;
}
//# sourceMappingURL=runOutcomeTelemetry.js.map