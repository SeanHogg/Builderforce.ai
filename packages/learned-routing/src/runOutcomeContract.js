/**
 * Learned Model Routing (PRD 13) — the RUN-OUTCOME write-back contract.
 *
 * `POST /llm/v1/run-outcome` is the door a NON-cloud run (on-prem host, IDE-native,
 * external SDK) uses to teach the same routing table that cloud runs teach. Both
 * halves of that door live here so they can never drift:
 *
 *   • the CLIENT builds a {@link RunOutcomeRequest} — it is the only place field
 *     names are spelled, so an on-prem host cannot invent `status` where the route
 *     reads `terminalStatus`;
 *   • the ROUTE hands the raw JSON body to {@link parseRunOutcomeRequest}, which
 *     validates and normalizes it into the {@link NormalizedRunOutcome} the scorer
 *     records.
 *
 * Pure and dependency-free: no env, no fetch, no DB. The transport (base URL,
 * bearer, retries) belongs to whoever calls it.
 *
 * The body also carries the PRD 35 §8.2 uniform outcome row (`runOutcomeTelemetry.ts`),
 * under the row's own field names.
 */
import { parseRunOutcomeTelemetry } from './runOutcomeTelemetry.js';
/** Path of the write-back door, relative to the gateway base. */
export const RUN_OUTCOME_PATH = '/llm/v1/run-outcome';
/** Path of the client-facing READ of the learned ranking, relative to the gateway
 *  base. Takes `?scope=<scopeToken>` (see `routingScope.ts`). */
export const MODEL_ANALYTICS_PATH = '/llm/v1/model-analytics';
/**
 * Whether an outcome teaches the routing table — decided by the SERVER, never taken on the
 * client's word. A Creation Canvas turn (by the row's entry point or by its source) is not
 * evidence about CODING models, whatever `routingSignal` the body claimed; any other run
 * teaches unless it said it should not.
 */
export function carriesRoutingSignal(o) {
    return o.entryPoint !== 'canvas' && o.source !== 'canvas' && o.routingSignal !== false;
}
/**
 * Whether an outcome is FOLDED into the routing table — the LIVE fold gate. It must be coding-run
 * evidence ({@link carriesRoutingSignal}) and not a run that says nothing about the model: one the
 * person STOPPED (`cancelled`), or one that failed because the TENANT ran out of quota. Those rows are
 * stored, and still count in the spend and effectiveness lenses (a stop rate stays computable); they
 * are only kept out of what the routing table learns. A rebuild applies the same exclusions at READ
 * time (`teachesRouting` in the api), so the two writers agree. The ONE gate for the client door and
 * the cloud scorer.
 */
export function foldsIntoRouting(o) {
    return carriesRoutingSignal(o) && o.terminalStatus !== 'cancelled' && o.quotaExhausted !== true;
}
function str(v) {
    return typeof v === 'string' ? v.trim() : '';
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function bool(v) {
    return typeof v === 'boolean' ? v : undefined;
}
/**
 * Validate + normalize a raw request body. `clientRunId` and `model` are the only
 * required fields (without them there is nothing to key on and nothing to attribute);
 * everything else degrades to a conservative default rather than rejecting a report
 * a client took the trouble to send. PURE.
 */
export function parseRunOutcomeRequest(body) {
    const b = (body ?? {});
    const clientRunId = str(b.clientRunId);
    const model = str(b.model);
    if (!clientRunId || !model)
        return { ok: false, error: 'clientRunId and model are required' };
    const terminalStatus = b.terminalStatus === 'completed' || b.terminalStatus === 'failed' || b.terminalStatus === 'cancelled'
        ? b.terminalStatus
        : b.success === true
            ? 'completed'
            : b.success === false
                ? 'failed'
                : 'completed';
    // 'cloud' is deliberately NOT accepted off the wire: a cloud run has an executions
    // row and is scored server-side, so a client claiming to be one would double-count.
    const source = b.source === 'onprem' || b.source === 'ide' || b.source === 'external' || b.source === 'canvas' ? b.source : 'external';
    const projectId = num(b.projectId);
    const taskId = num(b.taskId);
    const merged = bool(b.merged);
    const ciGreen = bool(b.ciGreen);
    const degraded = bool(b.degraded);
    const steps = num(b.steps);
    const costMc = num(b.costMc);
    const approved = bool(b.approved);
    const rateLimited = bool(b.rateLimited);
    const routingSignal = bool(b.routingSignal);
    const quotaExhausted = bool(b.quotaExhausted);
    const actionType = str(b.actionType);
    const role = str(b.role);
    return {
        ok: true,
        outcome: {
            clientRunId,
            source,
            model,
            terminalStatus,
            ...(actionType ? { actionType } : {}),
            ...(role ? { role } : {}),
            ...(projectId != null ? { projectId } : {}),
            ...(taskId != null ? { taskId } : {}),
            ...(merged != null ? { merged } : {}),
            ...(ciGreen != null ? { ciGreen } : {}),
            ...(degraded != null ? { degraded } : {}),
            ...(steps != null ? { steps } : {}),
            ...(costMc != null ? { costMc } : {}),
            ...(approved != null ? { approved } : {}),
            ...(rateLimited != null ? { rateLimited } : {}),
            ...(routingSignal != null ? { routingSignal } : {}),
            ...(quotaExhausted != null ? { quotaExhausted } : {}),
            ...parseRunOutcomeTelemetry(b),
        },
    };
}
//# sourceMappingURL=runOutcomeContract.js.map