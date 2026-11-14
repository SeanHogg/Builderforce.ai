/**
 * The ONE governance-gate resolver for an editor-started Brain run — the piece that
 * was missing between `policy.ts` (the pure gate decisions) and the two surfaces
 * that start loops here (the native chat participant and the host-owned webview
 * run). Cloud and on-prem dispatches get their gates stamped by
 * `RuntimeService.withPolicyGates`; an IDE run has no dispatch payload, so it pulls
 * the same effective gates from the api at loop start.
 *
 * Fail-closed, like the server: when a signed-in tenant's policy cannot be read the
 * run is refused rather than started ungated. Signed out means no tenant, so no
 * tenant policy applies and the run proceeds with none.
 *
 * Cached per project for a short window, with a longer stale-on-error window: gates
 * change on the order of days, an editor starts a turn every few seconds, and a
 * transient network blip must not refuse a turn the last successful read already
 * governs. A project whose gates were NEVER read still fails closed — there is no
 * last-known policy to hold it to.
 */
import { fetchPolicyGates } from "./bfApi";
import { snapshotPermitsOfflineRun } from "./policySnapshots";
/** Raised when a tenant's gates could not be resolved — the run must not start. */
export class PolicyGatesUnavailableError extends Error {
    constructor(cause) {
        super(`policy gates unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = "PolicyGatesUnavailableError";
    }
}
/** How long a successful read answers later turns without a round-trip. */
export const POLICY_GATES_FRESH_MS = 60_000;
/** How long a last-known policy still governs a turn when a re-read fails. */
export const POLICY_GATES_STALE_MS = 10 * 60_000;
let persistence;
export function configurePolicyGatesPersistence(port) {
    persistence = port;
}
const cache = new Map();
const cacheKey = (projectId) => (projectId == null ? "workspace" : `project:${projectId}`);
/** Forget every cached policy — a sign-out, a workspace switch, or a test. */
export function resetPolicyGatesCache() {
    cache.clear();
}
/** Effective gates for a run in this editor, or `[]` when signed out. */
export async function resolveRunPolicyGates(secrets, projectId, now = Date.now()) {
    const key = cacheKey(projectId);
    const cached = cache.get(key);
    if (cached && now - cached.readAt < POLICY_GATES_FRESH_MS)
        return cached.gates;
    try {
        const gates = (await fetchPolicyGates(secrets, projectId)) ?? [];
        cache.set(key, { gates, readAt: now });
        // Persist before returning so a sign-out that clears this cache in the same turn
        // still has a snapshot. A failed save must not refuse a turn the read already answered.
        try {
            await persistence?.save(key, projectId, gates);
        }
        catch {
            /* snapshot write failed; the in-memory read still governs this turn */
        }
        return gates;
    }
    catch (e) {
        if (cached && now - cached.readAt < POLICY_GATES_STALE_MS)
            return cached.gates;
        // Durable last resort: a valid snapshot that permits offline runs still governs
        // this scope across restarts. Missing or expired required policy fails closed.
        const snapshot = await persistence?.load(key).catch(() => undefined);
        if (snapshot && snapshotPermitsOfflineRun(snapshot, new Date(now)))
            return snapshot.gates;
        throw new PolicyGatesUnavailableError(e);
    }
}
//# sourceMappingURL=policyGates.js.map