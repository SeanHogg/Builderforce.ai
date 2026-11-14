/**
 * Durable governance policy snapshots (G09).
 *
 * The run-time gate resolver (`policyGates.ts`) used to hold the tenant's gates only in
 * a short-lived process cache: a restart, or a re-read failure past the ten-minute stale
 * window, left a managed project with no policy at all and refused the run. This module
 * persists every successfully read policy as a versioned `policy-snapshot` record in the
 * transactional local-first store, scoped to its tenant/project destination, together
 * with its validity window and its explicit offline permissions.
 *
 * The rules:
 *
 *   • A snapshot governs offline runs only while valid AND only when it was read with
 *     `allowOfflineRuns` — a tenant can forbid unmanaged offline execution.
 *   • A missing or expired REQUIRED policy fails closed for managed (bound) work,
 *     exactly as the server does.
 *   • Personal, never-connected work is governed by {@link PERSONAL_LOCAL_POLICY} — an
 *     explicit empty local policy, not an accidental absence of one.
 *   • Signing out must not strip policy from previously managed records: snapshots live
 *     in the durable store and are never cleared by sign-out or cache resets.
 */
import { newLocalRecord, UNBOUND_DESTINATION, } from "@builderforce/local-first";
/** 2: snapshots may hold compact `sideEffect` gates (read from a server that was told `gates=2`). */
export const POLICY_SNAPSHOT_SCHEMA_VERSION = 2;
/** How long a durable snapshot still governs runs without a successful re-read. */
export const POLICY_SNAPSHOT_VALID_MS = 24 * 60 * 60_000;
/**
 * The explicit policy for personal, never-bound work: no tenant gates, no hidden
 * defaults. Runs governed by it are local-only and carry no tenant obligations.
 */
export const PERSONAL_LOCAL_POLICY = Object.freeze({
    gates: [],
    scope: "personal",
    fetchedAt: "",
    validUntil: "",
    offlinePermissions: { allowOfflineRuns: true },
});
/** The record id for a scope's snapshot — one current snapshot per scope. */
export function policySnapshotRecordId(scopeKey) {
    return `policy-snapshot:${scopeKey}`;
}
function snapshotDestination(projectId) {
    return projectId == null ? UNBOUND_DESTINATION : { kind: "bound", projectId: String(projectId) };
}
/** Persist the gates just read as the scope's durable snapshot (replaces the previous one). */
export async function savePolicySnapshot(store, deps, args) {
    const now = deps.now?.() ?? new Date();
    const value = {
        gates: args.gates,
        scope: "tenant",
        fetchedAt: now.toISOString(),
        validUntil: new Date(now.getTime() + (args.validMs ?? POLICY_SNAPSHOT_VALID_MS)).toISOString(),
        offlinePermissions: { allowOfflineRuns: args.allowOfflineRuns ?? true },
    };
    const id = policySnapshotRecordId(args.scopeKey);
    await store.transact(async (tx) => {
        const existing = await tx.get("policy-snapshot", id);
        const record = existing
            ? { ...existing, version: existing.version + 1, updatedAt: value.fetchedAt, payload: value }
            : newLocalRecord({
                id,
                entityType: "policy-snapshot",
                deviceId: deps.deviceId,
                destination: snapshotDestination(args.projectId),
                occurredAt: value.fetchedAt,
                schemaVersion: POLICY_SNAPSHOT_SCHEMA_VERSION,
                payload: value,
            });
        await tx.put(record, existing ? existing.version : undefined);
        await tx.append({
            idempotencyKey: `policy-snapshot:update:${id}:${value.fetchedAt}`,
            clientEntityId: id,
            entityType: "policy-snapshot",
            operation: existing ? "update" : "create",
            schemaVersion: record.schemaVersion,
            occurredAt: value.fetchedAt,
            dependsOn: [],
            destination: record.destination,
            payload: value,
        });
    });
}
/** The scope's durable snapshot, however old — the caller decides usability. */
export async function loadPolicySnapshot(store, scopeKey) {
    return store.read((tx) => tx.get("policy-snapshot", policySnapshotRecordId(scopeKey)));
}
/**
 * May this snapshot govern an offline run right now? Only a valid snapshot that permits
 * offline execution qualifies — anything else must fail closed for managed work.
 */
export function snapshotPermitsOfflineRun(value, now = new Date()) {
    return value.offlinePermissions.allowOfflineRuns && now.toISOString() <= value.validUntil;
}
/**
 * The store-backed persistence port for `policyGates.configurePolicyGatesPersistence` —
 * the one line the composition root (extension activation) needs to make gate snapshots
 * durable. Structurally typed here so this module does not import the resolver.
 */
export function createPolicyGatesPersistence(store, deps) {
    return {
        save: (scopeKey, projectId, gates) => savePolicySnapshot(store, deps, { scopeKey, projectId, gates }),
        load: async (scopeKey) => (await loadPolicySnapshot(store, scopeKey))?.payload,
    };
}
//# sourceMappingURL=policySnapshots.js.map