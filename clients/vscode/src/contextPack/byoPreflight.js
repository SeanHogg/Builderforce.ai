/**
 * The VS Code model PREFLIGHT (PRD 35 E7): before turn 1, ask the server whether every
 * connected BYO account still resolves, so an expired Anthropic token is shown on the
 * run's banner up front instead of being learned from a response header after a turn.
 *
 * The per-provider status read (`GET /llm/provider-keys/:provider/status`) resolves the
 * credential the way dispatch does (`resolveTenantLlmCredentials`), which for an OAuth
 * subscription past expiry ATTEMPTS THE REFRESH — so the read is also the one refresh
 * try; a token it refreshes reads `ready`. Time-boxed (~1.5 s), cached ~60 s per
 * workspace, and best-effort: any failure means "no notice", never a failed run.
 */
import { authed, getCurrentWorkspace } from "../bfApi";
import { ttlCache } from "../ttlCache";
import { logLine } from "../errorReporter";
import { preflightFallback, unresolvedByoEntries } from "./byoPreflightVerdict";
export const PREFLIGHT_DEADLINE_MS = 1_500;
const PREFLIGHT_TTL_MS = 60_000;
const cache = ttlCache(PREFLIGHT_TTL_MS);
async function providerHealth(secrets) {
    const list = await authed(secrets, "/llm/provider-keys");
    const providers = (list?.details ?? []).map((d) => d.provider).filter((p) => typeof p === "string" && !!p);
    const reads = await Promise.all(providers.map((provider) => authed(secrets, `/llm/provider-keys/${encodeURIComponent(provider)}/status`)
        .then((r) => ({ provider, status: r?.status ?? "" }))
        .catch(() => ({ provider, status: "" }))));
    return reads;
}
/** The preflight's body — every read, the workspace lookup included. */
async function preflightBody(secrets) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    const hit = cache.get(ws.id);
    if (hit)
        return hit.value;
    const health = await providerHealth(secrets);
    const entries = unresolvedByoEntries(health);
    const fallback = preflightFallback(health);
    const result = entries.length ? { byoUnresolved: entries, ...(fallback ? { fallback } : {}) } : undefined;
    cache.set(ws.id, result);
    return result;
}
/**
 * The run's preflight result, or undefined when nothing could be (or needed to be) said.
 * The WHOLE body — the workspace lookup included — races the deadline: a late answer is
 * no answer (it still lands in the cache for the next run).
 */
export async function byoPreflight(secrets, deadlineMs = PREFLIGHT_DEADLINE_MS) {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), deadlineMs);
    });
    // A body that fails after the deadline has nobody to tell: its failure is "no notice".
    const body = preflightBody(secrets).catch((e) => {
        logLine(`BYO preflight failed — no notice for this run: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
    });
    try {
        return await Promise.race([body, late]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=byoPreflight.js.map