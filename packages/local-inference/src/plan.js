/**
 * LOCAL FIRST — the ordered attempts for one call: capable on-device model(s), then the
 * cloud gateway.
 *
 * "Capable" is decided from what the runtime REPORTED, conservatively:
 *  - a TOOL turn goes only to a model the runtime says can take tools; unknown is no.
 *    A model that ignores `tools` answers an agent turn with prose about calling one —
 *    that is not a failure the failover can see, so it must never be attempted;
 *  - a model whose reported context window cannot hold the prompt plus the expected
 *    completion is skipped. An UNREPORTED window is not disqualifying: an overflow there
 *    is an HTTP error from the runtime, which the failover does see and recovers from.
 *
 * Only `onDevice` runtimes take part, in the registry's `automaticRank` — our engines
 * first, a third-party server (Ollama, FreeToken) last. `kimi-code` is locally dispatched
 * but hosted, so it is reachable by an explicit pin and never by local-first. Pure.
 */
import { isServableLocalModel } from './probe.js';
import { LOCAL_RUNTIMES } from './runtimes.js';
/** Why a reported model may not serve this call, or null when it may. */
export function localModelUnfitReason(model, workload) {
    if (workload.agentic && model.tools !== true)
        return 'tools';
    if (model.contextTokens !== undefined && model.contextTokens < workload.inputTokens + workload.outputTokens) {
        return 'context';
    }
    return null;
}
/** The ordered attempt list. Empty only when no local model fits AND there is no cloud. */
export function localFirstPlan(input) {
    const onDevice = new Set(LOCAL_RUNTIMES.filter((r) => r.onDevice).map((r) => r.id));
    const rank = (id) => LOCAL_RUNTIMES.find((r) => r.id === id)?.automaticRank ?? Number.POSITIVE_INFINITY;
    const candidates = input.probes
        .filter((p) => p.reachable && onDevice.has(p.provider))
        .sort((a, b) => rank(a.provider) - rank(b.provider))
        .flatMap((p) => p.models
        .filter((m) => isServableLocalModel(m) && localModelUnfitReason(m, input.workload) === null)
        .map((m) => ({
        kind: 'local',
        ref: m.ref,
        provider: p.provider,
        model: m.model,
        endpoint: p.endpoint,
    })));
    const preferredIndex = input.preferred
        ? candidates.findIndex((c) => c.kind === 'local' && c.ref === input.preferred)
        : -1;
    if (preferredIndex > 0)
        candidates.unshift(...candidates.splice(preferredIndex, 1));
    const local = candidates.slice(0, Math.max(0, input.maxLocalAttempts ?? 1));
    // A connected account's runtime takes every call its registry row allows (`tools: 'all'`).
    const accounts = (input.accounts ?? []).map((account) => ({ kind: 'local', ...account }));
    const leading = [...local, ...accounts];
    return input.cloud ? [...leading, { kind: 'cloud', ...(input.cloud.model ? { model: input.cloud.model } : {}) }] : leading;
}
//# sourceMappingURL=plan.js.map